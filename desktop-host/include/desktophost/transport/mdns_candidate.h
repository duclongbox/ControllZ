#pragma once

#include <functional>
#include <optional>
#include <string>

namespace desktophost {

/// Resolves a hostname to a numeric address, or returns empty on failure.
using HostResolver = std::function<std::string(const std::string& host)>;

/// The system resolver. `.local` names go to mDNSResponder on macOS and to the
/// DNS Client service's built-in mDNS resolver on Windows 10+.
///
/// Blocks for as long as resolution takes, so callers on a thread that must
/// stay responsive — the signaling socket's, for one — hand this to a worker.
std::string resolveHostAddress(const std::string& host);

/// Rewrites an ICE candidate whose connection address is an mDNS `.local`
/// name so it carries the resolved numeric address instead.
///
/// Browsers replace the local IP of a host candidate with a random
/// `<uuid>.local` name, to stop a page fingerprinting the network it sits on.
/// libjuice resolves candidates with `AI_NUMERICHOST` and so discards every
/// one of them, which costs this side its only same-network path: the peers
/// share a public address, and sending to it means asking the router to
/// hairpin, which home routers generally refuse. Resolving the name here puts
/// that path back.
///
/// Returns the candidate to use — the original when there is no `.local` name
/// to resolve — or `std::nullopt` when a name is present but unresolvable, in
/// which case there is nothing worth handing to ICE.
std::optional<std::string> resolveMdnsCandidate(const std::string& candidate,
                                                const HostResolver& resolve);

}  // namespace desktophost
