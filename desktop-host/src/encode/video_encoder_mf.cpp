// Media Foundation hardware H.264 encoder, fed D3D11 textures on the shared
// device — the Windows counterpart of video_encoder_vt.mm.
//
// Hardware encoder MFTs are asynchronous: they announce when they want input
// (METransformNeedInput) and when output is ready (METransformHaveOutput)
// through an event queue, and a thread of ours has to pump it. That thread is
// the Windows equivalent of VideoToolbox's output callback.

#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mftransform.h>
#include <strmif.h>

// Defines the CODECAPI_* property GUIDs in this translation unit (selectany),
// so ICodecAPI works without depending on which import library carries them.
#include <initguid.h>
#include <codecapi.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "desktophost/encode/annex_b.h"
#include "desktophost/encode/video_encoder.h"
#include "platform/win/d3d_device.h"

namespace desktophost {
namespace {

using win::ComPtr;
using win::hresultMessage;

constexpr auto kDrainTimeout = std::chrono::seconds(2);

/// MF timestamps are in 100 ns units.
constexpr int64_t kHundredNsPerUs = 10;

HRESULT setUInt32(ICodecAPI* codec, const GUID& property, uint32_t value) {
    VARIANT variant{};
    variant.vt = VT_UI4;
    variant.ulVal = value;
    return codec->SetValue(&property, &variant);
}

HRESULT setBool(ICodecAPI* codec, const GUID& property, bool value) {
    VARIANT variant{};
    variant.vt = VT_BOOL;
    variant.boolVal = value ? VARIANT_TRUE : VARIANT_FALSE;
    return codec->SetValue(&property, &variant);
}

/// Tagged on both sides of the encoder, so the SPS carries BT.709 limited
/// range in its VUI and the browser is not left inferring it. The capture
/// video processor converts into exactly this.
void setColour(IMFMediaType* type) {
    type->SetUINT32(MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709);
    type->SetUINT32(MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709);
    type->SetUINT32(MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709);
    type->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235);
}

class MediaFoundationEncoder final : public IVideoEncoder {
public:
    explicit MediaFoundationEncoder(const EncoderConfig& config) : config_(config) {}

    ~MediaFoundationEncoder() override { stop(); }

    Status start(EncodedFrameCallback onEncoded) override {
        if (transform_) {
            return Status::error("encoder already started");
        }
        onEncoded_ = std::move(onEncoded);

        std::string error;
        device_ = win::sharedDevice(&error);
        if (!device_) {
            return Status::error("no D3D11 device: " + error);
        }
        // Checked up front so a GPU-less machine gets one clear message. The
        // phrase is matched by encode_pipeline_test to skip on CI runners.
        if (!device_->videoSupport) {
            return Status::error(
                "no hardware H.264 encoder: this machine's GPU driver has no D3D11 video "
                "support");
        }

        if (Status status = createTransform(); status.failed()) {
            releaseAll();
            return status;
        }

        stopping_.store(false);
        drained_ = false;
        inputCredits_ = 0;
        eventThread_ = std::thread([this] { pumpEvents(); });

        for (const MFT_MESSAGE_TYPE message :
             {MFT_MESSAGE_COMMAND_FLUSH, MFT_MESSAGE_NOTIFY_BEGIN_STREAMING,
              MFT_MESSAGE_NOTIFY_START_OF_STREAM}) {
            if (const HRESULT hr = transform_->ProcessMessage(message, 0); FAILED(hr)) {
                stop();
                return Status::error(hresultMessage("IMFTransform::ProcessMessage", hr));
            }
        }
        return Status::ok();
    }

    void encode(PlatformFrame frame) override {
        if (!transform_ || !frame.valid() || stopping_.load()) {
            return;
        }

        {
            // An encoder that has not asked for input is still busy. Queueing
            // behind it would add latency, and dropping could lose the *last*
            // change before the screen goes still — capture sends nothing more
            // for a static screen, so the phone would show a stale picture
            // until something else moves. So keep exactly one: the newest.
            // It goes in the moment the encoder asks for input.
            std::lock_guard<std::mutex> lock(stateMutex_);
            if (inputCredits_ == 0) {
                pending_ = std::move(frame);  // releases any older pending one
                return;
            }
            --inputCredits_;
        }
        submit(frame);
    }

