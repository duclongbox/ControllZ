#include <catch2/catch_test_macros.hpp>

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <vector>

#include "desktophost/capture/test_pattern_capturer.h"
#include "desktophost/encode/video_encoder.h"

using namespace desktophost;

namespace {

constexpr size_t kFramesWanted = 5;
constexpr std::byte kStartCode[4] = {std::byte{0x00}, std::byte{0x00}, std::byte{0x00},
                                     std::byte{0x01}};

bool startsWithStartCode(const std::vector<std::byte>& data, size_t offset) {
    if (data.size() - offset < sizeof(kStartCode)) {
        return false;
    }
    for (size_t i = 0; i < sizeof(kStartCode); ++i) {
        if (data[offset + i] != kStartCode[i]) {
            return false;
        }
    }
    return true;
}

/// NAL unit types in the order they appear. Type is the low 5 bits of the byte
/// following each start code: 7 = SPS, 8 = PPS, 5 = IDR slice, 1 = non-IDR.
std::vector<int> nalTypes(const std::vector<std::byte>& annexB) {
    std::vector<int> types;
    for (size_t i = 0; i + sizeof(kStartCode) < annexB.size(); ++i) {
        if (startsWithStartCode(annexB, i)) {
            types.push_back(static_cast<int>(annexB[i + sizeof(kStartCode)]) & 0x1F);
        }
    }
    return types;
}

bool contains(const std::vector<int>& values, int wanted) {
    for (int value : values) {
        if (value == wanted) {
            return true;
        }
    }
    return false;
}

}  // namespace

// The GPU pipeline itself is not under test here; the byte format crossing the
// encoder seam is. VideoToolbox emits length-prefixed NAL units and withholds
// SPS/PPS entirely, and getting that conversion wrong produces a stream that
// renders black with no error anywhere — so it is worth an automated check
// rather than an occasional manual ffplay.
TEST_CASE("encoder emits decodable Annex-B with parameter sets on the keyframe",
          "[encode][pipeline]") {
    CaptureConfig captureConfig;
    captureConfig.maxWidth = 320;
    captureConfig.maxHeight = 240;
    captureConfig.maxFps = 30;

    auto capturer = makeTestPatternCapturer(captureConfig);
    REQUIRE(capturer != nullptr);

    EncoderConfig encoderConfig;
    encoderConfig.width = capturer->width();
    encoderConfig.height = capturer->height();
    encoderConfig.fps = 30;
    encoderConfig.bitrateBps = 2'000'000;

    auto encoder = makeVideoEncoder(encoderConfig);
    REQUIRE(encoder != nullptr);

    std::mutex mutex;
    std::condition_variable ready;
    std::vector<EncodedFrame> frames;

    REQUIRE(static_cast<bool>(encoder->start([&](const EncodedFrame& frame) {
        std::lock_guard<std::mutex> lock(mutex);
        if (frames.size() < kFramesWanted) {
            frames.push_back(frame);
            ready.notify_all();
        }
    })));

    encoder->forceKeyframe();
    REQUIRE(static_cast<bool>(capturer->start(
        [&](PlatformFrame frame) { encoder->encode(std::move(frame)); }, [](const Status&) {})));

    {
        std::unique_lock<std::mutex> lock(mutex);
        ready.wait_for(lock, std::chrono::seconds(10),
                       [&] { return frames.size() >= kFramesWanted; });
    }

    capturer->stop();
    encoder->stop();

    REQUIRE(frames.size() >= 2);

    const auto& first = frames.front();
    CHECK(first.isKeyframe);
    CHECK(startsWithStartCode(first.annexB, 0));

    const auto firstTypes = nalTypes(first.annexB);
    // Order matters: a decoder joining here reads SPS, then PPS, then the IDR.
    REQUIRE(firstTypes.size() >= 3);
    CHECK(firstTypes[0] == 7);
    CHECK(firstTypes[1] == 8);
    CHECK(contains(firstTypes, 5));

    // Long GOP: nothing after the forced IDR should be another keyframe, and
    // delta frames must not repeat the parameter sets.
    for (size_t i = 1; i < frames.size(); ++i) {
        CHECK_FALSE(frames[i].isKeyframe);
        const auto types = nalTypes(frames[i].annexB);
        CHECK_FALSE(contains(types, 7));
        CHECK_FALSE(contains(types, 8));
    }

    // Timestamps come from capture, not a frame counter, so they must advance.
    CHECK(frames[1].ptsUs > frames[0].ptsUs);
}
