#include <catch2/catch_test_macros.hpp>

#include <chrono>
#include <condition_variable>
#include <mutex>
#include <thread>
#include <vector>

#include "desktophost/capture/screen_capturer.h"
#include "desktophost/capture/test_pattern_capturer.h"
#include "desktophost/capture/test_tone.h"

using namespace desktophost;

// The source behind `--test-pattern`'s audio has to look exactly like the
// platform capturers to the encoder: 48 kHz stereo float, 10 ms chunks, pts
// advancing with the sample count.
TEST_CASE("the test tone delivers 48 kHz stereo in 10 ms chunks", "[audio]") {
    std::mutex mutex;
    std::condition_variable ready;
    std::vector<AudioChunk> chunks;

    TestToneSource tone;
    tone.start([&](AudioChunk chunk) {
        std::lock_guard<std::mutex> lock(mutex);
        if (chunks.size() < 10) {
            chunks.push_back(std::move(chunk));
            ready.notify_all();
        }
    });
    {
        std::unique_lock<std::mutex> lock(mutex);
        REQUIRE(ready.wait_for(lock, std::chrono::seconds(5), [&] { return chunks.size() >= 10; }));
    }
    tone.stop();

    for (std::size_t i = 0; i < chunks.size(); ++i) {
        INFO("chunk " << i);
        CHECK(chunks[i].sampleRate == 48'000);
        CHECK(chunks[i].channels == 2);
        CHECK(chunks[i].frames() == 480);
        CHECK(chunks[i].ptsUs == static_cast<int64_t>(i) * 10'000);
    }
    // Not silence: something the phone can actually hear.
    bool nonZero = false;
    for (float v : chunks[1].samples) {
        if (v != 0.0F) nonZero = true;
    }
    CHECK(nonZero);
}

// The capturer contract extends to audio: once stop() returns, no audio
// callback is running or will run, because the encoder is torn down next.
TEST_CASE("the test pattern capturer emits audio when asked and stops it with the frames",
          "[capture][audio]") {
    CaptureConfig config;
    config.maxWidth = 320;
    config.maxHeight = 240;
    config.maxFps = 30;
    config.captureAudio = true;

    auto capturer = makeTestPatternCapturer(config);
    REQUIRE(capturer != nullptr);

    std::mutex mutex;
    std::condition_variable ready;
    int audioChunks = 0;
    int frames = 0;

    const Status status = capturer->start(
        [&](PlatformFrame) {
            std::lock_guard<std::mutex> lock(mutex);
            ++frames;
        },
        [](const Status&) {},
        [&](AudioChunk chunk) {
            std::lock_guard<std::mutex> lock(mutex);
            if (chunk.sampleRate == 48'000 && chunk.channels == 2) ++audioChunks;
            ready.notify_all();
        });
    INFO(status.message());
    REQUIRE(static_cast<bool>(status));
    {
        std::unique_lock<std::mutex> lock(mutex);
        REQUIRE(ready.wait_for(lock, std::chrono::seconds(5), [&] { return audioChunks >= 5; }));
    }

    capturer->stop();
    int afterStop;
    {
        std::lock_guard<std::mutex> lock(mutex);
        afterStop = audioChunks;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    std::lock_guard<std::mutex> lock(mutex);
    CHECK(audioChunks == afterStop);
}

TEST_CASE("without captureAudio the test pattern capturer never calls the audio callback",
          "[capture][audio]") {
    CaptureConfig config;
    config.maxWidth = 320;
    config.maxHeight = 240;
    config.maxFps = 30;

    auto capturer = makeTestPatternCapturer(config);
    std::mutex mutex;
    std::condition_variable ready;
    int frames = 0;
    int audioChunks = 0;
    REQUIRE(static_cast<bool>(capturer->start(
        [&](PlatformFrame) {
            std::lock_guard<std::mutex> lock(mutex);
            ++frames;
            ready.notify_all();
        },
        [](const Status&) {},
        [&](AudioChunk) {
            std::lock_guard<std::mutex> lock(mutex);
            ++audioChunks;
        })));
    {
        std::unique_lock<std::mutex> lock(mutex);
        REQUIRE(ready.wait_for(lock, std::chrono::seconds(5), [&] { return frames >= 3; }));
    }
    capturer->stop();
    CHECK(audioChunks == 0);
}

// Hidden: needs a real display and the Screen Recording grant (macOS), or an
// output device (Windows). Run by hand: `desktophost_tests "[screen]"`.
// What it proves is the platform half of the audio path: the real capturer,
// asked for audio, delivers 48 kHz stereo chunks on a timeline that keeps
// pace with the frames.
TEST_CASE("platform screen capturer delivers 48 kHz stereo audio", "[.][screen][audio]") {
    CaptureConfig config;
    config.maxWidth = 320;
    config.maxHeight = 240;
    config.maxFps = 30;
    config.captureAudio = true;

    auto capturer = makeScreenCapturer(config);
    REQUIRE(capturer != nullptr);

    std::mutex mutex;
    std::condition_variable ready;
    std::vector<AudioChunk> chunks;
    int frames = 0;

    const Status status = capturer->start(
        [&](PlatformFrame) {
            std::lock_guard<std::mutex> lock(mutex);
            ++frames;
        },
        [](const Status&) {},
        [&](AudioChunk chunk) {
            std::lock_guard<std::mutex> lock(mutex);
            if (chunks.size() < 50) {
                chunk.samples.clear();  // only the shape matters here
                chunks.push_back(std::move(chunk));
            }
            ready.notify_all();
        });
    INFO(status.message());
    REQUIRE(static_cast<bool>(status));
    {
        std::unique_lock<std::mutex> lock(mutex);
        REQUIRE(ready.wait_for(lock, std::chrono::seconds(10), [&] { return chunks.size() >= 50; }));
    }
    capturer->stop();

    for (const AudioChunk& chunk : chunks) {
        CHECK(chunk.sampleRate == 48'000);
        CHECK(chunk.channels == 2);
    }
    // Monotonic, and roughly real time: 50 chunks should span well under
    // two seconds however the platform sizes them.
    for (std::size_t i = 1; i < chunks.size(); ++i) {
        CHECK(chunks[i].ptsUs > chunks[i - 1].ptsUs);
    }
    CHECK(chunks.back().ptsUs - chunks.front().ptsUs < 2'000'000);
}
