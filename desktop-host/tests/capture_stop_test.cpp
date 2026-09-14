#include <catch2/catch_test_macros.hpp>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <thread>

#include "desktophost/capture/screen_capturer.h"
#include "desktophost/capture/test_pattern_capturer.h"

using namespace desktophost;

namespace {

/// The IScreenCapturer contract that makes teardown safe: once stop() returns,
/// no frame callback is running or will run. Callers tear the encoder down
/// right after, so a callback still inside encode() at that point is a
/// use-after-free.
void checkStopWaitsForInFlightCallback(IScreenCapturer& capturer) {
    std::atomic<bool> inCallback{false};
    std::atomic<int> completedCallbacks{0};
    std::mutex mutex;
    std::condition_variable entered;
    bool sawCallback = false;

    const Status status = capturer.start(
        [&](PlatformFrame) {
            inCallback.store(true);
            {
                std::lock_guard<std::mutex> lock(mutex);
                sawCallback = true;
            }
            entered.notify_all();
            // Long enough that a stop() which does not wait returns first.
            std::this_thread::sleep_for(std::chrono::seconds(1));
            completedCallbacks.fetch_add(1);
            inCallback.store(false);
        },
        [](const Status&) {});
    INFO(status.message());
    REQUIRE(static_cast<bool>(status));

    {
        std::unique_lock<std::mutex> lock(mutex);
        REQUIRE(entered.wait_for(lock, std::chrono::seconds(10), [&] { return sawCallback; }));
    }

    capturer.stop();
    CHECK_FALSE(inCallback.load());

    const int afterStop = completedCallbacks.load();
    std::this_thread::sleep_for(std::chrono::milliseconds(1500));
    CHECK(completedCallbacks.load() == afterStop);
}

CaptureConfig smallConfig() {
    CaptureConfig config;
    config.maxWidth = 320;
    config.maxHeight = 240;
    config.maxFps = 30;
    return config;
}

}  // namespace

TEST_CASE("test pattern capturer stop() waits for an in-flight callback", "[capture]") {
    auto capturer = makeTestPatternCapturer(smallConfig());
    REQUIRE(capturer != nullptr);
    checkStopWaitsForInFlightCallback(*capturer);
}

// Hidden: needs the Screen Recording grant, which no CI runner has. Run it from
// a terminal that holds the grant with `desktophost_tests "[screen]"`.
TEST_CASE("ScreenCaptureKit capturer stop() waits for an in-flight callback", "[.][screen]") {
    auto capturer = makeScreenCapturer(smallConfig());
    REQUIRE(capturer != nullptr);
    checkStopWaitsForInFlightCallback(*capturer);
}
