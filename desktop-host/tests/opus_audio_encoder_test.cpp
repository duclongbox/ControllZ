#include <catch2/catch_test_macros.hpp>

#include <cmath>
#include <cstddef>
#include <vector>

#include "desktophost/encode/audio_encoder.h"

using namespace desktophost;

namespace {

constexpr double kPi = 3.14159265358979323846;

/// `frames` frames of a stereo tone starting at `ptsUs`.
AudioChunk tone(std::size_t frames, int64_t ptsUs, double frequencyHz = 440.0,
                float amplitude = 0.5F) {
    AudioChunk chunk;
    chunk.ptsUs = ptsUs;
    chunk.samples.resize(frames * 2);
    for (std::size_t i = 0; i < frames; ++i) {
        const auto t = static_cast<double>(i) / 48'000.0;
        const float v = amplitude * static_cast<float>(std::sin(2.0 * kPi * frequencyHz * t));
        chunk.samples[i * 2] = v;
        chunk.samples[i * 2 + 1] = v;
    }
    return chunk;
}

AudioChunk silence(std::size_t frames, int64_t ptsUs) {
    AudioChunk chunk;
    chunk.ptsUs = ptsUs;
    chunk.samples.assign(frames * 2, 0.0F);
    return chunk;
}

struct Collected {
    std::vector<EncodedAudioFrame> frames;
};

std::unique_ptr<IAudioEncoder> started(Collected& out, AudioEncoderConfig config = {}) {
    auto encoder = makeOpusAudioEncoder(config);
    REQUIRE(encoder != nullptr);
    const Status status =
        encoder->start([&out](const EncodedAudioFrame& frame) { out.frames.push_back(frame); });
    INFO(status.message());
    REQUIRE(static_cast<bool>(status));
    return encoder;
}

}  // namespace

// The contract with the packetizer: one packet per 20 ms, stamped with the
// capture time of its first sample, so the RTP clock advances by exactly 960
// ticks per packet whatever shape the capturer delivered the PCM in.
TEST_CASE("one second of audio becomes fifty 20 ms packets with 20 ms pts spacing",
          "[audio]") {
    Collected out;
    auto encoder = started(out);

    // 10 ms chunks, as ScreenCaptureKit and WASAPI deliver them.
    constexpr std::size_t kChunkFrames = 480;
    for (int i = 0; i < 100; ++i) {
        encoder->encode(tone(kChunkFrames, static_cast<int64_t>(i) * 10'000));
    }
    encoder->stop();

    REQUIRE(out.frames.size() == 50);
    for (std::size_t i = 0; i < out.frames.size(); ++i) {
        INFO("packet " << i);
        CHECK(out.frames[i].ptsUs == static_cast<int64_t>(i) * 20'000);
        // A real Opus packet, not a DTX marker, and nowhere near the 4000
        // byte ceiling: at 128 kb/s a frame is a few hundred bytes.
        CHECK(out.frames[i].data.size() > 2);
        CHECK(out.frames[i].data.size() < 1000);
    }
}

// Chunk sizes that do not divide into the frame: the remainder has to carry
// over rather than be dropped or padded, or the stream develops a click every
// chunk boundary.
TEST_CASE("partial chunks accumulate across calls without losing samples", "[audio]") {
    Collected out;
    auto encoder = started(out);

    // 7 ms chunks: 336 frames each, so a 960-frame packet straddles three.
    constexpr std::size_t kChunkFrames = 336;
    int64_t pts = 0;
    std::size_t delivered = 0;
    while (delivered < 48'000) {
        encoder->encode(tone(kChunkFrames, pts));
        delivered += kChunkFrames;
        pts += static_cast<int64_t>(kChunkFrames) * 1'000'000 / 48'000;
    }
    encoder->stop();

    // 48'384 frames in → 50 full packets, 384 frames left over and discarded.
    REQUIRE(out.frames.size() == 50);
    CHECK(out.frames[1].ptsUs - out.frames[0].ptsUs == 20'000);
    CHECK(out.frames.back().ptsUs == 49 * 20'000);
}

// A silent desktop must not cost a packet every 20 ms. Opus's DTX shrinks
// silence to a one-byte marker, which the encoder swallows; the receiver
// fills the gap. Also pins the default complexity: below 7 libopus never runs
// the analysis DTX is decided from, and this count silently becomes 100.
TEST_CASE("sustained silence stops producing packets (DTX)", "[audio]") {
    Collected out;
    auto encoder = started(out);

    // Two seconds. The first 200 ms still go out while DTX decides the signal
    // really is silent, then one keep-alive every 400 ms.
    for (int i = 0; i < 100; ++i) {
        encoder->encode(silence(960, static_cast<int64_t>(i) * 20'000));
    }
    encoder->stop();

    CHECK(out.frames.size() < 20);
}

// Music must never trip DTX: a quiet passage is not silence.
TEST_CASE("a quiet tone keeps every packet", "[audio]") {
    Collected out;
    auto encoder = started(out);
    for (int i = 0; i < 100; ++i) {
        encoder->encode(tone(960, static_cast<int64_t>(i) * 20'000, 440.0, 0.01F));
    }
    encoder->stop();
    CHECK(out.frames.size() == 100);
}

TEST_CASE("DTX can be switched off, and then silence is still sent", "[audio]") {
    Collected out;
    AudioEncoderConfig config;
    config.dtx = false;
    auto encoder = started(out, config);

    for (int i = 0; i < 50; ++i) {
        encoder->encode(silence(960, static_cast<int64_t>(i) * 20'000));
    }
    encoder->stop();

    CHECK(out.frames.size() == 50);
}

// The capturers are configured for 48 kHz stereo; anything else reaching the
// encoder is a bug upstream, and a bug that should fail loudly here rather
// than play at the wrong pitch on the phone.
TEST_CASE("the encoder refuses configurations Opus RTP cannot carry", "[audio]") {
    Collected out;
    SECTION("sample rate") {
        AudioEncoderConfig config;
        config.sampleRate = 44'100;
        auto encoder = makeOpusAudioEncoder(config);
        CHECK(encoder->start([](const EncodedAudioFrame&) {}).failed());
    }
    SECTION("channel count") {
        AudioEncoderConfig config;
        config.channels = 6;
        auto encoder = makeOpusAudioEncoder(config);
        CHECK(encoder->start([](const EncodedAudioFrame&) {}).failed());
    }
    SECTION("frame duration") {
        AudioEncoderConfig config;
        config.frameMs = 15;
        auto encoder = makeOpusAudioEncoder(config);
        CHECK(encoder->start([](const EncodedAudioFrame&) {}).failed());
    }
}

TEST_CASE("a chunk in the wrong format is dropped, not encoded", "[audio]") {
    Collected out;
    auto encoder = started(out);

    AudioChunk wrong = tone(960, 0);
    wrong.sampleRate = 44'100;
    encoder->encode(wrong);
    AudioChunk mono = tone(960, 0);
    mono.channels = 1;
    encoder->encode(mono);
    encoder->stop();

    CHECK(out.frames.empty());
}

TEST_CASE("stop() is idempotent and encode() after it is a no-op", "[audio]") {
    Collected out;
    auto encoder = started(out);
    encoder->stop();
    encoder->stop();
    encoder->encode(tone(960, 0));
    CHECK(out.frames.empty());
}
