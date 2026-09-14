#include "desktophost/transport/peer_connection.h"

#include <rtc/rtc.hpp>

#include <cstdint>
#include <cstdio>
#include <exception>
#include <memory>
#include <mutex>
#include <optional>
#include <random>
#include <string>
#include <utility>

namespace desktophost {
namespace {

/// H.264 RTP always runs on a 90 kHz clock (RFC 6184).
constexpr uint32_t kClockRate = 90'000;

PeerState toPeerState(rtc::PeerConnection::State state) {
    switch (state) {
        case rtc::PeerConnection::State::New:
        case rtc::PeerConnection::State::Connecting:
            return PeerState::connecting;
        case rtc::PeerConnection::State::Connected:
            return PeerState::connected;
        case rtc::PeerConnection::State::Disconnected:
            return PeerState::disconnected;
        case rtc::PeerConnection::State::Failed:
            return PeerState::failed;
        case rtc::PeerConnection::State::Closed:
            return PeerState::closed;
    }
    return PeerState::closed;
}

uint32_t randomSsrc() {
    std::random_device device;
    std::uniform_int_distribution<uint32_t> distribution(1, 0xFFFFFFFEu);
    return distribution(device);
}

class RtcPeerConnection final : public IPeerConnection {
public:
    explicit RtcPeerConnection(const PeerConnectionConfig& config) : config_(config) {}

    ~RtcPeerConnection() override { close(); }

    Status start(PeerConnectionCallbacks callbacks) override {
        if (pc_ != nullptr) {
            return Status::error("peer connection already started");
        }
        callbacks_ = std::move(callbacks);

        rtc::Configuration rtcConfig;
        for (const std::string& server : config_.iceServers) {
            try {
                rtcConfig.iceServers.emplace_back(server);
            } catch (const std::exception& e) {
                return Status::error("bad ICE server \"" + server + "\": " + e.what());
            }
        }

        try {
            pc_ = std::make_shared<rtc::PeerConnection>(rtcConfig);

            pc_->onLocalDescription([this](rtc::Description description) {
                if (callbacks_.onLocalDescription) {
                    callbacks_.onLocalDescription(std::string(description), description.typeString());
                }
            });
            pc_->onLocalCandidate([this](rtc::Candidate candidate) {
                if (callbacks_.onLocalCandidate) {
                    callbacks_.onLocalCandidate(candidate.candidate(), candidate.mid());
                }
            });
            pc_->onStateChange([this](rtc::PeerConnection::State state) {
                if (callbacks_.onStateChange) {
                    callbacks_.onStateChange(toPeerState(state));
                }
            });

            rtc::Description::Video media("video", rtc::Description::Direction::SendOnly);
            media.addH264Codec(config_.payloadType, config_.h264Profile);
            media.setBitrate(config_.bitrateKbps);

            auto track = pc_->addTrack(media);
            auto rtpConfig = std::make_shared<rtc::RtpPacketizationConfig>(
                randomSsrc(), "desktop-host", static_cast<uint8_t>(config_.payloadType), kClockRate);

            // LongStartSequence: the encoder emits Annex-B with 4-byte start
            // codes, so the packetizer splits on exactly what annex_b.cpp
            // wrote. Getting this wrong sends one giant malformed NAL.
            auto packetizer = std::make_shared<rtc::H264RtpPacketizer>(
                rtc::NalUnit::Separator::LongStartSequence, rtpConfig);

            // Sender reports keep the receiver's lip-sync clock honest; the
            // NACK responder answers retransmission requests out of its own
            // small buffer, which is what turns a lost packet into a blip
            // rather than a wait for the next intra frame.
            packetizer->addToChain(std::make_shared<rtc::RtcpSrReporter>(rtpConfig));
            packetizer->addToChain(std::make_shared<rtc::RtcpNackResponder>());
            packetizer->addToChain(std::make_shared<rtc::PliHandler>([this] {
                if (callbacks_.onKeyframeRequest) {
                    callbacks_.onKeyframeRequest();
                }
            }));
            track->setMediaHandler(packetizer);

            {
                std::lock_guard<std::mutex> lock(mutex_);
                track_ = track;
                rtpConfig_ = rtpConfig;
            }

            // Generating the offer is what starts ICE gathering.
            pc_->setLocalDescription();
        } catch (const std::exception& e) {
            close();
            return Status::error(std::string("peer connection setup failed: ") + e.what());
        }

        return Status::ok();
    }

    void setRemoteDescription(const std::string& sdp, const std::string& type) override {
        if (pc_ == nullptr) {
            return;
        }
        try {
            pc_->setRemoteDescription(rtc::Description(sdp, type));
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[transport] bad remote description: %s\n", e.what());
        }
    }

    void addRemoteCandidate(const std::string& candidate, const std::string& mid) override {
        if (pc_ == nullptr) {
            return;
        }
        try {
            pc_->addRemoteCandidate(rtc::Candidate(candidate, mid));
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[transport] bad remote candidate: %s\n", e.what());
        }
    }

    void sendFrame(const EncodedFrame& frame) override {
        std::shared_ptr<rtc::Track> track;
        std::shared_ptr<rtc::RtpPacketizationConfig> rtpConfig;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            track = track_;
            rtpConfig = rtpConfig_;
        }
        if (track == nullptr || rtpConfig == nullptr || frame.annexB.empty()) {
            return;
        }
        // Dropped rather than queued: a frame delivered late is worse than a
        // gap, and the track only opens once DTLS is up.
        if (!track->isOpen()) {
            return;
        }

        // Timestamps are relative to the first frame sent, on the 90 kHz RTP
        // clock. Carrying capture spacing rather than send spacing is what
        // lets the receiver's jitter buffer reproduce the original timing.
        if (!baseUs_.has_value()) {
            baseUs_ = frame.ptsUs;
        }
        const int64_t deltaUs = frame.ptsUs - *baseUs_;
        const auto offset = static_cast<uint32_t>((deltaUs * static_cast<int64_t>(kClockRate)) /
                                                  1'000'000);
        rtpConfig->timestamp = rtpConfig->startTimestamp + offset;

        try {
            track->send(frame.annexB.data(), frame.annexB.size());
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[transport] send failed: %s\n", e.what());
        }
    }

    void close() override {
        std::shared_ptr<rtc::Track> track;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            track = std::move(track_);
            track_.reset();
            rtpConfig_.reset();
        }
        if (track != nullptr) {
            try {
                track->close();
            } catch (const std::exception&) {
                // Already gone; nothing useful to do during teardown.
            }
        }
        if (pc_ != nullptr) {
            try {
                pc_->close();
            } catch (const std::exception&) {
            }
            pc_.reset();
        }
    }

private:
    PeerConnectionConfig config_;
    PeerConnectionCallbacks callbacks_;
    std::shared_ptr<rtc::PeerConnection> pc_;

    // Touched by the encoder thread in sendFrame() and by whichever thread
    // tears the session down.
    std::mutex mutex_;
    std::shared_ptr<rtc::Track> track_;
    std::shared_ptr<rtc::RtpPacketizationConfig> rtpConfig_;

    // Only the sending thread reads or writes this.
    std::optional<int64_t> baseUs_;
};

}  // namespace

std::unique_ptr<IPeerConnection> makePeerConnection(const PeerConnectionConfig& config) {
    return std::make_unique<RtcPeerConnection>(config);
}

}  // namespace desktophost
