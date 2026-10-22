#include <catch2/catch_test_macros.hpp>

#include <chrono>
#include <thread>

#include "desktophost/shutdown_gate.h"

using desktophost::ShutdownGate;
using namespace std::chrono_literals;

/* Why this is tested: the gate is what stands between "the user closed the
 * host window" and "a mouse button is stuck down on their desktop". The
 * console handler blocks on it while main tears the session down, so it has
 * to wake promptly when teardown finishes and give up on its own when it
 * does not — Windows kills the process once the handler returns either way,
 * and kills it regardless after a few seconds. */

TEST_CASE("a request is visible to the main loop") {
    ShutdownGate gate;
    CHECK_FALSE(gate.interrupted());
    gate.request();
    CHECK(gate.interrupted());
}

TEST_CASE("waiting on a gate that is already done returns at once") {
    ShutdownGate gate;
    gate.markDone();
    const auto started = std::chrono::steady_clock::now();
    CHECK(gate.waitForDone(5s));
    CHECK(std::chrono::steady_clock::now() - started < 1s);
}

TEST_CASE("the wait gives up at the timeout when teardown never finishes") {
    ShutdownGate gate;
    const auto started = std::chrono::steady_clock::now();
    CHECK_FALSE(gate.waitForDone(50ms));
    CHECK(std::chrono::steady_clock::now() - started >= 50ms);
}

TEST_CASE("the wait wakes when another thread marks teardown done") {
    ShutdownGate gate;
    std::thread mainLoop([&gate] {
        // Stand-in for the serve loop: notice the request, tear down, report.
        while (!gate.interrupted()) {
            std::this_thread::sleep_for(1ms);
        }
        gate.markDone();
    });

    // Stand-in for the console handler's thread.
    gate.request();
    CHECK(gate.waitForDone(5s));
    mainLoop.join();
}
