#include "desktophost/shutdown_gate.h"

namespace desktophost {

void ShutdownGate::markDone() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        done_ = true;
    }
    doneChanged_.notify_all();
}

bool ShutdownGate::waitForDone(std::chrono::milliseconds timeout) {
    std::unique_lock<std::mutex> lock(mutex_);
    return doneChanged_.wait_for(lock, timeout, [this] { return done_; });
}

}  // namespace desktophost
