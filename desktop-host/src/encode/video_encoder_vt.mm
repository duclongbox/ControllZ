#import <CoreFoundation/CoreFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <VideoToolbox/VideoToolbox.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "desktophost/encode/annex_b.h"
#include "desktophost/encode/video_encoder.h"

using desktophost::EncodedFrame;
using desktophost::EncodedFrameCallback;
using desktophost::EncoderConfig;
using desktophost::IVideoEncoder;
using desktophost::PlatformFrame;
using desktophost::Status;

namespace {

std::string osStatusMessage(const char* what, OSStatus status) {
    return std::string(what) + " failed (OSStatus " + std::to_string(static_cast<long>(status)) + ")";
}

void setBool(VTCompressionSessionRef session, CFStringRef key, bool value) {
    VTSessionSetProperty(session, key, value ? kCFBooleanTrue : kCFBooleanFalse);
}

void setInt(VTCompressionSessionRef session, CFStringRef key, int32_t value) {
    CFNumberRef number = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &value);
    VTSessionSetProperty(session, key, number);
    CFRelease(number);
}

class VideoToolboxEncoder final : public IVideoEncoder {
public:
    explicit VideoToolboxEncoder(const EncoderConfig& config) : config_(config) {}

    ~VideoToolboxEncoder() override { stop(); }

    Status start(EncodedFrameCallback onEncoded) override {
        if (session_ != nullptr) {
            return Status::error("encoder already started");
        }
        onEncoded_ = std::move(onEncoded);

        NSDictionary* specification = @{
            (__bridge NSString*)kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder :
                @YES,
        };

        OSStatus status = VTCompressionSessionCreate(
            kCFAllocatorDefault, config_.width, config_.height, kCMVideoCodecType_H264,
            (__bridge CFDictionaryRef)specification,
            /*sourceImageBufferAttributes=*/nullptr,
            /*compressedDataAllocator=*/nullptr, &VideoToolboxEncoder::onCompressed, this, &session_);
        if (status != noErr || session_ == nullptr) {
            return Status::error(osStatusMessage("VTCompressionSessionCreate", status));
        }

        applyProperties();

        status = VTCompressionSessionPrepareToEncodeFrames(session_);
        if (status != noErr) {
            stop();
            return Status::error(osStatusMessage("VTCompressionSessionPrepareToEncodeFrames", status));
        }

        warnIfSoftwareEncoder();
        return Status::ok();
    }

    void encode(PlatformFrame frame) override {
        if (session_ == nullptr || !frame.valid()) {
            return;
        }

        CFDictionaryRef frameProperties = nullptr;
        if (forceKeyframe_.exchange(false)) {
            const void* keys[] = {kVTEncodeFrameOptionKey_ForceKeyFrame};
            const void* values[] = {kCFBooleanTrue};
            frameProperties = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1,
                                                 &kCFTypeDictionaryKeyCallBacks,
                                                 &kCFTypeDictionaryValueCallBacks);
        }

        // Duration is left invalid on purpose: screen capture is variable-rate,
        // so claiming a fixed frame duration would misinform rate control.
        VTEncodeInfoFlags infoFlags = 0;
        const OSStatus status = VTCompressionSessionEncodeFrame(
            session_, static_cast<CVPixelBufferRef>(frame.nativeHandle()),
            CMTimeMake(frame.ptsUs(), 1'000'000), kCMTimeInvalid, frameProperties,
            /*sourceFrameRefcon=*/nullptr, &infoFlags);

        if (frameProperties != nullptr) {
            CFRelease(frameProperties);
        }
        if (status != noErr) {
            std::fprintf(stderr, "[encoder] %s\n",
                         osStatusMessage("VTCompressionSessionEncodeFrame", status).c_str());
        }
        // `frame` releases its pixel buffer here; VideoToolbox has retained it
        // for the duration of the asynchronous encode.
    }

    void forceKeyframe() override { forceKeyframe_.store(true); }

    void setBitrate(int bitrateBps) override {
        if (session_ == nullptr || bitrateBps <= 0) {
            return;
        }
        config_.bitrateBps = bitrateBps;
        setInt(session_, kVTCompressionPropertyKey_AverageBitRate, bitrateBps);
        applyDataRateLimit();
    }

    void stop() override {
        if (session_ == nullptr) {
            return;
        }
        VTCompressionSessionCompleteFrames(session_, kCMTimeInvalid);
        VTCompressionSessionInvalidate(session_);
        CFRelease(session_);
        session_ = nullptr;
    }

