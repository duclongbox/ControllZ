#include "desktophost/input/keyboard_router.h"

#include "desktophost/input/input_protocol.h"
#include "desktophost/input/key_codes.h"

namespace desktophost {

KeyboardRouter::KeyboardRouter(IInputInjector* injector) : injector_(injector) {}

void KeyboardRouter::handleMessage(std::string_view json) {
    const auto parsed = parseKeyMessage(json);

    std::lock_guard<std::mutex> lock(mutex_);
    if (!parsed) {
        ++stats_.invalidDropped;
        return;
    }
    const KeyMessage& message = *parsed;
    const bool held = held_.count(message.code) != 0;

    if (!message.down) {
        if (!held) {
            ++stats_.orphanReleases;
            return;
        }
        held_.erase(held_.find(message.code));
        injector_->key(message.code, false, false);
        ++stats_.applied;
        return;
    }

    // A second press of a held key is a repeat whatever the sender called it:
    // pressing it "again" without a release in between is not something a
    // keyboard can do, and a fresh press would reset the host's own state for
    // that key (a Mac CapsLock would toggle twice).
    const bool repeat = message.repeat || held;
    if (repeat && isModifierCode(message.code)) {
        // Windows autorepeats a held Shift like any other key. Modifiers have
        // nothing to repeat, and on a Mac each one would be a spurious
        // flags-changed event.
        return;
    }
    if (!injector_->key(message.code, true, repeat)) {
        ++stats_.unmappedDropped;
        return;
    }
    held_.insert(message.code);
    ++stats_.applied;
}

void KeyboardRouter::releaseAllLocked() {
    // Modifiers last, the order a hand lets go in. Releasing Ctrl first would
    // leave a bare letter held for an instant, which a shortcut-watching app
    // can read as the letter being typed.
    for (int pass = 0; pass < 2; ++pass) {
        for (auto it = held_.begin(); it != held_.end();) {
            if (isModifierCode(*it) == (pass == 0)) {
                ++it;
                continue;
            }
            injector_->key(*it, false, false);
            ++stats_.releasedOnReset;
            it = held_.erase(it);
        }
    }
}

void KeyboardRouter::releaseAll() {
    std::lock_guard<std::mutex> lock(mutex_);
    releaseAllLocked();
}

size_t KeyboardRouter::heldCount() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return held_.size();
}

KeyboardRouterStats KeyboardRouter::stats() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return stats_;
}

}  // namespace desktophost
