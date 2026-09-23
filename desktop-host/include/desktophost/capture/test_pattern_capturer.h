#pragma once

#include <cstdint>
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
/// The buffers are the same kind the real capturer produces (IOSurface-backed
/// on macOS, D3D11 textures on the shared device on Windows), so the encoder
/// sees the input it will see in production.
std::unique_ptr<IScreenCapturer> makeTestPatternCapturer(const CaptureConfig& config);

/// One synthetic NV12 frame of that same kind, flat grey at a luma level that
/// changes with `index` so consecutive frames are real deltas. For feeding an
/// encoder directly with chosen timestamps, which the capturer (wall-clock
/// timestamps) cannot do. Returns an invalid frame on allocation failure.
PlatformFrame makeTestPatternFrame(int width, int height, int index, int64_t ptsUs);

}  // namespace desktophost
