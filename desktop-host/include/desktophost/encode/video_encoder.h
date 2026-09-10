#pragma once

#include <functional>
#include <memory>

#include "desktophost/capture/platform_frame.h"
#include "desktophost/encode/encoded_frame.h"
#include "desktophost/status.h"

namespace desktophost {

struct EncoderConfig {
    int width = 1920;
    int height = 1080;

    /// Hint used for rate control, not a delivery guarantee.
    int fps = 60;

    int bitrateBps = 8'000'000;

    /// Ceiling over a short window, expressed as a multiple of `bitrateBps`.
    /// This is a latency control, not a bandwidth one: it bounds how large a
    /// single keyframe can get, and a keyframe that arrives as one burst of
    /// hundreds of packets makes the receiver's jitter buffer grow — and it
    /// does not shrink back for the rest of the session.
    double dataRateLimitFactor = 1.5;
    double dataRateWindowSeconds = 1.0;

    /// Deliberately long. Periodic keyframes cost bitrate spikes for no
    /// benefit here; recovery is driven by explicit forceKeyframe() calls
    /// instead (a new viewer joining, or an RTCP PLI once transport exists).
    int keyFrameIntervalFrames = 300;
};

/// Invoked on the encoder's own callback thread. Must not block.
using EncodedFrameCallback = std::function<void(const EncodedFrame&)>;

class IVideoEncoder {
public:
    virtual ~IVideoEncoder() = default;

    virtual Status start(EncodedFrameCallback onEncoded) = 0;

    /// Consumes the frame. Encoding is asynchronous; output arrives on the
    /// callback.
    virtual void encode(PlatformFrame frame) = 0;

    /// Requests that the next encoded frame be an IDR.
    virtual void forceKeyframe() = 0;

    /// Adjusts the target bitrate mid-stream without a keyframe. Unused until
    /// the adaptive-bitrate loop exists; present now because retrofitting it
    /// would mean reopening the encoder session.
    virtual void setBitrate(int bitrateBps) = 0;

    /// Flushes pending frames and tears the session down. Idempotent.
    virtual void stop() = 0;
};

/// Returns the platform backend, or nullptr on a platform without one.
std::unique_ptr<IVideoEncoder> makeVideoEncoder(const EncoderConfig& config);

}  // namespace desktophost
