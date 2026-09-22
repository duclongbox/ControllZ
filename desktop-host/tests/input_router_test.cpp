#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>

#include <chrono>
#include <string>
#include <vector>

#include "desktophost/input/input_router.h"

using Catch::Approx;
using desktophost::DisplayBounds;
using desktophost::InputRouter;
using desktophost::InputRouterConfig;
using desktophost::MouseButton;
using desktophost::ScreenPoint;

/* The router is where the consequences of an unordered, unreliable channel are
 * absorbed, so these tests are mostly about damage: samples arriving backwards,
 * a release that never comes, a press that was dropped. None of it needs a
 * display or an Accessibility grant, which is the reason IInputInjector is a
 * seam at all. */

namespace {

struct Event {
    enum class Kind { move, down, up };

    Kind kind;
    double x = 0;
    double y = 0;
    MouseButton button = MouseButton::left;
    int clickCount = 0;
    uint8_t held = 0;
};

class FakeInjector final : public desktophost::IInputInjector {
public:
    std::vector<Event> events;

    DisplayBounds bounds() const override { return DisplayBounds{0, 0, 1000, 500}; }

    void move(ScreenPoint point, uint8_t heldButtons) override {
        events.push_back(Event{Event::Kind::move, point.x, point.y, MouseButton::left, 0,
                               heldButtons});
    }

    void buttonDown(ScreenPoint point, MouseButton button, int clickCount) override {
        events.push_back(Event{Event::Kind::down, point.x, point.y, button, clickCount, 0});
    }

    void buttonUp(ScreenPoint point, MouseButton button, int clickCount) override {
        events.push_back(Event{Event::Kind::up, point.x, point.y, button, clickCount, 0});
    }

    size_t count(Event::Kind kind) const {
        size_t total = 0;
        for (const Event& event : events) {
            if (event.kind == kind) ++total;
        }
        return total;
    }
};

std::string move(uint32_t seq, double nx, double ny, int buttons = 0) {
    return R"({"type":"pointerMove","seq":)" + std::to_string(seq) + R"(,"t":1,"nx":)" +
           std::to_string(nx) + R"(,"ny":)" + std::to_string(ny) + R"(,"buttons":)" +
           std::to_string(buttons) + "}";
}

std::string button(const char* type, uint32_t seq, double nx, double ny, int buttons,
                   int clickCount = 1, const char* name = "left") {
    return std::string(R"({"type":")") + type + R"(","seq":)" + std::to_string(seq) +
           R"(,"t":1,"nx":)" + std::to_string(nx) + R"(,"ny":)" + std::to_string(ny) +
           R"(,"buttons":)" + std::to_string(buttons) + R"(,"button":")" + name +
           R"(","clickCount":)" + std::to_string(clickCount) + "}";
}

/// Never the zero time_point: the router reads that as "no message yet" and
/// leaves the deadman disarmed.
const InputRouter::Clock::time_point kStart =
    InputRouter::Clock::time_point{} + std::chrono::seconds(10);

}  // namespace

TEST_CASE("a move is injected at the mapped point") {
    FakeInjector injector;
    InputRouter router(&injector);

    router.handleMessage(move(1, 0.5, 0.5), kStart);

    REQUIRE(injector.events.size() == 1);
    CHECK(injector.events[0].kind == Event::Kind::move);
    CHECK(injector.events[0].x == Approx(500.0));
    CHECK(injector.events[0].y == Approx(250.0));
    CHECK(router.stats().applied == 1);
}

TEST_CASE("a move that arrives behind a newer one is dropped") {
    FakeInjector injector;
    InputRouter router(&injector);

    router.handleMessage(move(5, 0.8, 0.8), kStart);
    router.handleMessage(move(4, 0.1, 0.1), kStart);

    // Applying it would drag the cursor backwards to a position the finger has
    // already left — the reason the channel may reorder but the cursor may not.
    REQUIRE(injector.events.size() == 1);
    CHECK(injector.events[0].x == Approx(800.0));
    CHECK(router.stats().staleDropped == 1);
}

TEST_CASE("a move reordered behind a press cannot release the button") {
    FakeInjector injector;
    InputRouter router(&injector);

    router.handleMessage(button("pointerDown", 10, 0.5, 0.5, 1), kStart);
    // Sent before the press, arriving after it, and carrying buttons: 0. Its
    // mask is a snapshot of a moment that has passed; honouring it would
    // release the button the user is holding right now.
    router.handleMessage(move(9, 0.6, 0.6, 0), kStart);

    CHECK(router.heldButtons() == desktophost::kMaskLeft);
    CHECK(injector.count(Event::Kind::up) == 0);
    CHECK(router.stats().staleDropped == 1);
}

TEST_CASE("a press that arrives after a later move is still a click") {
    FakeInjector injector;
    InputRouter router(&injector);

    router.handleMessage(move(10, 0.5, 0.5), kStart);
    // Gated per button, not by the move rule: this is a click the user made,
    // and dropping it as "stale" would silently swallow it.
    router.handleMessage(button("pointerDown", 9, 0.5, 0.5, 1), kStart);

    CHECK(injector.count(Event::Kind::down) == 1);
    CHECK(router.heldButtons() == desktophost::kMaskLeft);
}

TEST_CASE("a lost release is repaired by the next move's button mask") {
    FakeInjector injector;
    InputRouter router(&injector);

    router.handleMessage(button("pointerDown", 1, 0.5, 0.5, 1), kStart);
    // The pointerUp is lost outright. The next move disagrees about what is
    // held, and that disagreement is the repair — one frame of a stuck button
    // instead of a desktop nobody can use.
    router.handleMessage(move(3, 0.6, 0.6, 0), kStart);

    CHECK(router.heldButtons() == 0);
    CHECK(injector.count(Event::Kind::up) == 1);
    CHECK(router.stats().repairedButtons == 1);
}

