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
#include <variant>

namespace desktophost {
namespace {

/// H.264 RTP always runs on a 90 kHz clock (RFC 6184).
constexpr uint32_t kClockRate = 90'000;

/// Opus RTP always runs at 48 kHz regardless of the encoder's input rate
/// (RFC 7587).
constexpr uint32_t kAudioClockRate = 48'000;

/// One CNAME for both tracks. The receiver synchronises tracks that share a
/// CNAME using their sender reports; two different names would be two
/// unrelated clocks and no lip-sync.
constexpr const char* kCname = "desktop-host";

/// `rtpConfig->timestamp` for a frame captured at `ptsUs`, relative to the
/// first frame's capture time on this track. Carrying capture spacing rather
/// than send spacing is what lets the receiver's jitter buffer reproduce the
/// original timing.
uint32_t rtpTimestamp(const rtc::RtpPacketizationConfig& rtpConfig, int64_t ptsUs,
                      int64_t baseUs, uint32_t clockRate) {
    const int64_t deltaUs = ptsUs - baseUs;
    const auto offset =
        static_cast<uint32_t>((deltaUs * static_cast<int64_t>(clockRate)) / 1'000'000);
    return rtpConfig.startTimestamp + offset;
}

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

            const uint32_t videoSsrc = randomSsrc();
            rtc::Description::Video media("video", rtc::Description::Direction::SendOnly);
            media.addH264Codec(config_.payloadType, config_.h264Profile);
            media.setBitrate(config_.bitrateKbps);
            // Declaring the SSRC with an msid is what lets the browser group
            // this track with the audio one into a single MediaStream.
            media.addSSRC(videoSsrc, kCname, config_.mediaStreamId, "desktop-video");

            auto track = pc_->addTrack(media);
            auto rtpConfig = std::make_shared<rtc::RtpPacketizationConfig>(
                videoSsrc, kCname, static_cast<uint8_t>(config_.payloadType), kClockRate);

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

            if (config_.enableAudio) {
                openAudioTrack();
            }

            if (config_.enableInputChannel) {
                openInputChannel();
                openKeyChannel();
            }

            // Generating the offer is what starts ICE gathering.
            pc_->setLocalDescription();
        } catch (const std::exception& e) {
            close();
            return Status::error(std::string("peer connection setup failed: ") + e.what());
        }

