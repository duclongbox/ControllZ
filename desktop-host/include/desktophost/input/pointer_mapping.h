#pragma once

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

}  // namespace desktophost