TEST_CASE("a release whose press never arrived still delivers a click") {
    FakeInjector injector;
    InputRouter router(&injector);

    router.handleMessage(button("pointerUp", 4, 0.25, 0.5, 0), kStart);

    // The user did tap. A press invented at the release position turns the lost
    // packet into a click in the right place rather than nothing at all.
    REQUIRE(injector.events.size() == 2);
    CHECK(injector.events[0].kind == Event::Kind::down);
    CHECK(injector.events[1].kind == Event::Kind::up);
    CHECK(injector.events[0].x == Approx(250.0));
    CHECK(router.stats().synthesisedPresses == 1);
    CHECK(router.heldButtons() == 0);
}

TEST_CASE("a duplicated press does not become a second click") {
    FakeInjector injector;
    InputRouter router(&injector);

    router.handleMessage(button("pointerDown", 1, 0.5, 0.5, 1), kStart);
    router.handleMessage(button("pointerDown", 2, 0.5, 0.5, 1), kStart);

    // A phantom click is a destructive edit in a text editor; a missed one is a
    // tap the user repeats. So a duplicate press moves instead of clicking.
    CHECK(injector.count(Event::Kind::down) == 1);
    CHECK(injector.count(Event::Kind::move) == 1);
}

TEST_CASE("clickCount rides through untouched, which is what makes a double-click") {
    FakeInjector injector;
    InputRouter router(&injector);

    router.handleMessage(button("pointerDown", 1, 0.5, 0.5, 1, 2), kStart);
    router.handleMessage(button("pointerUp", 2, 0.5, 0.5, 0, 2), kStart);

    REQUIRE(injector.events.size() == 2);
    CHECK(injector.events[0].clickCount == 2);
    CHECK(injector.events[1].clickCount == 2);
}

TEST_CASE("a move while a button is held is reported as a drag") {
    FakeInjector injector;
    InputRouter router(&injector);

    router.handleMessage(button("pointerDown", 1, 0.2, 0.2, 1), kStart);
    router.handleMessage(move(2, 0.4, 0.4, 1), kStart);

    // The backend needs the mask to pick a dragged event over a moved one;
    // getting it wrong is the "selection never extends" class of bug.
    const Event& moved = injector.events.back();
    CHECK(moved.kind == Event::Kind::move);
    CHECK(moved.held == desktophost::kMaskLeft);
}

TEST_CASE("the deadman releases a held button once the samples stop") {
    FakeInjector injector;
    InputRouterConfig config;
    config.deadman = std::chrono::milliseconds(500);
    InputRouter router(&injector, config);

    router.handleMessage(button("pointerDown", 1, 0.5, 0.5, 1), kStart);

    router.tick(kStart + std::chrono::milliseconds(400));
    CHECK(router.heldButtons() == desktophost::kMaskLeft);

    // Nothing is coming to repair against — the phone locked, or the link died
    // mid-drag. Let go rather than leaving the desk unusable.
    router.tick(kStart + std::chrono::milliseconds(600));
    CHECK(router.heldButtons() == 0);
    CHECK(injector.count(Event::Kind::up) == 1);
    CHECK(router.stats().deadmanReleases == 1);
}

TEST_CASE("the deadman stays disarmed when nothing is held") {
    FakeInjector injector;
    InputRouter router(&injector);

    router.handleMessage(move(1, 0.5, 0.5), kStart);
    router.tick(kStart + std::chrono::seconds(30));

    CHECK(injector.count(Event::Kind::up) == 0);
    CHECK(router.stats().deadmanReleases == 0);
}

TEST_CASE("releaseAll lets go and forgets the sequence stream") {
    FakeInjector injector;
    InputRouter router(&injector);

    router.handleMessage(button("pointerDown", 900, 0.5, 0.5, 1), kStart);
    router.releaseAll();

    CHECK(router.heldButtons() == 0);
    CHECK(injector.count(Event::Kind::up) == 1);

    // A reconnect starts numbering at 1 again. Measured against the old stream
    // every sample would look stale, and the session would come back with a
    // cursor that never moves.
    router.handleMessage(move(1, 0.75, 0.5), kStart + std::chrono::seconds(1));
    CHECK(injector.events.back().kind == Event::Kind::move);
    CHECK(injector.events.back().x == Approx(750.0));
}

TEST_CASE("a flood is capped instead of injected") {
    FakeInjector injector;
    InputRouterConfig config;
    config.maxMessagesPerSecond = 10;
    InputRouter router(&injector, config);

    for (uint32_t seq = 1; seq <= 40; ++seq) {
        router.handleMessage(move(seq, 0.5, 0.5), kStart);
    }

    CHECK(injector.events.size() == 10);
    CHECK(router.stats().rateLimited == 30);

    // The next window opens normally: a peer that briefly overshot is throttled,
    // not disconnected.
    router.handleMessage(move(41, 0.5, 0.5), kStart + std::chrono::seconds(2));
    CHECK(injector.events.size() == 11);
}

TEST_CASE("unparseable messages are counted, never guessed at") {
    FakeInjector injector;
    InputRouter router(&injector);

    router.handleMessage("{", kStart);
    router.handleMessage(R"({"type":"pointerMove","seq":1})", kStart);
    router.handleMessage(R"({"type":"keyDown","code":"KeyA"})", kStart);

    CHECK(injector.events.empty());
    CHECK(router.stats().invalidDropped == 3);
    CHECK(router.stats().applied == 0);
}
