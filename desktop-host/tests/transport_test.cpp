#include <catch2/catch_test_macros.hpp>

#include <chrono>
#include <condition_variable>
#include <mutex>
#include <set>
#include <string>

#include "desktophost/encode/encoded_frame.h"
#include "desktophost/transport/mdns_candidate.h"
#include "desktophost/transport/peer_connection.h"

using namespace desktophost;

namespace {

/// Gathering host candidates needs no network, so this runs in CI.
PeerConnectionConfig offlineConfig() {
    PeerConnectionConfig config;
    config.iceServers.clear();
    return config;
}

}  // namespace

// The default ICE servers are a networking decision, not an incidental. A STUN
// server on a nonstandard port gathers fine on the network it was written on
// and silently yields no reflexive candidate on a hotspot that permits only
// 3478 — which is how the widely copied ":19302" default wastes an afternoon.
// Pinning the port here stops a well-meaning edit from reintroducing it.
TEST_CASE("the default STUN servers sit on port 3478 across distinct hosts", "[transport]") {
    const PeerConnectionConfig config;

    REQUIRE(config.iceServers.size() >= 3);

    std::set<std::string> hosts;
    for (const std::string& server : config.iceServers) {
        // "stun:<host>:<port>"
        const std::size_t scheme = server.find(':');
        REQUIRE(scheme != std::string::npos);
        const std::size_t port = server.rfind(':');
        REQUIRE(port > scheme);
        CHECK(server.substr(port + 1) == "3478");
        hosts.insert(server.substr(scheme + 1, port - scheme - 1));
    }

    // Distinct operators, so one provider being down cannot stop gathering.
    CHECK(hosts.size() == config.iceServers.size());
}

// The offer is the contract with the browser: get a line of it wrong and the
// phone answers with something the encoder never produces, or silently renders
// nothing. Cheap to assert here, expensive to debug on a phone.
TEST_CASE("the offer advertises send-only H.264 at a level that covers 1080p", "[transport]") {
    auto peer = makePeerConnection(offlineConfig());
    REQUIRE(peer != nullptr);

    std::mutex mutex;
    std::condition_variable ready;
    std::string sdp;
    std::string type;

    PeerConnectionCallbacks callbacks;
    callbacks.onLocalDescription = [&](const std::string& localSdp, const std::string& localType) {
        {
            std::lock_guard<std::mutex> lock(mutex);
            sdp = localSdp;
            type = localType;
        }
        ready.notify_all();
    };

    const Status status = peer->start(std::move(callbacks));
    INFO(status.message());
    REQUIRE(static_cast<bool>(status));

    {
        std::unique_lock<std::mutex> lock(mutex);
        REQUIRE(ready.wait_for(lock, std::chrono::seconds(5), [&] { return !sdp.empty(); }));
    }

    CHECK(type == "offer");
    INFO(sdp);
    CHECK(sdp.find("m=video") != std::string::npos);
    CHECK(sdp.find("H264/90000") != std::string::npos);
    // The desktop never receives media; a recvonly or sendrecv line here would
    // have the phone waiting for a track it must instead publish.
    CHECK(sdp.find("a=sendonly") != std::string::npos);
    // Constrained Baseline 4.1. libdatachannel's default is 3.1, which caps at
    // 720p — a promise this side would break on its first 1080p frame.
    CHECK(sdp.find("profile-level-id=42e029") != std::string::npos);
    CHECK(sdp.find("packetization-mode=1") != std::string::npos);

    peer->close();
}

namespace {

/// Blocks until the offer this side generates arrives, and returns it.
std::string offerFor(const PeerConnectionConfig& config) {
    auto peer = makePeerConnection(config);
    REQUIRE(peer != nullptr);

    std::mutex mutex;
    std::condition_variable ready;
    std::string sdp;

    PeerConnectionCallbacks callbacks;
    callbacks.onLocalDescription = [&](const std::string& localSdp, const std::string&) {
        {
            std::lock_guard<std::mutex> lock(mutex);
            sdp = localSdp;
        }
        ready.notify_all();
    };

    const Status status = peer->start(std::move(callbacks));
    INFO(status.message());
    REQUIRE(static_cast<bool>(status));

    {
        std::unique_lock<std::mutex> lock(mutex);
        REQUIRE(ready.wait_for(lock, std::chrono::seconds(5), [&] { return !sdp.empty(); }));
    }
    peer->close();
    return sdp;
}

}  // namespace

// The input channel has to be in the *offer*. This side offers, and an answerer
// cannot add an m-line the offer did not carry — so a channel created even one
// statement after setLocalDescription() would need a whole second negotiation
// before the phone could send a single tap. That mistake is invisible here and
// looks like "input silently does nothing" on the phone.
TEST_CASE("the offer carries the input DataChannel", "[transport]") {
    const std::string sdp = offerFor(offlineConfig());
    INFO(sdp);

    CHECK(sdp.find("m=application") != std::string::npos);
    CHECK(sdp.find("webrtc-datachannel") != std::string::npos);
    // Same transport as the media: one ICE/DTLS session, bundled.
    CHECK(sdp.find("m=video") != std::string::npos);
}

