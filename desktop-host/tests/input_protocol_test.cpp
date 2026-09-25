#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>

#include "desktophost/input/input_protocol.h"

using Catch::Approx;
using desktophost::MouseButton;
using desktophost::parsePointerMessage;
using desktophost::PointerAction;

/* The parser's job is to be unsurprised by a remote peer. Everything it rejects
 * is counted by the router rather than acted on, so a rejection has to be a
 * rejection and never a half-applied message. */

TEST_CASE("parses a pointerMove") {
    const auto message = parsePointerMessage(
        R"({"type":"pointerMove","seq":40118,"t":1757030412,"nx":0.6183,"ny":0.4402,"buttons":0})");

    REQUIRE(message.has_value());
    CHECK(message->action == PointerAction::move);
    CHECK(message->seq == 40118u);
    CHECK(message->sentAtMs == 1757030412);
    CHECK(message->nx == Approx(0.6183));
    CHECK(message->ny == Approx(0.4402));
    CHECK(message->buttons == 0);
}

TEST_CASE("parses a double-click pointerDown") {
    const auto message = parsePointerMessage(
        R"({"type":"pointerDown","seq":7,"t":1,"nx":0.5,"ny":0.5,"buttons":1,)"
        R"("button":"left","clickCount":2})");

    REQUIRE(message.has_value());
    CHECK(message->action == PointerAction::down);
    CHECK(message->button == MouseButton::left);
    CHECK(message->clickCount == 2);
    CHECK(message->buttons == 1);
}

TEST_CASE("parses the buttons this milestone does not yet send") {
    // The host translation is generic over the enum, so adding a long-press
    // gesture later is a phone-side change alone. That only holds if the parser
    // accepts them today.
    const auto right = parsePointerMessage(
        R"({"type":"pointerDown","seq":1,"t":1,"nx":0,"ny":0,"buttons":2,)"
        R"("button":"right","clickCount":1})");
    REQUIRE(right.has_value());
    CHECK(right->button == MouseButton::right);

    const auto middle = parsePointerMessage(
        R"({"type":"pointerUp","seq":2,"t":1,"nx":0,"ny":0,"buttons":0,)"
        R"("button":"middle","clickCount":1})");
    REQUIRE(middle.has_value());
    CHECK(middle->button == MouseButton::middle);
}

TEST_CASE("parses a scroll") {
    const auto message = parsePointerMessage(
        R"({"type":"scroll","seq":12,"t":1,"nx":0.25,"ny":0.75,"buttons":0,"dx":-12.5,"dy":100})");

    REQUIRE(message.has_value());
    CHECK(message->action == PointerAction::scroll);
    CHECK(message->nx == Approx(0.25));
    CHECK(message->dx == Approx(-12.5));
    CHECK(message->dy == Approx(100.0));
}

TEST_CASE("a scroll without deltas, or past the bound, is rejected") {
    const char* rejected[] = {
        R"({"type":"scroll","seq":1,"t":1,"nx":0.5,"ny":0.5,"buttons":0,"dy":100})",
        R"({"type":"scroll","seq":1,"t":1,"nx":0.5,"ny":0.5,"buttons":0,"dx":0})",
        R"({"type":"scroll","seq":1,"t":1,"nx":0.5,"ny":0.5,"buttons":0,"dx":0,"dy":"100"})",
        R"({"type":"scroll","seq":1,"t":1,"nx":0.5,"ny":0.5,"buttons":0,"dx":0,"dy":10001})",
        R"({"type":"scroll","seq":1,"t":1,"nx":0.5,"ny":0.5,"buttons":0,"dx":-1e9,"dy":0})",
    };
    for (const char* json : rejected) {
        INFO(json);
        CHECK_FALSE(parsePointerMessage(json).has_value());
    }
}

TEST_CASE("a missing diagnostic timestamp is tolerated") {
    // `t` is never read for ordering — the two clocks are unsynchronised — so a
    // sender that leaves it out still gets its input injected.
    const auto message = parsePointerMessage(
        R"({"type":"pointerMove","seq":3,"nx":0.1,"ny":0.2,"buttons":0})");
    REQUIRE(message.has_value());
    CHECK(message->sentAtMs == 0);
}

TEST_CASE("malformed and hostile messages are rejected") {
    CHECK_FALSE(parsePointerMessage("").has_value());
    CHECK_FALSE(parsePointerMessage("not json").has_value());
    CHECK_FALSE(parsePointerMessage("[]").has_value());
    CHECK_FALSE(parsePointerMessage(R"({"seq":1,"nx":0,"ny":0,"buttons":0})").has_value());

    // A signaling message that somehow reached this channel.
    CHECK_FALSE(parsePointerMessage(R"({"type":"heartbeat"})").has_value());

    // Load-bearing fields missing, wrong type, or out of range.
    CHECK_FALSE(
        parsePointerMessage(R"({"type":"pointerMove","seq":1,"nx":0,"buttons":0})").has_value());
    CHECK_FALSE(
        parsePointerMessage(R"({"type":"pointerMove","seq":1,"nx":"0.5","ny":0,"buttons":0})")
            .has_value());
    CHECK_FALSE(
        parsePointerMessage(R"({"type":"pointerMove","seq":0,"nx":0,"ny":0,"buttons":0})")
            .has_value());
    CHECK_FALSE(
        parsePointerMessage(R"({"type":"pointerMove","seq":1,"nx":0,"ny":0,"buttons":99})")
            .has_value());

    // A button transition with no button, an unknown button, or a click count
    // no gesture can produce.
    CHECK_FALSE(
        parsePointerMessage(R"({"type":"pointerDown","seq":1,"nx":0,"ny":0,"buttons":1})")
            .has_value());
    CHECK_FALSE(parsePointerMessage(
                    R"({"type":"pointerDown","seq":1,"nx":0,"ny":0,"buttons":1,)"
                    R"("button":"pinky","clickCount":1})")
                    .has_value());
    CHECK_FALSE(parsePointerMessage(
                    R"({"type":"pointerDown","seq":1,"nx":0,"ny":0,"buttons":1,)"
                    R"("button":"left","clickCount":9})")
                    .has_value());
}
