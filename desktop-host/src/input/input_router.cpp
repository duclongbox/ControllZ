#include "desktophost/input/input_router.h"

#include <cstdio>

#include "desktophost/input/pointer_mapping.h"

namespace desktophost {

InputRouter::InputRouter(IInputInjector* injector, InputRouterConfig config)
    : injector_(injector), config_(config) {}

size_t InputRouter::indexOf(MouseButton button) {
    switch (button) {
        case MouseButton::left:
            return 0;
        case MouseButton::right:
            return 1;
        case MouseButton::middle:
            return 2;
    }
    return 0;
}

bool InputRouter::rateLimited(Clock::time_point now) {
    if (config_.maxMessagesPerSecond <= 0) {
        return false;
    }
    if (now - windowStartedAt_ >= std::chrono::seconds(1)) {
        windowStartedAt_ = now;
        windowCount_ = 0;
    }
    return ++windowCount_ > config_.maxMessagesPerSecond;
}

void InputRouter::rememberPosition(const PointerMessage& message) {
    nx_ = message.nx;
    ny_ = message.ny;
}

ScreenPoint InputRouter::currentPoint() const {
    // Bounds are re-read per event rather than cached at session start, so a
    // resolution change or a monitor being unplugged mid-session re-anchors the
    // next event instead of scaling it against a display that no longer exists.
    return mapToScreen(nx_, ny_, injector_->bounds());
}

void InputRouter::press(MouseButton button, bool down, int clickCount, bool inPlace) {
    if (inPlace) {
        injector_->pressInPlace(button, down, clickCount);
    } else if (down) {
        injector_->buttonDown(currentPoint(), button, clickCount);
    } else {
        injector_->buttonUp(currentPoint(), button, clickCount);
    }
}

void InputRouter::reconcile(uint8_t desired) {
    const uint8_t disagreement = static_cast<uint8_t>((held_ ^ desired) & kMaskAll);
    if (disagreement == 0) {
        return;
    }

    // This is the self-healing half of the design. Every message carries the
    // absolute mask, so a `pointerUp` that never arrived shows up here as "the
    // phone says nothing is held, we think left is" and gets released on the
    // next move — one frame of a stuck button instead of forever.
    const MouseButton buttons[] = {MouseButton::left, MouseButton::right, MouseButton::middle};
    for (MouseButton button : buttons) {
        const uint8_t bit = buttonMask(button);
        if ((disagreement & bit) == 0) {
            continue;
        }
        if ((desired & bit) != 0) {
            press(button, true, 1, relative_);
            held_ = static_cast<uint8_t>(held_ | bit);
        } else {
            press(button, false, 1, relative_);
            held_ = static_cast<uint8_t>(held_ & ~bit);
        }
        ++stats_.repairedButtons;
    }
}

void InputRouter::releaseHeldLocked() {
    if (held_ == 0) {
        return;
    }
    const MouseButton buttons[] = {MouseButton::left, MouseButton::right, MouseButton::middle};
    for (MouseButton button : buttons) {
        const uint8_t bit = buttonMask(button);
        if ((held_ & bit) != 0) {
            press(button, false, 1, relative_);
            held_ = static_cast<uint8_t>(held_ & ~bit);
        }
    }
}

void InputRouter::handleMessage(std::string_view json, Clock::time_point now) {
    const auto parsed = parsePointerMessage(json);

    std::lock_guard<std::mutex> lock(mutex_);
    if (!parsed) {
        ++stats_.invalidDropped;
        return;
    }
    if (rateLimited(now)) {
        ++stats_.rateLimited;
        return;
    }
    lastMessageAt_ = now;

    const PointerMessage& message = *parsed;

    if (message.action == PointerAction::delta) {
        // Deltas commute, so they are not gated against each other: two
        // swapped on the wire add up to the same travel. They are gated
        // against absolute samples, which they do not commute with — a delta
        // from before a mode switch, arriving after the move that re-anchored
        // the cursor, would nudge it off the point the phone just chose.
        // Deltas never advance that gate themselves.
        if (sampleSeen_ && message.seq <= newestSeq_) {
            ++stats_.staleDropped;
            return;
        }
        const DisplayBounds bounds = injector_->bounds();
        reconcile(message.buttons);
        relative_ = true;
        injector_->moveBy(deltaToPixels(message.dx, bounds.width),
                          deltaToPixels(message.dy, bounds.height), held_);
        ++stats_.applied;
        return;
    }

    if (message.action == PointerAction::scroll) {
        // Never stale-dropped. A scroll's delta is distance the user asked
        // for, and deltas commute, so one arriving late is applied late rather
        // than lost. Its *position* is a sample like a move's, though, and
        // only the newest may move the cursor — the same gate a move takes.
        // An in-place scroll has no position to apply: the wheel lands
        // wherever the deltas have left the cursor.
        if (message.inPlace) {
            reconcile(message.buttons);
            injector_->scrollInPlace(message.dx, message.dy);
            ++stats_.applied;
            return;
        }
        if (!sampleSeen_ || message.seq > newestSeq_) {
            sampleSeen_ = true;
            newestSeq_ = message.seq;
            rememberPosition(message);
            relative_ = false;
            reconcile(message.buttons);
            injector_->move(currentPoint(), held_);
        } else {
            ++stats_.staleScrollPositions;
        }
        injector_->scroll(currentPoint(), message.dx, message.dy);
        ++stats_.applied;
        return;
    }

    if (message.action == PointerAction::move) {
        // Moves are idempotent and stale-droppable: losing one costs nothing
        // once the next arrives, and applying an old one would drag the cursor
        // backwards. Note the gate is against the newest sequence number seen
        // from *any* pointer message, not just moves — see below.
        if (sampleSeen_ && message.seq <= newestSeq_) {
            ++stats_.staleDropped;
            return;
        }
        sampleSeen_ = true;
        newestSeq_ = message.seq;

        rememberPosition(message);
        // An absolute move re-anchors the cursor, whatever deltas came before.
        relative_ = false;
        reconcile(message.buttons);
        injector_->move(currentPoint(), held_);
        ++stats_.applied;
        return;
    }

    // Button transitions are gated per button, not by the move rule: a
    // `pointerDown` that arrives after a later move is still a click the user
    // made, and dropping it would silently swallow it.
    const size_t index = indexOf(message.button);
    if (transitionSeen_[index] && message.seq <= transitionSeq_[index]) {
        ++stats_.staleDropped;
        return;
    }
    transitionSeen_[index] = true;
    transitionSeq_[index] = message.seq;

    // But a transition does advance the move gate. Without this, a `buttons: 0`
    // move that was reordered behind a press would reach reconcile() and
    // release the button we just pressed.
    if (!sampleSeen_ || message.seq > newestSeq_) {
        sampleSeen_ = true;
        newestSeq_ = message.seq;
    }

    // An in-place transition leaves the cursor where the deltas put it and
    // carries a position only because the schema requires one; a positioned
    // transition is an absolute sample like a move and re-anchors.
    if (!message.inPlace) {
        rememberPosition(message);
        relative_ = false;
    }
    const uint8_t bit = buttonMask(message.button);
    const bool inPlace = message.inPlace || relative_;

    if (message.action == PointerAction::down) {
        if ((held_ & bit) == 0) {
            press(message.button, true, message.clickCount, inPlace);
            held_ = static_cast<uint8_t>(held_ | bit);
        } else if (!inPlace) {
            // A duplicate press. Moving rather than clicking again is the safe
            // reading: a phantom second click is a destructive edit in a text
            // editor, where a missed one is a tap the user repeats. In place
            // there is nowhere to move to, and nothing to do.
            injector_->move(currentPoint(), held_);
        }
    } else {
        if ((held_ & bit) == 0) {
            // An orphan release: the press was lost or dropped as stale. The
            // user did click, so deliver one rather than nothing — the whole
            // gesture reduces to a click at the release position.
            press(message.button, true, message.clickCount, inPlace);
            held_ = static_cast<uint8_t>(held_ | bit);
            ++stats_.synthesisedPresses;
        }
        press(message.button, false, message.clickCount, inPlace);
        held_ = static_cast<uint8_t>(held_ & ~bit);
    }

    reconcile(message.buttons);
    ++stats_.applied;
}

void InputRouter::tick(Clock::time_point now) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (held_ == 0 || lastMessageAt_.time_since_epoch().count() == 0) {
        return;
    }
    if (now - lastMessageAt_ < config_.deadman) {
        return;
    }

    std::fprintf(stderr, "[input] no samples for %lldms with buttons held — releasing\n",
                 static_cast<long long>(config_.deadman.count()));
    releaseHeldLocked();
    ++stats_.deadmanReleases;
}

void InputRouter::releaseAll() {
    std::lock_guard<std::mutex> lock(mutex_);
    releaseHeldLocked();
    // The next channel starts a fresh sequence stream at 1, which would look
    // like a flood of stale samples against the old numbers.
    sampleSeen_ = false;
    newestSeq_ = 0;
    relative_ = false;
    transitionSeen_.fill(false);
    transitionSeq_.fill(0);
    lastMessageAt_ = {};
}

uint8_t InputRouter::heldButtons() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return held_;
}

InputRouterStats InputRouter::stats() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return stats_;
}

}  // namespace desktophost
