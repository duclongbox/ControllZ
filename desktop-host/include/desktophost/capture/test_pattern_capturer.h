#pragma once

#include <memory>

#include "desktophost/capture/screen_capturer.h"

namespace desktophost {

/// A synthetic IScreenCapturer producing an animated NV12 test pattern.
///
/// Exists because the real capture path cannot be exercised automatically:
/// macOS Screen Recording is a user grant, and no CI runner will ever give it.
/// Without a frame source that needs no permission, the encoder and the
/// AVCC->Annex-B conversion would only ever be tested by hand. It is also the
/// fastest way to tell a capture problem apart from an encode problem when the
/// output looks wrong.
///
/// The buffers are IOSurface-backed like the real ones, so the encoder sees the
/// same kind of input it will see in production.
std::unique_ptr<IScreenCapturer> makeTestPatternCapturer(const CaptureConfig& config);

}  // namespace desktophost
