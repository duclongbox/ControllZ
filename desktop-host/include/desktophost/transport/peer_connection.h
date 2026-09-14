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
    /// needed when the peers are not on the same network. TURN arrives with
    /// the relay work — until then a symmetric-NAT pair simply fails.
    std::vector<std::string> iceServers = {"stun:stun.l.google.com:19302"};

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
};

/// One WebRTC session to one viewer. Send-only video; the input DataChannel
/// joins this interface when input lands.
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
