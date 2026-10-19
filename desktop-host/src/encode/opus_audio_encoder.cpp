#include "desktophost/encode/audio_encoder.h"

#include <opus.h>

#include <cstdio>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace desktophost {
namespace {

/// Upper bound on one Opus packet. The reference encoder recommends 4000
/// bytes: at 128 kb/s a 20 ms frame is ~320, so this is never the limit.
constexpr int kMaxPacketBytes = 4000;

/// Packets of one or two bytes are what DTX produces during silence; libopus
/// documents them as "does not need to be transmitted". Browsers treat the
/// missing packets as silence, which they are.
constexpr int kDtxPacketBytes = 2;

class OpusAudioEncoder final : public IAudioEncoder {
public:
    explicit OpusAudioEncoder(const AudioEncoderConfig& config) : config_(config) {}

    ~OpusAudioEncoder() override { stop(); }

    Status start(EncodedAudioCallback onEncoded) override {
        if (encoder_ != nullptr) {
            return Status::error("audio encoder already started");
        }
        if (config_.sampleRate != 48'000) {
            // Opus also runs at 8/12/16/24 kHz, but the capturers are
            // configured for 48 and the RTP clock is 48; accepting anything
            // else here would only hide a misconfigured capturer.
            return Status::error("audio encoder needs 48 kHz input, got " +
                                 std::to_string(config_.sampleRate));
        }
        if (config_.channels != 1 && config_.channels != 2) {
            return Status::error("audio encoder needs mono or stereo input, got " +
                                 std::to_string(config_.channels) + " channels");
        }
        // Opus frames are 2.5, 5, 10, 20, 40 or 60 ms.
        switch (config_.frameMs) {
            case 5: case 10: case 20: case 40: case 60: break;
            default:
                return Status::error("audio frame must be 5, 10, 20, 40 or 60 ms, got " +
                                     std::to_string(config_.frameMs));
        }

        int error = OPUS_OK;
        encoder_ = opus_encoder_create(config_.sampleRate, config_.channels,
                                       OPUS_APPLICATION_AUDIO, &error);
        if (error != OPUS_OK || encoder_ == nullptr) {
            encoder_ = nullptr;
            return Status::error(std::string("opus_encoder_create: ") + opus_strerror(error));
        }

        // AUDIO rather than VOIP: the source is a game or a video, and the
        // VOIP tuning spends bits on speech intelligibility at the expense of
        // music. No in-band FEC: it costs bitrate on every packet to help
        // only with isolated losses, and the DataChannel-free media path
        // already prefers a gap over a wait.
        opus_encoder_ctl(encoder_, OPUS_SET_BITRATE(config_.bitrateBps));
        opus_encoder_ctl(encoder_, OPUS_SET_COMPLEXITY(config_.complexity));
        opus_encoder_ctl(encoder_, OPUS_SET_INBAND_FEC(0));
        opus_encoder_ctl(encoder_, OPUS_SET_DTX(config_.dtx ? 1 : 0));
        // The receiver is a browser's jitter buffer, not a file: tell the
        // encoder the stream is live so it never trades latency for quality.
        opus_encoder_ctl(encoder_, OPUS_SET_SIGNAL(OPUS_AUTO));

        frameSamples_ = static_cast<std::size_t>(config_.sampleRate) *
                        static_cast<std::size_t>(config_.frameMs) / 1000;
        pending_.clear();
        pending_.reserve(frameSamples_ * static_cast<std::size_t>(config_.channels) * 2);
        pendingPtsUs_.reset();
        onEncoded_ = std::move(onEncoded);
        packet_.resize(kMaxPacketBytes);
        return Status::ok();
    }

    void encode(const AudioChunk& chunk) override {
        if (encoder_ == nullptr) {
            return;
        }
        if (chunk.sampleRate != config_.sampleRate || chunk.channels != config_.channels) {
            if (!warnedFormat_) {
                warnedFormat_ = true;
                std::fprintf(stderr,
                             "[audio] dropping chunks: capturer delivers %d Hz x%d, encoder "
                             "expects %d Hz x%d\n",
                             chunk.sampleRate, chunk.channels, config_.sampleRate,
                             config_.channels);
            }
            return;
        }
        if (chunk.samples.empty()) {
            return;
        }

        // The pts of whatever is buffered is the pts of its first sample. Once
        // something is buffered, later chunks are assumed contiguous: the
        // capturers deliver a continuous stream, and a chunk pts that drifted
        // from the sample count would only mean the platform's clock and its
        // sample counter disagree, which the sample count resolves better.
        if (!pendingPtsUs_.has_value()) {
            pendingPtsUs_ = chunk.ptsUs;
        }
        pending_.insert(pending_.end(), chunk.samples.begin(), chunk.samples.end());

        const std::size_t frameFloats = frameSamples_ * static_cast<std::size_t>(config_.channels);
        std::size_t consumed = 0;
        while (pending_.size() - consumed >= frameFloats) {
            const opus_int32 written =
                opus_encode_float(encoder_, pending_.data() + consumed,
                                  static_cast<int>(frameSamples_),
                                  reinterpret_cast<unsigned char*>(packet_.data()),
                                  kMaxPacketBytes);
            const int64_t framePtsUs = *pendingPtsUs_;
            consumed += frameFloats;
            *pendingPtsUs_ += static_cast<int64_t>(config_.frameMs) * 1000;

            if (written < 0) {
                std::fprintf(stderr, "[audio] opus_encode_float: %s\n", opus_strerror(written));
                continue;
            }
            if (written <= kDtxPacketBytes) {
                continue;  // DTX: silence, nothing to send
            }
            if (onEncoded_) {
                EncodedAudioFrame frame;
                frame.data.assign(packet_.begin(), packet_.begin() + written);
                frame.ptsUs = framePtsUs;
                onEncoded_(frame);
            }
        }
        if (consumed > 0) {
            pending_.erase(pending_.begin(),
                           pending_.begin() + static_cast<std::ptrdiff_t>(consumed));
        }
    }

    void stop() override {
        if (encoder_ != nullptr) {
            opus_encoder_destroy(encoder_);
            encoder_ = nullptr;
        }
        pending_.clear();
        pendingPtsUs_.reset();
        onEncoded_ = nullptr;
    }

private:
    AudioEncoderConfig config_;
    OpusEncoder* encoder_ = nullptr;
    EncodedAudioCallback onEncoded_;
    std::size_t frameSamples_ = 0;

    // Interleaved floats waiting for a full frame, and the pts of the first.
    std::vector<float> pending_;
    std::optional<int64_t> pendingPtsUs_;

    std::vector<std::byte> packet_;
    bool warnedFormat_ = false;
};

}  // namespace

std::unique_ptr<IAudioEncoder> makeOpusAudioEncoder(const AudioEncoderConfig& config) {
    return std::make_unique<OpusAudioEncoder>(config);
}

}  // namespace desktophost
