#include "desktophost/input/input_injector.h"

namespace desktophost {

/// Keeps the seam compiling where no backend has landed yet. The Windows
/// implementation (SendInput) replaces this file the way the capture and encode
/// backends do.
std::unique_ptr<IInputInjector> makeInputInjector(uint32_t) { return nullptr; }

bool inputInjectionPermitted(bool) { return false; }

}  // namespace desktophost
