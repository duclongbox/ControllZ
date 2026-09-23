#import <CoreGraphics/CoreGraphics.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>

#include <algorithm>
#include <memory>
#include <mutex>
#include <string>

#include "desktophost/capture/capture_size.h"
#include "desktophost/capture/screen_capturer.h"

using desktophost::CaptureConfig;
using desktophost::CaptureErrorCallback;
using desktophost::FrameCallback;
using desktophost::IScreenCapturer;
using desktophost::PlatformFrame;
using desktophost::Status;

namespace {

constexpr int64_t kTimeoutSeconds = 10;

/// Marks the sample handler queue so stop() can tell it is running on it. Only
/// the address matters.
char kCaptureQueueKeyStorage;
void* const kCaptureQueueKey = &kCaptureQueueKeyStorage;

/// Shared between the C++ capturer and the Objective-C stream delegate. The
/// delegate outlives stop() from ScreenCaptureKit's point of view, so the
/// callbacks live behind a flag rather than in the capturer itself.
struct CaptureSink {
    std::mutex mutex;
    bool running = false;
    FrameCallback onFrame;
    CaptureErrorCallback onError;
};

std::string describe(NSError* error) {
    if (error == nil) {
        return "unknown error";
    }
    const char* description = [[error localizedDescription] UTF8String];
    return std::string(description != nullptr ? description : "unknown error") + " (code " +
           std::to_string(static_cast<long>(error.code)) + ")";
}

}  // namespace

// ---------------------------------------------------------------------------
// Stream delegate
// ---------------------------------------------------------------------------

@interface DHStreamOutput : NSObject <SCStreamOutput, SCStreamDelegate>
- (instancetype)initWithSink:(std::shared_ptr<CaptureSink>)sink;
@end

@implementation DHStreamOutput {
    std::shared_ptr<CaptureSink> _sink;
}

- (instancetype)initWithSink:(std::shared_ptr<CaptureSink>)sink {
    if ((self = [super init])) {
        _sink = std::move(sink);
    }
    return self;
}

- (void)stream:(SCStream*)stream
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
                   ofType:(SCStreamOutputType)type {
    (void)stream;
    if (type != SCStreamOutputTypeScreen || sampleBuffer == nullptr ||
        !CMSampleBufferIsValid(sampleBuffer)) {
        return;
    }

    // ScreenCaptureKit delivers a sample for every tick of the frame interval,
    // but marks the ones where nothing changed. Encoding those would spend
    // bitrate re-sending an identical picture; a static screen legitimately
    // produces no output at all here.
    NSArray* attachments =
        (__bridge NSArray*)CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, false);
    if (attachments.count == 0) {
        return;
    }
    NSDictionary* info = attachments[0];
    NSNumber* statusValue = info[SCStreamFrameInfoStatus];
    if (statusValue == nil || statusValue.intValue != SCFrameStatusComplete) {
        return;
    }

    CVImageBufferRef pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (pixelBuffer == nullptr) {
        return;
    }

    const CMTime pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
    const CMTime ptsUs = CMTimeConvertScale(pts, 1'000'000, kCMTimeRoundingMethod_Default);

    FrameCallback callback;
    {
        std::lock_guard<std::mutex> lock(_sink->mutex);
        if (!_sink->running) {
            return;
        }
        callback = _sink->onFrame;
    }
    if (!callback) {
        return;
    }

    // Retained here and released by the PlatformFrame: the sample buffer is
    // only guaranteed alive for the duration of this callback, and the frame
    // is about to cross onto the encoder's thread.
    CVPixelBufferRef retained = CVPixelBufferRetain(pixelBuffer);
    PlatformFrame frame(retained,
                        [](void* handle) noexcept {
                            CVPixelBufferRelease(static_cast<CVPixelBufferRef>(handle));
                        },
                        static_cast<int>(CVPixelBufferGetWidth(pixelBuffer)),
                        static_cast<int>(CVPixelBufferGetHeight(pixelBuffer)), ptsUs.value);

    callback(std::move(frame));
}

- (void)stream:(SCStream*)stream didStopWithError:(NSError*)error {
    (void)stream;
    CaptureErrorCallback callback;
    {
        std::lock_guard<std::mutex> lock(_sink->mutex);
        if (!_sink->running) {
            return;
        }
        _sink->running = false;
        callback = _sink->onError;
    }
    if (callback) {
        callback(Status::error("capture stopped: " + describe(error)));
    }
}

@end

// ---------------------------------------------------------------------------
// Capturer
// ---------------------------------------------------------------------------

namespace {

class MacScreenCapturer final : public IScreenCapturer {
public:
    explicit MacScreenCapturer(const CaptureConfig& config)
        : config_(config), sink_(std::make_shared<CaptureSink>()) {}

    ~MacScreenCapturer() override { stop(); }

