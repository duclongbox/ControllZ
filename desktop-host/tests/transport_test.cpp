#include <catch2/catch_test_macros.hpp>

#include <chrono>
#include <condition_variable>
#include <mutex>
#include <string>

#include "desktophost/encode/encoded_frame.h"
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