    void submit(const PlatformFrame& frame) {
        auto* texture = static_cast<ID3D11Texture2D*>(frame.nativeHandle());

        // Wraps the texture without copying it. The buffer takes its own
        // reference, so `frame` releasing ours at the end of this call is safe
        // while the MFT is still reading from it.
        ComPtr<IMFMediaBuffer> buffer;
        HRESULT hr = MFCreateDXGISurfaceBuffer(__uuidof(ID3D11Texture2D), texture, 0, FALSE,
                                               &buffer);
        if (FAILED(hr)) {
            report(hresultMessage("MFCreateDXGISurfaceBuffer", hr));
            return;
        }
        ComPtr<IMF2DBuffer> buffer2d;
        DWORD length = 0;
        if (SUCCEEDED(buffer.As(&buffer2d)) && SUCCEEDED(buffer2d->GetContiguousLength(&length))) {
            buffer->SetCurrentLength(length);
        }

        ComPtr<IMFSample> sample;
        if (FAILED(hr = MFCreateSample(&sample)) || FAILED(hr = sample->AddBuffer(buffer.Get()))) {
            report(hresultMessage("MFCreateSample", hr));
            return;
        }
        // Duration left unset on purpose: capture is variable-rate, so a fixed
        // frame duration would misinform rate control.
        sample->SetSampleTime(frame.ptsUs() * kHundredNsPerUs);

        std::lock_guard<std::mutex> lock(inputMutex_);
        if (forceKeyframe_.exchange(false)) {
            setUInt32(codec_.Get(), CODECAPI_AVEncVideoForceKeyFrame, 1);
        }
        hr = transform_->ProcessInput(inputStreamId_, sample.Get(), 0);
        if (FAILED(hr)) {
            report(hresultMessage("IMFTransform::ProcessInput", hr));
        }
    }

    void forceKeyframe() override { forceKeyframe_.store(true); }

    void setBitrate(int bitrateBps) override {
        if (!codec_ || bitrateBps <= 0) {
            return;
        }
        std::lock_guard<std::mutex> lock(inputMutex_);
        config_.bitrateBps = bitrateBps;
        setUInt32(codec_.Get(), CODECAPI_AVEncCommonMeanBitRate, static_cast<uint32_t>(bitrateBps));
        applyBufferSize();
    }

    void stop() override {
        if (!transform_) {
            return;
        }

        if (eventThread_.joinable()) {
            // Flush like VTCompressionSessionCompleteFrames: everything already
            // submitted comes out on the callback before stop() returns. The
            // pump exits on the drain-complete event, which is what lets it
            // stop without relying on shutdown to unblock GetEvent.
            stopping_.store(true);
            transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            const HRESULT hr = transform_->ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0);

            bool drained = false;
            if (SUCCEEDED(hr)) {
                std::unique_lock<std::mutex> lock(stateMutex_);
                drained = drainedCv_.wait_for(lock, kDrainTimeout, [this] { return drained_; });
            }
            if (!drained) {
                std::fprintf(stderr, "[encoder] drain did not complete; shutting down anyway\n");
            }
            shutdownTransform();
            eventThread_.join();
        }
        releaseAll();
    }

private:
    Status createTransform() {
        MFT_REGISTER_TYPE_INFO input{MFMediaType_Video, MFVideoFormat_NV12};
        MFT_REGISTER_TYPE_INFO output{MFMediaType_Video, MFVideoFormat_H264};

        ComPtr<IMFAttributes> filter;
        MFCreateAttributes(&filter, 1);
        filter->SetBlob(MFT_ENUM_ADAPTER_LUID, reinterpret_cast<const UINT8*>(&device_->adapterLuid),
                        sizeof(LUID));

        IMFActivate** activates = nullptr;
        UINT32 count = 0;
        HRESULT hr = MFTEnum2(MFT_CATEGORY_VIDEO_ENCODER,
                              MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER, &input, &output,
                              filter.Get(), &activates, &count);
        if (FAILED(hr) || count == 0) {
            if (activates != nullptr) {
                CoTaskMemFree(activates);
            }
            return Status::error(
                "no hardware H.264 encoder for this GPU" +
                (FAILED(hr) ? " (" + hresultMessage("MFTEnum2", hr) + ")" : std::string{}));
        }

        // Several can match (an iGPU's and a vendor's). Take the first one that
        // accepts the configuration; SORTANDFILTER has already ranked them.
        // Worded so it does not match the "no hardware H.264 encoder" skip in
        // encode_pipeline_test: an encoder that exists but rejects us is a
        // bug to see, not a missing GPU.
        Status last = Status::error("could not activate the hardware H.264 encoder");
        for (UINT32 i = 0; i < count; ++i) {
            if (!transform_) {
                ComPtr<IMFTransform> candidate;
                if (SUCCEEDED(activates[i]->ActivateObject(IID_PPV_ARGS(&candidate)))) {
                    transform_ = candidate;
                    activate_ = activates[i];
                    last = configure();
                    if (last.failed()) {
                        std::fprintf(stderr, "[encoder] %s: %s\n", encoderName(activates[i]).c_str(),
                                     last.message().c_str());
                        activates[i]->ShutdownObject();
                        releaseAll();
                    } else {
                        std::fprintf(stderr, "[encoder] using %s\n",
                                     encoderName(activates[i]).c_str());
                    }
                }
            }
            activates[i]->Release();
        }
        CoTaskMemFree(activates);
        return transform_ ? Status::ok() : last;
    }