// --no-input, all the way down to the SDP: a channel the host would only ignore
// is worse than no channel, because the phone would draw a live cursor that
// does nothing.
TEST_CASE("input can be left out of the offer entirely", "[transport]") {
    PeerConnectionConfig config = offlineConfig();
    config.enableInputChannel = false;

    const std::string sdp = offerFor(config);
    INFO(sdp);

    CHECK(sdp.find("m=application") == std::string::npos);
    CHECK(sdp.find("m=video") != std::string::npos);
}

// Frames arrive from the encoder as soon as capture starts, which is long
// before DTLS finishes. Dropping them must be uneventful.
TEST_CASE("frames sent before the track opens are dropped, not fatal", "[transport]") {
    auto peer = makePeerConnection(offlineConfig());
    REQUIRE(peer != nullptr);
    REQUIRE(static_cast<bool>(peer->start({})));

    EncodedFrame frame;
    frame.isKeyframe = true;
    frame.ptsUs = 0;
    frame.annexB = {std::byte{0x00}, std::byte{0x00}, std::byte{0x00}, std::byte{0x01},
                    std::byte{0x65}};

    CHECK_NOTHROW(peer->sendFrame(frame));
    CHECK_NOTHROW(peer->close());
}

// ---------------------------------------------------------------------------
// mDNS candidates
// ---------------------------------------------------------------------------
// The failure this guards, seen with both devices on one home wifi: the phone
// offered "<uuid>.local" for its host candidate, libjuice discarded it, and
// every pair left needed the router to hairpin — so ICE failed with a full
// candidate list on both sides. Resolving the name is what keeps the direct
// path available.

TEST_CASE("an mDNS candidate is rewritten with the resolved address", "[transport]") {
    const std::string candidate =
        "candidate:447675652 1 udp 2113937151 86f9b910-7d59-4a86-a2f6-af2f6c2c44de.local 56268 "
        "typ host generation 0 ufrag gQ8s network-cost 999";

    std::string asked;
    const auto resolved = resolveMdnsCandidate(candidate, [&](const std::string& host) {
        asked = host;
        return "192.168.2.37";
    });

    REQUIRE(resolved.has_value());
    CHECK(asked == "86f9b910-7d59-4a86-a2f6-af2f6c2c44de.local");
    CHECK(*resolved ==
          "candidate:447675652 1 udp 2113937151 192.168.2.37 56268 typ host generation 0 ufrag "
          "gQ8s network-cost 999");
}

TEST_CASE("a numeric candidate is handed on untouched", "[transport]") {
    const std::string candidate =
        "candidate:1 1 UDP 2114977791 192.168.2.24 52345 typ host";

    bool resolverCalled = false;
    const auto resolved = resolveMdnsCandidate(candidate, [&](const std::string&) {
        resolverCalled = true;
        return "10.0.0.1";
    });

    REQUIRE(resolved.has_value());
    CHECK(*resolved == candidate);
    CHECK_FALSE(resolverCalled);
}

// A reflexive candidate carries "raddr 0.0.0.0" further along the line. Only
// the connection address is ever a name, so nothing past field five may move.
TEST_CASE("only the connection address is rewritten", "[transport]") {
    const std::string candidate =
        "candidate:2 1 UDP 1678769919 host.local 63819 typ srflx raddr 0.0.0.0 rport 0";

    const auto resolved =
        resolveMdnsCandidate(candidate, [](const std::string&) { return "192.168.2.37"; });

    REQUIRE(resolved.has_value());
    CHECK(*resolved ==
          "candidate:2 1 UDP 1678769919 192.168.2.37 63819 typ srflx raddr 0.0.0.0 rport 0");
}

// Dropping it is the point: a candidate still naming an unresolvable host
// gives ICE a pair it can only spend its timeout on.
TEST_CASE("an unresolvable mDNS candidate is dropped", "[transport]") {
    const std::string candidate =
        "candidate:447675652 1 udp 2113937151 nothing-here.local 56268 typ host";

    CHECK_FALSE(resolveMdnsCandidate(candidate, [](const std::string&) { return std::string(); })
                    .has_value());
    CHECK_FALSE(resolveMdnsCandidate(candidate, nullptr).has_value());
}

TEST_CASE("a line too short to carry an address is left alone", "[transport]") {
    const std::string candidate = "candidate:1 1 UDP 2114977791";

    const auto resolved =
        resolveMdnsCandidate(candidate, [](const std::string&) { return "192.168.2.37"; });

    REQUIRE(resolved.has_value());
    CHECK(*resolved == candidate);
}