private:
    void applyProperties() {
        // Latency-shaped configuration. Each of these is a latency decision,
        // not a quality one — see docs/implementation-plan.md M1.
        setBool(session_, kVTCompressionPropertyKey_RealTime, true);
        // B-frames reference a future frame, so enabling them would add a
        // whole frame of latency by construction.
        setBool(session_, kVTCompressionPropertyKey_AllowFrameReordering, false);
        setBool(session_, kVTCompressionPropertyKey_MaximizePowerEfficiency, false);

        // Constrained Baseline is the profile Safari reliably answers with
        // hardware decode (system-design.md 2.1).
        VTSessionSetProperty(session_, kVTCompressionPropertyKey_ProfileLevel,
                             kVTProfileLevel_H264_ConstrainedBaseline_AutoLevel);

        setInt(session_, kVTCompressionPropertyKey_ExpectedFrameRate, config_.fps);
        setInt(session_, kVTCompressionPropertyKey_AverageBitRate, config_.bitrateBps);
        applyDataRateLimit();

        // Long GOP: periodic keyframes buy nothing here and each one is a
        // bitrate spike. Recovery is explicit instead — a new viewer joining,
        // or an RTCP PLI once transport lands.
        setInt(session_, kVTCompressionPropertyKey_MaxKeyFrameInterval,
               config_.keyFrameIntervalFrames);
        const int32_t keyframeSeconds =
            config_.fps > 0 ? std::max(1, config_.keyFrameIntervalFrames / config_.fps) : 5;
        setInt(session_, kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, keyframeSeconds);

        // Tag colour explicitly so the browser is not left inferring it; a
        // mismatch here shows up as subtly washed-out output.
        VTSessionSetProperty(session_, kVTCompressionPropertyKey_ColorPrimaries,
                             kCMFormatDescriptionColorPrimaries_ITU_R_709_2);
        VTSessionSetProperty(session_, kVTCompressionPropertyKey_TransferFunction,
                             kCMFormatDescriptionTransferFunction_ITU_R_709_2);
        VTSessionSetProperty(session_, kVTCompressionPropertyKey_YCbCrMatrix,
                             kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2);
    }

    void applyDataRateLimit() {
        // [maxBytes, seconds]: a hard ceiling over a short window. This is what
        // keeps a single IDR from arriving as one large burst, which would make
        // the receiver's jitter buffer grow and never shrink back.
        const double bytes = (config_.bitrateBps / 8.0) * config_.dataRateWindowSeconds *
                             config_.dataRateLimitFactor;
        NSArray* limits = @[ @(bytes), @(config_.dataRateWindowSeconds) ];
        VTSessionSetProperty(session_, kVTCompressionPropertyKey_DataRateLimits,
                             (__bridge CFArrayRef)limits);
    }

    void warnIfSoftwareEncoder() {
        CFBooleanRef usingHardware = nullptr;
        if (VTSessionCopyProperty(session_,
                                  kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder,
                                  kCFAllocatorDefault, &usingHardware) == noErr &&
            usingHardware != nullptr) {
            if (!CFBooleanGetValue(usingHardware)) {
                std::fprintf(stderr,
                             "[encoder] warning: hardware encode unavailable, falling back to "
                             "software\n");
            }
            CFRelease(usingHardware);
        }
    }

    static void onCompressed(void* refcon, void* sourceFrameRefcon, OSStatus status,
                             VTEncodeInfoFlags infoFlags, CMSampleBufferRef sampleBuffer) {
        (void)sourceFrameRefcon;
        auto* self = static_cast<VideoToolboxEncoder*>(refcon);
        if (self == nullptr) {
            return;
        }
        if (status != noErr) {
            std::fprintf(stderr, "[encoder] %s\n", osStatusMessage("encode", status).c_str());
            return;
        }
        if ((infoFlags & kVTEncodeInfo_FrameDropped) != 0 || sampleBuffer == nullptr ||
            !CMSampleBufferDataIsReady(sampleBuffer)) {
            return;
        }
        self->emit(sampleBuffer);
    }

    void emit(CMSampleBufferRef sampleBuffer) {
        if (!onEncoded_) {
            return;
        }

        const bool isKeyframe = sampleBufferIsKeyframe(sampleBuffer);

        CMFormatDescriptionRef format = CMSampleBufferGetFormatDescription(sampleBuffer);
        if (format == nullptr) {
            return;
        }

        // VideoToolbox reports the AVCC length-prefix width here; it is 4 in
        // practice but reading it is free and the conversion depends on it.
        size_t parameterSetCount = 0;
        int nalLengthSize = 0;
        OSStatus status = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format, 0, nullptr, nullptr, &parameterSetCount, &nalLengthSize);
        if (status != noErr) {
            std::fprintf(stderr, "[encoder] %s\n",
                         osStatusMessage("CMVideoFormatDescriptionGetH264ParameterSetAtIndex",
                                         status)
                             .c_str());
            return;
        }

        // SPS/PPS live only in the format description, never in the bitstream.
        // Prepending them to every IDR is what makes the stream decodable from
        // any keyframe.
        desktophost::annexb::ParameterSets parameterSets;
        if (isKeyframe) {
            for (size_t i = 0; i < parameterSetCount; ++i) {
                const uint8_t* data = nullptr;
                size_t size = 0;
                if (CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, i, &data, &size,
                                                                       nullptr, nullptr) != noErr ||
                    data == nullptr || size == 0) {
                    return;
                }
                const auto* begin = reinterpret_cast<const std::byte*>(data);
                parameterSets.emplace_back(begin, begin + size);
            }
        }

        CMBlockBufferRef blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer);
        if (blockBuffer == nullptr) {
            return;
        }
        const size_t length = CMBlockBufferGetDataLength(blockBuffer);
        std::vector<std::byte> avcc(length);
        // Copy rather than borrow the pointer: the block buffer may be
        // non-contiguous, and this is the point where the pipeline leaves
        // CoreFoundation lifetimes behind for plain heap memory.
        if (CMBlockBufferCopyDataBytes(blockBuffer, 0, length, avcc.data()) != kCMBlockBufferNoErr) {
            return;
        }

        EncodedFrame frame;
        frame.isKeyframe = isKeyframe;
        frame.ptsUs = CMTimeConvertScale(CMSampleBufferGetPresentationTimeStamp(sampleBuffer),
                                         1'000'000, kCMTimeRoundingMethod_Default)
                          .value;
        if (!desktophost::annexb::buildFrame(parameterSets, avcc, nalLengthSize, frame.annexB)) {
            std::fprintf(stderr, "[encoder] malformed AVCC output, dropping frame\n");
            return;
        }

        onEncoded_(frame);
    }

    static bool sampleBufferIsKeyframe(CMSampleBufferRef sampleBuffer) {
        CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, false);
        if (attachments == nullptr || CFArrayGetCount(attachments) == 0) {
            return true;  // absent attachments mean a sync sample
        }
        auto dictionary =
            static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(attachments, 0));
        const void* notSync = CFDictionaryGetValue(dictionary, kCMSampleAttachmentKey_NotSync);
        return notSync == nullptr || !CFBooleanGetValue(static_cast<CFBooleanRef>(notSync));
    }

    EncoderConfig config_;
    VTCompressionSessionRef session_ = nullptr;
    EncodedFrameCallback onEncoded_;
    std::atomic<bool> forceKeyframe_{false};
};

}  // namespace

namespace desktophost {

std::unique_ptr<IVideoEncoder> makeVideoEncoder(const EncoderConfig& config) {
    return std::make_unique<VideoToolboxEncoder>(config);
}

}  // namespace desktophost