    static std::string encoderName(IMFActivate* activate) {
        WCHAR* name = nullptr;
        UINT32 length = 0;
        if (FAILED(activate->GetAllocatedString(MFT_FRIENDLY_NAME_Attribute, &name, &length))) {
            return "hardware H.264 encoder";
        }
        std::string narrow;
        for (UINT32 i = 0; i < length; ++i) {
            narrow.push_back(name[i] < 0x80 ? static_cast<char>(name[i]) : '?');
        }
        CoTaskMemFree(name);
        return narrow;
    }

    Status configure() {
        ComPtr<IMFAttributes> attributes;
        HRESULT hr = transform_->GetAttributes(&attributes);
        if (FAILED(hr)) {
            return Status::error(hresultMessage("IMFTransform::GetAttributes", hr));
        }
        if (MFGetAttributeUINT32(attributes.Get(), MF_TRANSFORM_ASYNC, FALSE) == FALSE) {
            return Status::error("encoder is not asynchronous");
        }
        attributes->SetUINT32(MF_TRANSFORM_ASYNC_UNLOCK, TRUE);
        attributes->SetUINT32(MF_LOW_LATENCY, TRUE);

        if (FAILED(hr = transform_.As(&events_))) {
            return Status::error(hresultMessage("QueryInterface(IMFMediaEventGenerator)", hr));
        }
        if (FAILED(hr = transform_.As(&codec_))) {
            return Status::error(hresultMessage("QueryInterface(ICodecAPI)", hr));
        }

        // The texture path: from here on the MFT reads our D3D11 textures
        // directly, which is what keeps the pipeline GPU-resident.
        hr = transform_->ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER,
                                        reinterpret_cast<ULONG_PTR>(device_->deviceManager.Get()));
        if (FAILED(hr)) {
            return Status::error(hresultMessage("MFT_MESSAGE_SET_D3D_MANAGER", hr));
        }

        DWORD inputId = 0;
        DWORD outputId = 0;
        if (transform_->GetStreamIDs(1, &inputId, 1, &outputId) == S_OK) {
            inputStreamId_ = inputId;
            outputStreamId_ = outputId;
        }

        // Latency-shaped, mirroring the VideoToolbox configuration. Rate
        // control has to be chosen before the media types are set.
        setBool(codec_.Get(), CODECAPI_AVLowLatencyMode, true);
        setUInt32(codec_.Get(), CODECAPI_AVEncCommonRateControlMode,
                  eAVEncCommonRateControlMode_CBR);
        setUInt32(codec_.Get(), CODECAPI_AVEncCommonMeanBitRate,
                  static_cast<uint32_t>(config_.bitrateBps));

        if (Status status = setOutputType(); status.failed()) {
            return status;
        }
        if (Status status = setInputType(); status.failed()) {
            return status;
        }

        // B-frames reference a future frame: a whole frame of latency by
        // construction.
        setUInt32(codec_.Get(), CODECAPI_AVEncMPVDefaultBPictureCount, 0);
        disablePeriodicKeyframes();
        applyBufferSize();

