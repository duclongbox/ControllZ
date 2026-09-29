#pragma once

#include <cstdint>
#include <mutex>
#include <set>
#include <string>
#include <string_view>

#include "desktophost/input/input_injector.h"

namespace desktophost {

struct KeyboardRouterStats {
    uint64_t applied = 0;
    uint64_t invalidDropped = 0;
    /// A key the host has no equivalent for (F21 on a Mac, say). Counted so a
    /// "that key does nothing" report can be told apart from a lost message.
    uint64_t unmappedDropped = 0;
    /// A keyUp for a key not held — most often one the sender already
    /// released when its window lost focus. Harmless, and counted only so it
    /// is visible.
    uint64_t orphanReleases = 0;
    uint64_t releasedOnReset = 0;
};

/// Turns `keys`-channel messages into injected key events.
///
/// Deliberately simpler than InputRouter. That one absorbs an unordered,
/// lossy channel; this one sits on an ordered, reliable one, so every message
/// is applied as it comes and there is no sequencing or repair. The one job
/// left is remembering what is held, so a session that ends mid-keystroke
/// does not leave a key down on the desktop.
///
/// There is no deadman, on purpose. Holding Shift while working the mouse
/// sends no key messages at all for as long as the user likes, and a timer
/// would release it under them. Silence here means "still held"; a dead
/// channel is reported by the channel closing, and the phone releases
/// everything itself when its window loses focus.
///
/// Thread-safe: messages arrive on libdatachannel's thread, releaseAll() from
/// whichever thread tears the session down.
class KeyboardRouter {
public:
    /// `injector` is borrowed and must outlive the router.
    explicit KeyboardRouter(IInputInjector* injector);

    void handleMessage(std::string_view json);

    /// Releases every held key. Call when the channel closes or the session
    /// ends — no keyUp is coming for any of them.
    void releaseAll();

    size_t heldCount() const;
    KeyboardRouterStats stats() const;

private:
    void releaseAllLocked();

    IInputInjector* injector_;
    mutable std::mutex mutex_;
    std::set<std::string, std::less<>> held_;
    KeyboardRouterStats stats_{};
};

}  // namespace desktophost
