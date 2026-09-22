#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>

#include <limits>

#include "desktophost/input/pointer_mapping.h"

using Catch::Approx;
using desktophost::DisplayBounds;
using desktophost::mapToScreen;

/* Why this is tested at all: the mapping is the one place where "a fraction of
 * the video frame" becomes "a point on a real desktop", and every way of
 * getting it wrong is silent. It lands the cursor somewhere plausible but
 * wrong, and on a multi-monitor desk it lands it on the other screen. */

TEST_CASE("maps the corners of the main display") {
    const DisplayBounds display{0, 0, 1512, 982};

    const auto topLeft = mapToScreen(0.0, 0.0, display);
    CHECK(topLeft.x == Approx(0.0));
    CHECK(topLeft.y == Approx(0.0));

    const auto centre = mapToScreen(0.5, 0.5, display);
    CHECK(centre.x == Approx(756.0));
    CHECK(centre.y == Approx(491.0));
}

TEST_CASE("a secondary display's origin offset is carried through") {
    // CGDisplayBounds puts every display in one global space, so a monitor to
    // the right of the main one starts at its width. Mapping against the
    // captured frame's dimensions instead of these bounds is what puts every
    // click on the wrong monitor.
    const DisplayBounds right{1512, 0, 2560, 1440};

    const auto topLeft = mapToScreen(0.0, 0.0, right);
    CHECK(topLeft.x == Approx(1512.0));
    CHECK(topLeft.y == Approx(0.0));

    const auto centre = mapToScreen(0.5, 0.5, right);
    CHECK(centre.x == Approx(1512.0 + 1280.0));
    CHECK(centre.y == Approx(720.0));
}

TEST_CASE("a display above or left of the main one has a negative origin") {
    const DisplayBounds above{-400, -1080, 1920, 1080};

    const auto centre = mapToScreen(0.5, 0.5, above);
    CHECK(centre.x == Approx(560.0));
    CHECK(centre.y == Approx(-540.0));
}

TEST_CASE("the far edge stays on the captured display") {
    const DisplayBounds display{0, 0, 1512, 982};

    // x == 1512 is the first point of whatever is to the right, or of nothing
    // at all. One point inside keeps an edge swipe on the display the user is
    // looking at — which is how the Dock and the menu bar stay reachable.
    const auto bottomRight = mapToScreen(1.0, 1.0, display);
    CHECK(bottomRight.x < 1512.0);
    CHECK(bottomRight.x > 1510.0);
    CHECK(bottomRight.y < 982.0);
    CHECK(bottomRight.y > 980.0);
}

TEST_CASE("out-of-range input is clamped, not trusted") {
    const DisplayBounds display{0, 0, 1000, 1000};

    // The phone drops letterbox touches before sending, so anything out of
    // range here is float drift or a peer that should not be able to address
    // the whole desktop by sending nx = 12.
    CHECK(mapToScreen(-3.0, 0.5, display).x == Approx(0.0));
    CHECK(mapToScreen(12.0, 0.5, display).x < 1000.0);
    CHECK(mapToScreen(0.5, -0.001, display).y == Approx(0.0));
}

TEST_CASE("degenerate bounds and non-finite coordinates do not produce garbage") {
    CHECK(mapToScreen(0.5, 0.5, DisplayBounds{}).x == Approx(0.0));

    const DisplayBounds display{0, 0, 1000, 1000};
    const double nan = std::numeric_limits<double>::quiet_NaN();
    const auto mapped = mapToScreen(nan, nan, display);
    CHECK(mapped.x == Approx(0.0));
    CHECK(mapped.y == Approx(0.0));
}