        MFT_OUTPUT_STREAM_INFO info{};
        if (SUCCEEDED(transform_->GetOutputStreamInfo(outputStreamId_, &info))) {
            outputProvidesSamples_ =
                (info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES |
                                 MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES)) != 0;
            outputBufferSize_ = info.cbSize;
        }
        return Status::ok();
    }

    Status setOutputType() {
        // Constrained Baseline is what the SDP offer promises and what Safari
        // reliably hardware-decodes. Not every vendor MFT accepts the
        // ConstrainedBase enum; plain Baseline from a hardware encoder uses
        // none of the tools Constrained Baseline excludes, so it is the
        // fallback.
        HRESULT hr = E_FAIL;
        for (const UINT32 profile :
             {static_cast<UINT32>(eAVEncH264VProfile_ConstrainedBase),
              static_cast<UINT32>(eAVEncH264VProfile_Base)}) {
            ComPtr<IMFMediaType> type;
            MFCreateMediaType(&type);
            type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
            type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
            type->SetUINT32(MF_MT_AVG_BITRATE, static_cast<UINT32>(config_.bitrateBps));
            MFSetAttributeSize(type.Get(), MF_MT_FRAME_SIZE, static_cast<UINT32>(config_.width),
                               static_cast<UINT32>(config_.height));
            MFSetAttributeRatio(type.Get(), MF_MT_FRAME_RATE, static_cast<UINT32>(config_.fps), 1);
            MFSetAttributeRatio(type.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
            type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
            type->SetUINT32(MF_MT_MPEG2_PROFILE, profile);
            // Level 4.1, matching the offer's profile-level-id.
            type->SetUINT32(MF_MT_MPEG2_LEVEL, eAVEncH264VLevel4_1);
            setColour(type.Get());

            hr = transform_->SetOutputType(outputStreamId_, type.Get(), 0);
            if (SUCCEEDED(hr)) {
                return Status::ok();
            }
        }
        return Status::error(hresultMessage("IMFTransform::SetOutputType", hr));
    }

    Status setInputType() {
        ComPtr<IMFMediaType> type;
        MFCreateMediaType(&type);
        type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
        MFSetAttributeSize(type.Get(), MF_MT_FRAME_SIZE, static_cast<UINT32>(config_.width),
                           static_cast<UINT32>(config_.height));
        MFSetAttributeRatio(type.Get(), MF_MT_FRAME_RATE, static_cast<UINT32>(config_.fps), 1);
        MFSetAttributeRatio(type.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
        type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
        setColour(type.Get());

        const HRESULT hr = transform_->SetInputType(inputStreamId_, type.Get(), 0);
        if (FAILED(hr)) {
            return Status::error(hresultMessage("IMFTransform::SetInputType", hr));
        }
        return Status::ok();
    }

    void disablePeriodicKeyframes() {
        // No periodic keyframes: each is a bitrate spike, and recovery is
        // explicit instead (a viewer joining, or an RTCP PLI). What "no limit"
        // looks like varies by vendor, so try the largest GOP first and fall
        // back; encode_pipeline_test checks the result on real hardware.
        for (const uint32_t gop : {UINT32_MAX, static_cast<uint32_t>(INT32_MAX), 0u}) {
            if (SUCCEEDED(setUInt32(codec_.Get(), CODECAPI_AVEncMPVGOPSize, gop))) {
                return;
            }
        }
        std::fprintf(stderr, "[encoder] warning: could not disable periodic keyframes\n");
    }

    void applyBufferSize() {
        // The VBV buffer is the Media Foundation form of VideoToolbox's
        // DataRateLimits: a ceiling on bytes over a short window. It keeps a
        // single IDR from arriving as one burst, which would make the
        // receiver's jitter buffer grow and never shrink back. In bits.
        const double bits = static_cast<double>(config_.bitrateBps) *
                            config_.dataRateWindowSeconds * config_.dataRateLimitFactor;
        setUInt32(codec_.Get(), CODECAPI_AVEncCommonBufferSize, static_cast<uint32_t>(bits));
    }

    void pumpEvents() {
        while (true) {
            ComPtr<IMFMediaEvent> event;
            if (FAILED(events_->GetEvent(0, &event))) {
                return;  // MF_E_SHUTDOWN
            }
            MediaEventType type = MEUnknown;
            event->GetType(&type);

            switch (type) {
                case METransformNeedInput: {
                    PlatformFrame next;
                    {
                        std::lock_guard<std::mutex> lock(stateMutex_);
                        if (pending_.valid() && !stopping_.load()) {
                            next = std::move(pending_);
                        } else {
                            ++inputCredits_;
                        }
                    }
                    if (next.valid()) {
                        submit(next);
                    }
                    break;
                }
                case METransformHaveOutput:
                    collectOutput();
                    break;
                case METransformDrainComplete: {
                    {
                        std::lock_guard<std::mutex> lock(stateMutex_);
                        drained_ = true;
                    }
                    drainedCv_.notify_all();
                    if (stopping_.load()) {
                        return;
                    }
                    break;
                }
                default:
                    break;
            }
        }
    }

    void collectOutput() {
        MFT_OUTPUT_DATA_BUFFER output{};
        output.dwStreamID = outputStreamId_;

        ComPtr<IMFSample> ownSample;
        if (!outputProvidesSamples_) {
            ComPtr<IMFMediaBuffer> buffer;
            const DWORD size =
                std::max<DWORD>(outputBufferSize_, static_cast<DWORD>(config_.width * config_.height));
            if (FAILED(MFCreateMemoryBuffer(size, &buffer)) || FAILED(MFCreateSample(&ownSample))) {
                return;
            }
            ownSample->AddBuffer(buffer.Get());
            output.pSample = ownSample.Get();
        }

        DWORD status = 0;
        const HRESULT hr = transform_->ProcessOutput(0, 1, &output, &status);
        if (output.pEvents != nullptr) {
            output.pEvents->Release();
        }

        ComPtr<IMFSample> sample;
        if (outputProvidesSamples_) {
            sample.Attach(output.pSample);  // we own the reference the MFT gave us
        } else {
            sample = ownSample;
        }

        if (hr == MF_E_TRANSFORM_STREAM_CHANGE) {
            // The encoder changed its output format (typically once, to fill
            // in the SPS/PPS it chose). Accept its proposal and carry on.
            ComPtr<IMFMediaType> type;
            if (SUCCEEDED(transform_->GetOutputAvailableType(outputStreamId_, 0, &type))) {
                transform_->SetOutputType(outputStreamId_, type.Get(), 0);
            }
            return;
        }
        if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) {
            return;
        }
        if (FAILED(hr) || !sample) {
            report(hresultMessage("IMFTransform::ProcessOutput", hr));
            return;
        }
        emit(sample.Get());
    }

    void emit(IMFSample* sample) {
        if (!onEncoded_) {
            return;
        }

        ComPtr<IMFMediaBuffer> buffer;
        if (FAILED(sample->ConvertToContiguousBuffer(&buffer))) {
            return;
        }
        BYTE* data = nullptr;
        DWORD length = 0;
        if (FAILED(buffer->Lock(&data, nullptr, &length))) {
            return;
        }
        // Copied out: this is where the pipeline leaves Media Foundation
        // lifetimes behind for plain heap memory, exactly as on macOS.
        const std::vector<std::byte> annexB(reinterpret_cast<const std::byte*>(data),
                                            reinterpret_cast<const std::byte*>(data) + length);
        buffer->Unlock();

        EncodedFrame frame;
        LONGLONG time = 0;
        if (SUCCEEDED(sample->GetSampleTime(&time))) {
            frame.ptsUs = time / kHundredNsPerUs;
        }
        if (!annexb::normalizeFrame(annexB, parameterSets_, frame.annexB, frame.isKeyframe)) {
            std::fprintf(stderr, "[encoder] undecodable output (IDR before SPS/PPS), dropping\n");
            return;
        }
        onEncoded_(frame);
    }

    void report(const std::string& message) {
        std::fprintf(stderr, "[encoder] %s\n", message.c_str());
    }

    void shutdownTransform() {
        ComPtr<IMFShutdown> shutdown;
        if (SUCCEEDED(transform_.As(&shutdown))) {
            shutdown->Shutdown();
        }
        if (activate_) {
            activate_->ShutdownObject();
        }
    }

    void releaseAll() {
        {
            std::lock_guard<std::mutex> lock(stateMutex_);
            pending_.reset();
        }
        events_.Reset();
        codec_.Reset();
        transform_.Reset();
        activate_.Reset();
        parameterSets_ = {};
    }

    EncoderConfig config_;
    std::shared_ptr<const win::SharedDevice> device_;
    EncodedFrameCallback onEncoded_;

    ComPtr<IMFTransform> transform_;
    ComPtr<IMFMediaEventGenerator> events_;
    ComPtr<ICodecAPI> codec_;
    /// Kept for ShutdownObject(), which is how an MFT created from an
    /// activation object is meant to be torn down.
    ComPtr<IMFActivate> activate_;
    DWORD inputStreamId_ = 0;
    DWORD outputStreamId_ = 0;
    bool outputProvidesSamples_ = true;
    DWORD outputBufferSize_ = 0;

    std::thread eventThread_;
    std::atomic<bool> stopping_{false};
    std::atomic<bool> forceKeyframe_{false};

    /// Serialises ProcessInput with the codec property changes made around it.
    std::mutex inputMutex_;

    /// Guards the NeedInput credit count and the drain flag.
    std::mutex stateMutex_;
    std::condition_variable drainedCv_;
    int inputCredits_ = 0;
    bool drained_ = false;
    PlatformFrame pending_;

    /// Only touched on the event thread.
    annexb::ParameterSetCache parameterSets_;
};

}  // namespace

std::unique_ptr<IVideoEncoder> makeVideoEncoder(const EncoderConfig& config) {
    return std::make_unique<MediaFoundationEncoder>(config);
}

}  // namespace desktophost
