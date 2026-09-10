#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <string>

#include "desktophost/capture/platform_frame.h"
#include "desktophost/status.h"

namespace desktophost {

struct CaptureConfig {
    /// Native display identifier, or 0 for the main display.
    uint32_t displayId = 0;

    /// Upper bound on the captured resolution. The real capture size preserves
    /// the display's aspect ratio inside this box (a 16:10 laptop panel forced
    /// to exactly 1920x1080 would be stretched), rounded to even dimensions
    /// because H.264 4:2:0 chroma is subsampled by two.
    int maxWidth = 1920;
    int maxHeight = 1080;

    /// Ceiling, not a guarantee: no frames are delivered while the screen is
    /// static.
    int maxFps = 60;

    /// Composite the mouse cursor into the frame. Free here, and the only
    /// cursor story until input exists — drawing the cursor client-side to
    /// decouple it from video latency is an M2 refinement.
    bool showsCursor = true;
};

/// Invoked on the capture backend's own queue. Must not block: on macOS a slow
/// handler silently drops frames rather than applying back-pressure.
using FrameCallback = std::function<void(PlatformFrame)>;

/// Invoked when capture fails after start() has already returned.
using CaptureErrorCallback = std::function<void(const Status&)>;

class IScreenCapturer {
public:
    virtual ~IScreenCapturer() = default;

    /// Blocks until the platform confirms capture started or refused, so that
    /// permission denial is reported here rather than as silent black frames.
    virtual Status start(FrameCallback onFrame, CaptureErrorCallback onError) = 0;

    /// Idempotent. After it returns, no further callbacks are delivered.
    virtual void stop() = 0;

    /// Actual capture dimensions, valid once start() has succeeded.
    virtual int width() const = 0;
    virtual int height() const = 0;
};

/// Returns the platform backend, or nullptr on a platform without one.
std::unique_ptr<IScreenCapturer> makeScreenCapturer(const CaptureConfig& config);

}  // namespace desktophost
