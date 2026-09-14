#pragma once

#include <functional>
#include <memory>
#include <string>

#include "desktophost/status.h"

namespace desktophost {

struct SignalingConfig {
    /// WebSocket endpoint of the signaling server, e.g. "ws://localhost:8080/ws".
    std::string url = "ws://localhost:8080/ws";

    /// Shown to the phone in the pairing and device screens.
    std::string displayName = "Desktop";

    /// Where the device identity is kept between runs. Without it every start
    /// registers a brand-new device and every phone has to pair again.
    std::string identityPath;
};

/// All callbacks arrive on the WebSocket's thread and must not block.
struct SignalingCallbacks {
    /// First run only: the server issued an identity. Persisted by the client.
    std::function<void(const std::string& deviceId)> onRegistered;

    std::function<void(const std::string& deviceId)> onAuthenticated;

    /// Six-digit code to read out to the phone, with its expiry.
    std::function<void(const std::string& code, const std::string& expiresAt)> onPairCodeIssued;

    /// A phone redeemed the code. Codes are single-use, so pairing another
    /// device needs a fresh one.
    std::function<void(const std::string& peerDeviceId, const std::string& peerDisplayName)>
        onPaired;

    /// A paired phone asked to connect; this side is the offerer.
    std::function<void(const std::string& sessionId, const std::string& peerDeviceId)>
        onSessionStarted;

    std::function<void(const std::string& sessionId, const std::string& sdp)> onSdpAnswer;

    std::function<void(const std::string& sessionId, const std::string& candidate,
                       const std::string& sdpMid)>
        onIceCandidate;

    std::function<void(const std::string& sessionId)> onPeerDisconnected;

    /// A protocol-level refusal from the server (bad credential, rate limit).
    std::function<void(const std::string& code, const std::string& message)> onError;

    std::function<void(const Status&)> onClosed;
};

/// The desktop's half of the signaling protocol in `shared/schemas/`.
///
/// Deliberately message-shaped rather than transport-shaped: callers deal in
/// offers, answers and candidates, never in JSON or sockets.
class ISignalingClient {
public:
    virtual ~ISignalingClient() = default;

    /// Opens the socket and authenticates, registering first if no stored
    /// identity exists. Blocks until the server answers or refuses.
    virtual Status connect(SignalingCallbacks callbacks) = 0;

    /// Asks for a pairing code to show the user. Desktop-only message.
    virtual void requestPairCode() = 0;

    virtual void sendOffer(const std::string& sessionId, const std::string& sdp) = 0;

    virtual void sendIceCandidate(const std::string& sessionId, const std::string& candidate,
                                  const std::string& sdpMid) = 0;

    virtual void close() = 0;
};

std::unique_ptr<ISignalingClient> makeSignalingClient(const SignalingConfig& config);

}  // namespace desktophost
