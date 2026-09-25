#pragma once

#include <cstdint>
#include <optional>
#include <string_view>

#include "desktophost/input/input_injector.h"

namespace desktophost {

enum class PointerAction { move, down, up, scroll };

/// One parsed message from `shared/schemas/input/`.
///
/// Every field is absolute: the position the event happened at, and the full
/// button mask as of that event. Nothing here is a delta, so no message
/// depends on another having arrived — which is the only way to survive an
/// unordered, unreliable channel.
struct PointerMessage {
    PointerAction action = PointerAction::move;

    /// Monotonic across *all* pointer messages on the channel, not per type.
    /// The router relies on that: a move older than the newest button
    /// transition has to be droppable, or a late `buttons: 0` move undoes a
    /// press that already happened.
    uint32_t seq = 0;

    /// Sender's `Date.now()`. Diagnostics only — the clocks are unsynchronised,
    /// so this must never be used for ordering.
    int64_t sentAtMs = 0;

    double nx = 0;
    double ny = 0;

    /// Buttons held after this event.
    uint8_t buttons = 0;

    /// Meaningful for `down` and `up`; left alone for a move.
    MouseButton button = MouseButton::left;

    /// 1 single, 2 double, 3 triple. Decided by the phone.
    int clickCount = 1;

    /// `scroll` only: the sender's CSS pixels, DOM signs (positive dy scrolls
    /// down), one wheel notch = 100. The one delta on the channel — see
    /// `shared/schemas/input/scroll.schema.json` for why that is safe.
    double dx = 0;
    double dy = 0;
};

/// Parses one input-channel message. Returns nullopt for anything malformed,
/// unknown, or out of range — a remote peer is untrusted input, and the router
/// counts a rejection rather than acting on a guess.
std::optional<PointerMessage> parsePointerMessage(std::string_view json);

}  // namespace desktophost
