#include "desktophost/capture/screen_capturer.h"

// Placeholder for platforms without a capture backend yet. The Windows
// implementation (Windows Graphics Capture -> ID3D11Texture2D) lands against
// this same interface; keeping the seam compiling everywhere is what stops
// `core/` from growing platform conditionals.

namespace desktophost {

std::unique_ptr<IScreenCapturer> makeScreenCapturer(const CaptureConfig&) {
    return nullptr;
}

}  // namespace desktophost
