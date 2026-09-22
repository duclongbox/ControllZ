#pragma once

#include <array>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <string_view>

#include "desktophost/input/input_injector.h"
#include "desktophost/input/input_protocol.h"

namespace desktophost {

struct InputRouterConfig {
    /// How long a held button survives silence before the router releases it.
    ///
    /// This is the deadman switch, and it exists because a lost `pointerUp` is
    /// the worst thing this channel can do: a stuck mouse button leaves the
    /// desktop unusable until someone touches the real mouse. The phone sends
    /// the button mask on every move, so a *live* session repairs itself within
    /// one frame; this covers the case where the messages stop entirely.
    std::chrono::milliseconds deadman{1000};

    /// Ceiling on messages acted upon per second. A phone coalescing to one
    /// move per animation frame sends ~120; anything an order of magnitude
    /// above that is a peer flooding us, and injecting it would make the
    /// desktop unusable rather than merely laggy.
    int maxMessagesPerSecond = 600;
};

struct InputRouterStats {
    uint64_t applied = 0;
    /// Reordered past: a move behind the newest sample, or a button transition
    /// behind the newest one for that button. Expected on this channel, not an
    /// error — the count is here to tell "the network reorders" apart from
    /// "our sequencing is wrong".
    uint64_t staleDropped = 0;
    uint64_t invalidDropped = 0;
    uint64_t rateLimited = 0;
    /// Presses invented for a `pointerUp` whose `pointerDown` never arrived.
    uint64_t synthesisedPresses = 0;
    /// Buttons the mask disagreed with us about, released or pressed to match.
    uint64_t repairedButtons = 0;
    uint64_t deadmanReleases = 0;
};

/// Turns input-channel messages into injected pointer events.
///
/// Thread-safe: `handleMessage` runs on libdatachannel's thread while `tick`
/// runs on the main loop, and both mutate the held-button state.
class InputRouter {
public:
    using Clock = std::chrono::steady_clock;

    /// `injector` is borrowed and must outlive the router.
    explicit InputRouter(IInputInjector* injector, InputRouterConfig config = {});

    /// One raw message off the channel.
    void handleMessage(std::string_view json, Clock::time_point now);

    /// Drives the deadman. Cheap enough to call on every pass of the main loop.
    void tick(Clock::time_point now);

    /// Releases everything held and forgets the sequence stream. Call when the
    /// channel closes, the peer leaves, or the session ends — all of which mean
    /// no `pointerUp` is ever coming.
    void releaseAll();

    uint8_t heldButtons() const;
    InputRouterStats stats() const;

private:
    static size_t indexOf(MouseButton button);

    // All of these assume mutex_ is held.
    bool rateLimited(Clock::time_point now);
    void rememberPosition(const PointerMessage& message);
    ScreenPoint currentPoint() const;
    void reconcile(uint8_t desired);
    void releaseHeldLocked();

    IInputInjector* injector_;
    InputRouterConfig config_;

    mutable std::mutex mutex_;

    uint8_t held_ = 0;
    double nx_ = 0;
    double ny_ = 0;

    bool sampleSeen_ = false;
    uint32_t newestSeq_ = 0;
    std::array<bool, 3> transitionSeen_{};
    std::array<uint32_t, 3> transitionSeq_{};

    Clock::time_point lastMessageAt_{};
    Clock::time_point windowStartedAt_{};
    int windowCount_ = 0;

    InputRouterStats stats_{};
};

}  // namespace desktophost
