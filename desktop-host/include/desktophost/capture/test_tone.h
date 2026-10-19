#pragma once

#include <atomic>
#include <cstdint>
#include <thread>

#include "desktophost/capture/audio_chunk.h"

namespace desktophost {

/// A synthetic system-audio source: a 440 Hz stereo tone at 48 kHz, paced in
/// real time in 10 ms chunks on its own thread.
///
/// The audio counterpart of the test pattern, for the same reason: real
/// system audio needs a desktop that is playing something, which CI never is.
/// The test-pattern capturers run one of these when asked for audio, so
/// `--test-pattern --serve` proves the whole audio path through to the phone
/// with nothing playing on the host.
class TestToneSource {
public:
    TestToneSource() = default;
    ~TestToneSource() { stop(); }

    TestToneSource(const TestToneSource&) = delete;
    TestToneSource& operator=(const TestToneSource&) = delete;

    /// No-op if already running. Chunk timestamps count up from zero at the
    /// sample rate, which is the same origin the test-pattern capturers stamp
    /// their frames with.
    void start(AudioCallback onAudio);

    /// Blocks until the thread has exited, so no callback runs afterwards.
    void stop();

    static constexpr int kSampleRate = 48'000;
    static constexpr int kChannels = 2;
    static constexpr int kChunkMs = 10;
    static constexpr double kFrequencyHz = 440.0;

private:
    std::atomic<bool> running_{false};
    std::thread worker_;
};

}  // namespace desktophost
