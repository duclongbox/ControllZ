#include <catch2/catch_test_macros.hpp>

#include <CoreVideo/CoreVideo.h>

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <thread>
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

void releasePixelBuffer(void* handle) noexcept {
    CVPixelBufferRelease(static_cast<CVPixelBufferRef>(handle));
}

/// IOSurface-backed NV12, like ScreenCaptureKit's. The luma level changes per
/// frame so each one is a real delta rather than a skipped duplicate.
CVPixelBufferRef createTestFrame(int width, int height, int index) {
    CFMutableDictionaryRef surfaceProperties = CFDictionaryCreateMutable(
        kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFMutableDictionaryRef attributes = CFDictionaryCreateMutable(
        kCFAllocatorDefault, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(attributes, kCVPixelBufferIOSurfacePropertiesKey, surfaceProperties);

    CVPixelBufferRef buffer = nullptr;
    CVPixelBufferCreate(kCFAllocatorDefault, static_cast<size_t>(width),
                        static_cast<size_t>(height), kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
                        attributes, &buffer);
    CFRelease(attributes);
    CFRelease(surfaceProperties);
    if (buffer == nullptr) {
        return nullptr;
    }

    CVPixelBufferLockBaseAddress(buffer, 0);
    for (size_t plane = 0; plane < 2; ++plane) {
        auto* base = static_cast<uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(buffer, plane));
        const size_t stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, plane);
        const size_t rows = CVPixelBufferGetHeightOfPlane(buffer, plane);
        const int value = plane == 0 ? 16 + (index * 7) % 200 : 128;
        std::memset(base, value, stride * rows);
    }
    CVPixelBufferUnlockBaseAddress(buffer, 0);
    return buffer;
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

// Screen capture routinely runs far below the fps hint — a mostly still desktop
// produced ~25 fps against a 60 fps hint. A keyframe limit derived from
// frames / fps then fires on elapsed time instead: 300 frames at 60 fps became
// an IDR every 5 s. Frames are fed with synthetic timestamps so the test covers
// 8 s of stream time without taking 8 s.
TEST_CASE("a source slower than the fps hint gets no periodic keyframes", "[encode][pipeline]") {
    constexpr int kWidth = 320;
    constexpr int kHeight = 240;
    constexpr int kFrames = 80;
    constexpr int64_t kFrameIntervalUs = 100'000;  // 10 fps
    constexpr int64_t kPastOldKeyframeIntervalUs = 6'000'000;

    EncoderConfig encoderConfig;
    encoderConfig.width = kWidth;
    encoderConfig.height = kHeight;
    encoderConfig.fps = 60;
    encoderConfig.bitrateBps = 1'000'000;

    auto encoder = makeVideoEncoder(encoderConfig);
    REQUIRE(encoder != nullptr);

    std::mutex mutex;
    std::vector<EncodedFrame> frames;
    REQUIRE(static_cast<bool>(encoder->start([&](const EncodedFrame& frame) {
        std::lock_guard<std::mutex> lock(mutex);
        frames.push_back(frame);
    })));

    encoder->forceKeyframe();
    for (int i = 0; i < kFrames; ++i) {
        CVPixelBufferRef buffer = createTestFrame(kWidth, kHeight, i);
        REQUIRE(buffer != nullptr);
        encoder->encode(PlatformFrame(buffer, releasePixelBuffer, kWidth, kHeight,
                                      i * kFrameIntervalUs));
        // Real-time mode may drop input that arrives faster than it encodes.
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    encoder->stop();  // flushes, so every emitted frame is in `frames` now

    std::lock_guard<std::mutex> lock(mutex);
    REQUIRE_FALSE(frames.empty());
    // Otherwise the stream never reached the point where the old limit fired.
    REQUIRE(frames.back().ptsUs >= kPastOldKeyframeIntervalUs);

    CHECK(frames.front().isKeyframe);
    for (size_t i = 1; i < frames.size(); ++i) {
        INFO("frame " << i << " at " << frames[i].ptsUs << " us");
        CHECK_FALSE(frames[i].isKeyframe);
    }
}
