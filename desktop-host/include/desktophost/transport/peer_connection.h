#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "desktophost/encode/encoded_frame.h"
#include "desktophost/status.h"

namespace desktophost {

struct PeerConnectionConfig {
    /// ICE servers, in libdatachannel URL form ("stun:host:port"). Host
    /// candidates are gathered regardless; STUN only adds the reflexive ones
    /// needed when the peers are not on the same network.
    ///
    /// Three independent operators, all on port 3478. Restrictive networks
    /// commonly permit the registered STUN port and drop the rest, so the
    /// widely copied "stun.l.google.com:19302" is unreachable on a fair
    /// number of public hotspots while that same host answers on :3478.
    /// Listing several vendors also survives any one of them going down.
    ///
    /// Still unsolved: a network that blocks UDP wholesale, and a pair where
    /// either side is behind a symmetric NAT. Both need a TURN relay, which
    /// is not implemented — no TURN credentials are issued by the signaling
    /// server yet, so those sessions fail rather than relaying. See
    /// docs/system-design.md §2.2.
    std::vector<std::string> iceServers = {
        "stun:stun.cloudflare.com:3478",
        "stun:stun.l.google.com:3478",
        "stun:global.stun.twilio.com:3478",
    };

    /// Dynamic payload type carried in the offer for H.264.
    int payloadType = 96;

    /// Constrained Baseline, level 4.1 — the profile VideoToolbox is told to
    /// produce, at a level that actually covers 1080p. libdatachannel's own
    /// default says level 3.1, which tops out at 720p and would be a promise
    /// this side breaks on the first frame.
    std::string h264Profile =
        "profile-level-id=42e029;packetization-mode=1;level-asymmetry-allowed=1";

    /// Advertised in the SDP as a hint to the receiver. The real rate control
    /// is the encoder's; this does not throttle anything locally.
    int bitrateKbps = 8000;

    /// Offer an input DataChannel alongside the video track.
    ///
    /// The channel has to be created before the offer is generated: this side
    /// is the offerer, and an answerer cannot add an m-line the offer did not
    /// carry, so the phone receiving it via `ondatachannel` is the only way to
    /// get one without a second negotiation round-trip. False leaves the SCTP
    /// m-line out entirely, which is what `--no-input` wants — a host that
    /// streams but cannot be controlled.
    bool enableInputChannel = true;

    /// Channel label, matched by the phone. See shared/schemas/input/.
    std::string inputChannelLabel = "input";
};

enum class PeerState { connecting, connected, disconnected, failed, closed };

/// All callbacks arrive on libdatachannel's own threads and must not block.
struct PeerConnectionCallbacks {
    /// The offer this side generated, ready to hand to signaling.
    std::function<void(const std::string& sdp, const std::string& type)> onLocalDescription;

    /// One gathered ICE candidate. Trickled as they appear rather than waiting
    /// for gathering to finish, which is what keeps setup latency low.
    std::function<void(const std::string& candidate, const std::string& mid)> onLocalCandidate;

    std::function<void(PeerState)> onStateChange;

    /// The receiver lost enough that it cannot decode until it gets an intra
    /// frame (RTCP PLI or FIR). This is the entire recovery mechanism: the
    /// encoder sends no periodic keyframes, so ignoring this leaves the viewer
    /// frozen until the next explicit one.
    std::function<void()> onKeyframeRequest;

    /// One message from the phone on the input channel, still unparsed —
    /// transport does not know what input looks like. Unordered and
    /// unreliable, so these arrive out of order and with gaps by design.
    std::function<void(std::string message)> onInputMessage;

    /// The input channel closed while the session is otherwise alive. No
    /// further `pointerUp` can arrive, so whatever is held has to be released
    /// here or the desktop is left with a stuck mouse button.
    std::function<void()> onInputChannelClosed;
};

/// One WebRTC session to one viewer: send-only video out, input messages in.
class IPeerConnection {
public:
    virtual ~IPeerConnection() = default;

    /// Adds the video track and generates the offer. `onLocalDescription`
    /// fires before this returns or shortly after.
    virtual Status start(PeerConnectionCallbacks callbacks) = 0;

    /// The viewer's answer.
    virtual void setRemoteDescription(const std::string& sdp, const std::string& type) = 0;

    virtual void addRemoteCandidate(const std::string& candidate, const std::string& mid) = 0;

    /// Packetizes one encoded frame into RTP and sends it. Frames handed over
    /// before the track opens are dropped rather than queued: this is live
    /// video, and a backlog delivered late is worse than a gap.
    virtual void sendFrame(const EncodedFrame& frame) = 0;

    virtual void close() = 0;
};

std::unique_ptr<IPeerConnection> makePeerConnection(const PeerConnectionConfig& config);

}  // namespace desktophost
