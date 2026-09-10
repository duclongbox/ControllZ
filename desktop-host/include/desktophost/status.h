#pragma once

#include <string>
#include <utility>

namespace desktophost {

/// Minimal success-or-message result.
///
/// Deliberately not exceptions: capture and encode failures surface from
/// platform callbacks on threads we don't own, so the same type has to work
/// for both synchronous setup errors and asynchronous ones. Permission denial
/// (macOS Screen Recording) is the case this exists for — it is an expected
/// outcome, not an exceptional one.
class Status {
public:
    Status() = default;

    static Status ok() { return Status{}; }
    static Status error(std::string message) { return Status{std::move(message)}; }

    /// True when the operation succeeded.
    explicit operator bool() const { return message_.empty(); }

    bool failed() const { return !message_.empty(); }
    const std::string& message() const { return message_; }

private:
    explicit Status(std::string message) : message_(std::move(message)) {}

    std::string message_;
};

}  // namespace desktophost
