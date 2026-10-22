#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>

namespace desktophost {

/// The handshake between "the OS wants us gone" and "we have let go of the
/// desktop's input".
///
/// Why this exists: the host presses mouse buttons and keys with SendInput,
/// and the OS keeps them pressed until the matching release is injected. The
/// session teardown injects those releases, so the main loop must be allowed
/// to run it before the process dies. Ctrl-C gives it that time for free —
/// the handler sets a flag and the loop notices. Closing the console window
/// on Windows does not: the handler runs on its own thread and the process is
/// terminated the moment it returns, so a flag alone would leave a button or
/// a Shift stuck down with the host gone. The console handler therefore
/// requests the shutdown and then *waits* here, inside Windows' grace period,
/// until main has finished tearing down.
class ShutdownGate {
public:
    /// Ask the main loop to stop. Safe from any thread or a signal handler
    /// (an atomic store, nothing else).
    void request() noexcept { interrupted_.store(true); }

    bool interrupted() const noexcept { return interrupted_.load(); }

    /// Teardown has run; anyone blocked in waitForDone() may return.
    void markDone();

    /// Blocks until markDone() or the timeout. True if teardown finished.
    bool waitForDone(std::chrono::milliseconds timeout);

private:
    std::atomic<bool> interrupted_{false};
    std::mutex mutex_;
    std::condition_variable doneChanged_;
    bool done_ = false;
};

}  // namespace desktophost