        return Status::ok();
    }

    /// The audio track. Added before setLocalDescription() like everything
    /// else that needs an m-line. Stereo is asked for explicitly: the
    /// browser's default Opus answer is mono unless the offer says otherwise,
    /// and a game's soundstage folded to mono is the first thing a listener
    /// notices. DTX is announced so the receiver expects the gaps.
    void openAudioTrack() {
        const uint32_t audioSsrc = randomSsrc();
        rtc::Description::Audio audio("audio", rtc::Description::Direction::SendOnly);
        audio.addOpusCodec(config_.audioPayloadType,
                           "minptime=10;maxaveragebitrate=" +
                               std::to_string(config_.audioBitrateKbps * 1000) +
                               ";stereo=1;sprop-stereo=1;useinbandfec=0;usedtx=1");
        audio.setBitrate(config_.audioBitrateKbps);
        audio.addSSRC(audioSsrc, kCname, config_.mediaStreamId, "desktop-audio");

        auto track = pc_->addTrack(audio);
        auto rtpConfig = std::make_shared<rtc::RtpPacketizationConfig>(
            audioSsrc, kCname, static_cast<uint8_t>(config_.audioPayloadType), kAudioClockRate);

        // One Opus packet is one RTP packet; the generic audio packetizer is
        // exactly that. Sender reports and nothing else: a NACK responder
        // would resend 20 ms of audio that the jitter buffer has already
        // played past.
        auto packetizer = std::make_shared<rtc::OpusRtpPacketizer>(rtpConfig);
        packetizer->addToChain(std::make_shared<rtc::RtcpSrReporter>(rtpConfig));
        track->setMediaHandler(packetizer);

        std::lock_guard<std::mutex> lock(mutex_);
        audioTrack_ = std::move(track);
        audioRtpConfig_ = std::move(rtpConfig);
    }

    /// THE INVARIANT (CLAUDE.md): input travels unordered and unreliable, on
    /// its own channel, never multiplexed with video. Ordered delivery would
    /// make one lost packet stall every sample behind it, and retransmits would
    /// replay a coordinate that is already wrong by the time it lands — for a
    /// 120 Hz stream of absolute positions, the next sample is always a better
    /// answer than a resend of the last one.
    ///
    /// Created before setLocalDescription() so the SCTP m-line is in the offer.
    void openInputChannel() {
        rtc::DataChannelInit init;
        init.reliability.unordered = true;
        init.reliability.maxRetransmits = 0;  // exclusive with maxPacketLifeTime

        auto channel = pc_->createDataChannel(config_.inputChannelLabel, init);

        channel->onMessage([this](rtc::message_variant message) {
            if (const auto* text = std::get_if<std::string>(&message)) {
                if (callbacks_.onInputMessage) {
                    callbacks_.onInputMessage(*text);
                }
            }
            // Binary frames are ignored rather than rejected: the schema is
            // JSON today, and a binary encoding is a plausible later change
            // that should not have to touch transport.
        });

        channel->onClosed([this] {
            if (callbacks_.onInputChannelClosed) {
                callbacks_.onInputChannelClosed();
            }
        });

        std::lock_guard<std::mutex> lock(mutex_);
        inputChannel_ = std::move(channel);
    }

    /// Keyboard. Default DataChannelInit is ordered and fully reliable, which
    /// is the point — see PeerConnectionConfig::keyChannelLabel. Created
    /// alongside the input channel, before the offer, for the same reason.
    void openKeyChannel() {
        auto channel = pc_->createDataChannel(config_.keyChannelLabel, rtc::DataChannelInit{});

        if (!config_.keyChannelHello.empty()) {
            // The channel is ordered and reliable, so a message sent in onOpen
            // is guaranteed to reach the phone before anything else on it.
            // Weak: the channel owns this closure, so a strong capture would
            // be a cycle it never escapes.
            std::weak_ptr<rtc::DataChannel> weak = channel;
            channel->onOpen([weak, hello = config_.keyChannelHello] {
                if (auto open = weak.lock()) {
                    try {
                        open->send(hello);
                    } catch (const std::exception& e) {
                        std::fprintf(stderr, "[transport] key channel hello failed: %s\n", e.what());
                    }
                }
            });
        }

        channel->onMessage([this](rtc::message_variant message) {
            if (const auto* text = std::get_if<std::string>(&message)) {
                if (callbacks_.onKeyMessage) {
                    callbacks_.onKeyMessage(*text);
                }
            }
        });

        channel->onClosed([this] {
            if (callbacks_.onKeyChannelClosed) {
                callbacks_.onKeyChannelClosed();
            }
        });

        std::lock_guard<std::mutex> lock(mutex_);
        keyChannel_ = std::move(channel);
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

        if (!baseUs_.has_value()) {
            baseUs_ = frame.ptsUs;
        }
        rtpConfig->timestamp = rtpTimestamp(*rtpConfig, frame.ptsUs, *baseUs_, kClockRate);

        try {
            track->send(frame.annexB.data(), frame.annexB.size());
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[transport] send failed: %s\n", e.what());
        }
    }

    void sendAudio(const EncodedAudioFrame& frame) override {
        std::shared_ptr<rtc::Track> track;
        std::shared_ptr<rtc::RtpPacketizationConfig> rtpConfig;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            track = audioTrack_;
            rtpConfig = audioRtpConfig_;
        }
        if (track == nullptr || rtpConfig == nullptr || frame.data.empty()) {
            return;
        }
        if (!track->isOpen()) {
            return;
        }

        // Its own base, not the video's: the two tracks are lined up by the
        // receiver from their sender reports (same CNAME, same wall clock),
        // not by sharing an origin here.
        if (!audioBaseUs_.has_value()) {
            audioBaseUs_ = frame.ptsUs;
        }
        rtpConfig->timestamp =
            rtpTimestamp(*rtpConfig, frame.ptsUs, *audioBaseUs_, kAudioClockRate);

        try {
            track->send(frame.data.data(), frame.data.size());
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[transport] audio send failed: %s\n", e.what());
        }
    }

    void close() override {
        std::shared_ptr<rtc::Track> track;
        std::shared_ptr<rtc::Track> audioTrack;
        std::shared_ptr<rtc::DataChannel> input;
        std::shared_ptr<rtc::DataChannel> keys;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            track = std::move(track_);
            track_.reset();
            rtpConfig_.reset();
            audioTrack = std::move(audioTrack_);
            audioTrack_.reset();
            audioRtpConfig_.reset();
            input = std::move(inputChannel_);
            inputChannel_.reset();
            keys = std::move(keyChannel_);
            keyChannel_.reset();
        }
        for (const auto& channel : {input, keys}) {
            if (channel == nullptr) {
                continue;
            }
            // Drop the handlers before closing: onClosed fires during this
            // teardown, and the session it would call back into is the one
            // being destroyed.
            channel->onMessage(nullptr);
            channel->onClosed(nullptr);
            try {
                channel->close();
            } catch (const std::exception&) {
            }
        }
        for (const auto& media : {track, audioTrack}) {
            if (media == nullptr) {
                continue;
            }
            try {
                media->close();
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
    std::shared_ptr<rtc::Track> audioTrack_;
    std::shared_ptr<rtc::RtpPacketizationConfig> audioRtpConfig_;
    std::shared_ptr<rtc::DataChannel> inputChannel_;
    std::shared_ptr<rtc::DataChannel> keyChannel_;

    // Each only ever touched by its own sending thread: the video encoder's
    // callback thread for one, the audio capture thread for the other.
    std::optional<int64_t> baseUs_;
    std::optional<int64_t> audioBaseUs_;
};

}  // namespace

std::unique_ptr<IPeerConnection> makePeerConnection(const PeerConnectionConfig& config) {
    return std::make_unique<RtcPeerConnection>(config);
}

}  // namespace desktophost
