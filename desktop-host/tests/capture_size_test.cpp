#include <catch2/catch_test_macros.hpp>

#include "desktophost/capture/capture_size.h"

using desktophost::fitWithin;

// Every capture backend sizes its frames through this, and the encoder is
// opened at exactly that size, so a stretched or odd-sized result shows up as
// a distorted picture or an encoder that refuses to start.

TEST_CASE("fitWithin keeps a 16:10 panel's aspect inside a 16:9 box", "[capture]") {
    const auto size = fitWithin(2880, 1800, 1920, 1080);
    CHECK(size.width == 1728);
    CHECK(size.height == 1080);
}

TEST_CASE("fitWithin never upscales", "[capture]") {
    const auto size = fitWithin(1280, 720, 1920, 1080);
    CHECK(size.width == 1280);
    CHECK(size.height == 720);
}

TEST_CASE("fitWithin rounds down to even dimensions", "[capture]") {
    const auto size = fitWithin(1366, 767, 1920, 1080);
    CHECK(size.width % 2 == 0);
    CHECK(size.height % 2 == 0);
    CHECK(size.width == 1366);
    CHECK(size.height == 766);
}

TEST_CASE("fitWithin falls back to the box for an unknown source size", "[capture]") {
    const auto size = fitWithin(0, 0, 1921, 1081);
    CHECK(size.width == 1920);
    CHECK(size.height == 1080);
}
