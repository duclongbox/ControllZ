#pragma once

#include <cstdint>

#include "desktophost/input/input_injector.h"

namespace desktophost {

/// Maps a normalised frame coordinate (0…1, see docs/ui-spec.md §4) onto a
/// point in the OS's global display space.
///
/// Out-of-range input is clamped rather than rejected: the phone already drops
/// letterbox-bar touches, so anything outside 0…1 arriving here is either
/// float drift on an edge touch or a peer we should not be trusting to stay in
/// range. Clamping keeps a hostile peer inside the captured display instead of
/// letting it address the whole desktop.
ScreenPoint mapToScreen(double nx, double ny, const DisplayBounds& bounds);

/// Converts one axis of a global-space point to the 0…65535 range Windows
/// `SendInput` takes with `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK`,
/// where 0 is the virtual desktop's first pixel and 65535 its last.
///
/// Platform-free so it can be tested: the naive `x * 65535 / extent` lands a
/// pixel short on part of the range, because Windows maps back by truncating
/// `n * extent / 65536`. Rounding up here is what makes every pixel reachable,
/// which matters most at a monitor edge, where "one short" is the neighbouring
/// monitor. `origin` is SM_XVIRTUALSCREEN (or Y) and is negative whenever a
/// monitor sits left of or above the primary one.
int32_t toAbsoluteInput(double coordinate, double origin, double extent);

}  // namespace desktophost
