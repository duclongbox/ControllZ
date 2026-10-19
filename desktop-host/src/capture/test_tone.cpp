#include "desktophost/capture/test_tone.h"

#include <chrono>
#include <cmath>
#include <utility>

namespace desktophost {

namespace {
constexpr double kPi = 3.14159265358979323846;
/// Quiet enough not to startle whoever is testing on the phone.
constexpr float kAmplitude = 0.2F;
}  // namespace

void TestToneSource::start(AudioCallback onAudio) {
    if (running_.exchange(true)) {
        return;
    }
    worker_ = std::thread([this, onAudio = std::move(onAudio)] {
        using Clock = std::chrono::steady_clock;
        const auto started = Clock::now();
        const auto chunk = std::chrono::milliseconds(kChunkMs);
        const std::size_t framesPerChunk =
            static_cast<std::size_t>(kSampleRate) * kChunkMs / 1000;
        const double step = 2.0 * kPi * kFrequencyHz / kSampleRate;

        double phase = 0.0;
        std::size_t framesSent = 0;
        auto next = started;

        while (running_.load()) {
            AudioChunk out;
            out.sampleRate = kSampleRate;
            out.channels = kChannels;
            out.ptsUs = static_cast<int64_t>(framesSent) * 1'000'000 / kSampleRate;
            out.samples.resize(framesPerChunk * kChannels);
            for (std::size_t i = 0; i < framesPerChunk; ++i) {
                const float value = kAmplitude * static_cast<float>(std::sin(phase));
                phase += step;
                if (phase > 2.0 * kPi) {
                    phase -= 2.0 * kPi;
                }
                for (int c = 0; c < kChannels; ++c) {
                    out.samples[i * kChannels + static_cast<std::size_t>(c)] = value;
                }
            }
            framesSent += framesPerChunk;
            onAudio(std::move(out));

            // Paced against the start time rather than sleep-after-work, so
            // a slow callback does not accumulate into drift.
            next += chunk;
            std::this_thread::sleep_until(next);
        }
    });
}

void TestToneSource::stop() {
    running_.store(false);
    if (worker_.joinable()) {
        worker_.join();
    }
}

}  // namespace desktophost
