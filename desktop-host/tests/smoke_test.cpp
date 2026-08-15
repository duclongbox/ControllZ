#include <catch2/catch_test_macros.hpp>

#include <rtc/rtc.hpp>

#include <string>

#include "desktophost/version.h"

TEST_CASE("version is reported", "[smoke]") {
    REQUIRE(std::string(desktophost::version()) == "0.1.0");
}

// M0's real assertion: libdatachannel is linked and usable, not merely fetched.
// RTC_VERSION alone is a compile-time macro and would prove nothing, so call a
// symbol that has to resolve at link time.
TEST_CASE("libdatachannel is linked", "[smoke]") {
    REQUIRE_NOTHROW(rtc::InitLogger(rtc::LogLevel::None));
    REQUIRE(std::string(RTC_VERSION) == "0.24.5");
}
