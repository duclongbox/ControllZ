#include "desktophost/input/input_protocol.h"

#include <nlohmann/json.hpp>

#include <cmath>
#include <limits>
#include <string>

namespace desktophost {
namespace {

using Json = nlohmann::json;

std::optional<PointerAction> actionFrom(const std::string& type) {
    if (type == "pointerMove") return PointerAction::move;
    if (type == "pointerDown") return PointerAction::down;
    if (type == "pointerUp") return PointerAction::up;
    if (type == "scroll") return PointerAction::scroll;
    return std::nullopt;
}

std::optional<MouseButton> buttonFrom(const std::string& name) {
    if (name == "left") return MouseButton::left;
    if (name == "right") return MouseButton::right;
    if (name == "middle") return MouseButton::middle;
    return std::nullopt;
}

/// Numbers only, and finite. A JSON string carrying digits is a different
/// sender than ours and not worth guessing at.
std::optional<double> number(const Json& parent, const char* key) {
    auto it = parent.find(key);
    if (it == parent.end() || !it->is_number()) {
        return std::nullopt;
    }
    const double value = it->get<double>();
    return std::isfinite(value) ? std::optional<double>(value) : std::nullopt;
}

std::optional<int64_t> integer(const Json& parent, const char* key) {
    auto it = parent.find(key);
    if (it == parent.end() || !it->is_number_integer()) {
        return std::nullopt;
    }
    return it->get<int64_t>();
}

}  // namespace

std::optional<PointerMessage> parsePointerMessage(std::string_view json) {
    // Non-throwing parse: a malformed message from a remote peer is an
    // expected event on this channel, not an exceptional one.
    const Json doc = Json::parse(json, nullptr, false);
    if (doc.is_discarded() || !doc.is_object()) {
        return std::nullopt;
    }

    const auto typeIt = doc.find("type");
    if (typeIt == doc.end() || !typeIt->is_string()) {
        return std::nullopt;
    }
    const auto action = actionFrom(typeIt->get<std::string>());
    if (!action) {
        return std::nullopt;
    }

    const auto seq = integer(doc, "seq");
    const auto nx = number(doc, "nx");
    const auto ny = number(doc, "ny");
    const auto buttons = integer(doc, "buttons");
    if (!seq || !nx || !ny || !buttons) {
        return std::nullopt;
    }
    if (*seq < 1 || *seq > std::numeric_limits<uint32_t>::max()) {
        return std::nullopt;
    }
    if (*buttons < 0 || *buttons > kMaskAll) {
        return std::nullopt;
    }

    PointerMessage message;
    message.action = *action;
    message.seq = static_cast<uint32_t>(*seq);
    message.nx = *nx;
    message.ny = *ny;
    message.buttons = static_cast<uint8_t>(*buttons);
    // `t` is a diagnostic and nothing reads it for ordering, so a sender that
    // omits it still gets its input injected. Every other field is load-bearing
    // and its absence is a rejection.
    message.sentAtMs = integer(doc, "t").value_or(0);

    if (*action == PointerAction::move) {
        return message;
    }

    if (*action == PointerAction::scroll) {
        // The schema's bound. Nothing a wheel produces in one frame comes near
        // it, so a value past it is a sender to refuse, not one to clamp.
        constexpr double kMaxScroll = 10000;
        const auto dx = number(doc, "dx");
        const auto dy = number(doc, "dy");
        if (!dx || !dy || std::fabs(*dx) > kMaxScroll || std::fabs(*dy) > kMaxScroll) {
            return std::nullopt;
        }
        message.dx = *dx;
        message.dy = *dy;
        return message;
    }

    const auto buttonIt = doc.find("button");
    if (buttonIt == doc.end() || !buttonIt->is_string()) {
        return std::nullopt;
    }
    const auto button = buttonFrom(buttonIt->get<std::string>());
    if (!button) {
        return std::nullopt;
    }
    const auto clickCount = integer(doc, "clickCount");
    if (!clickCount || *clickCount < 1 || *clickCount > 3) {
        return std::nullopt;
    }

    message.button = *button;
    message.clickCount = static_cast<int>(*clickCount);
    return message;
}

}  // namespace desktophost
