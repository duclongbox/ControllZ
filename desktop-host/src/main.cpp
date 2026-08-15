#include <rtc/rtc.hpp>

#include <cstdio>

#include "desktophost/version.h"

int main() {
    // Calling into libdatachannel on purpose: an unused dependency proves
    // nothing to the linker, and this is the riskiest dependency in the repo.
    rtc::InitLogger(rtc::LogLevel::Warning);

    std::printf("desktop-host %s (libdatachannel %s)\n", desktophost::version(), RTC_VERSION);
    return 0;
}