    Status start(FrameCallback onFrame, CaptureErrorCallback onError) override {
        @autoreleasepool {
            if (stream_ != nil) {
                return Status::error("capture already started");
            }

            SCDisplay* display = nil;
            Status contentStatus = findDisplay(&display);
            if (contentStatus.failed()) {
                return contentStatus;
            }

            const desktophost::CaptureSize size =
                desktophost::fitWithin(static_cast<int>(display.width),
                                       static_cast<int>(display.height), config_.maxWidth,
                                       config_.maxHeight);
            width_ = size.width;
            height_ = size.height;

            SCStreamConfiguration* streamConfig = [[SCStreamConfiguration alloc] init];
            streamConfig.width = static_cast<size_t>(width_);
            streamConfig.height = static_cast<size_t>(height_);
            // NV12 straight from the compositor. Asking for BGRA here would
            // mean a colour conversion somewhere later; this way the GPU has
            // already produced what the encoder wants and no pixel ever meets
            // the CPU.
            streamConfig.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarFullRange;
            streamConfig.minimumFrameInterval = CMTimeMake(1, config_.maxFps);
            streamConfig.showsCursor = config_.showsCursor;
            streamConfig.queueDepth = 6;

            {
                std::lock_guard<std::mutex> lock(sink_->mutex);
                sink_->onFrame = std::move(onFrame);
                sink_->onError = std::move(onError);
                sink_->running = true;
            }

            output_ = [[DHStreamOutput alloc] initWithSink:sink_];

            SCContentFilter* filter = [[SCContentFilter alloc] initWithDisplay:display
                                                             excludingWindows:@[]];
            stream_ = [[SCStream alloc] initWithFilter:filter
                                         configuration:streamConfig
                                              delegate:output_];

            queue_ = dispatch_queue_create("com.remotehost.desktop-host.capture",
                                           dispatch_queue_attr_make_with_qos_class(
                                               DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INTERACTIVE, 0));
            dispatch_queue_set_specific(queue_, kCaptureQueueKey, kCaptureQueueKey, nullptr);

            NSError* addError = nil;
            if (![stream_ addStreamOutput:output_
                                     type:SCStreamOutputTypeScreen
                       sampleHandlerQueue:queue_
                                    error:&addError]) {
                reset();
                return Status::error("addStreamOutput failed: " + describe(addError));
            }

            // Blocking here is the point: if Screen Recording is denied the
            // completion handler carries the error, and reporting it now is
            // the difference between a clear message and a silent black
            // stream.
            dispatch_semaphore_t started = dispatch_semaphore_create(0);
            __block NSError* startError = nil;
            [stream_ startCaptureWithCompletionHandler:^(NSError* error) {
                startError = error;
                dispatch_semaphore_signal(started);
            }];
            if (dispatch_semaphore_wait(started, timeout()) != 0) {
                reset();
                return Status::error("timed out waiting for capture to start");
            }
            if (startError != nil) {
                reset();
                return Status::error("startCapture failed: " + describe(startError));
            }

            return Status::ok();
        }
    }

    void stop() override {
        @autoreleasepool {
            {
                std::lock_guard<std::mutex> lock(sink_->mutex);
                if (!sink_->running && stream_ == nil) {
                    return;
                }
                sink_->running = false;
            }

            if (stream_ != nil) {
                dispatch_semaphore_t stopped = dispatch_semaphore_create(0);
                [stream_ stopCaptureWithCompletionHandler:^(NSError* error) {
                    (void)error;
                    dispatch_semaphore_signal(stopped);
                }];
                dispatch_semaphore_wait(stopped, timeout());
            }

            // The running flag only stops handlers that have not read it yet.
            // One that already copied the callback may still be inside it, and
            // the caller is about to tear the encoder down, so wait it out:
            // the handler queue is serial, and once this empty block runs,
            // nothing is left in flight. Skipped when stop() is itself called
            // from a frame callback, where waiting on our own queue would
            // deadlock.
            if (queue_ != nil && dispatch_get_specific(kCaptureQueueKey) == nullptr) {
                dispatch_sync(queue_, ^{});
            }
            reset();
        }
    }

    int width() const override { return width_; }
    int height() const override { return height_; }

private:
    static dispatch_time_t timeout() {
        return dispatch_time(DISPATCH_TIME_NOW, kTimeoutSeconds * NSEC_PER_SEC);
    }

    Status findDisplay(SCDisplay** outDisplay) {
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block SCShareableContent* content = nil;
        __block NSError* error = nil;
        [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                                                   onScreenWindowsOnly:NO
                                                     completionHandler:^(SCShareableContent* result,
                                                                         NSError* err) {
                                                       content = result;
                                                       error = err;
                                                       dispatch_semaphore_signal(done);
                                                     }];
        if (dispatch_semaphore_wait(done, timeout()) != 0) {
            return Status::error("timed out querying shareable content");
        }
        if (error != nil || content == nil) {
            // The overwhelmingly common cause, so say so rather than making
            // the user decode a CoreGraphics error number.
            return Status::error(
                "cannot enumerate displays: " + describe(error) +
                ". Grant Screen Recording to this binary in System Settings > Privacy & "
                "Security > Screen Recording, then run again.");
        }
        if (content.displays.count == 0) {
            return Status::error("no displays available for capture");
        }

        const CGDirectDisplayID wanted =
            config_.displayId != 0 ? config_.displayId : CGMainDisplayID();
        for (SCDisplay* candidate in content.displays) {
            if (candidate.displayID == wanted) {
                *outDisplay = candidate;
                return Status::ok();
            }
        }
        if (config_.displayId != 0) {
            return Status::error("display " + std::to_string(config_.displayId) + " not found");
        }
        *outDisplay = content.displays.firstObject;
        return Status::ok();
    }

    void reset() {
        stream_ = nil;
        output_ = nil;
        queue_ = nil;
    }

    CaptureConfig config_;
    std::shared_ptr<CaptureSink> sink_;
    SCStream* stream_ = nil;
    DHStreamOutput* output_ = nil;
    dispatch_queue_t queue_ = nil;
    int width_ = 0;
    int height_ = 0;
};

}  // namespace

namespace desktophost {

std::unique_ptr<IScreenCapturer> makeScreenCapturer(const CaptureConfig& config) {
    return std::make_unique<MacScreenCapturer>(config);
}

}  // namespace desktophost
