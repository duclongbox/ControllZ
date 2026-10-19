#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <vector>

namespace desktophost {

/// A run of captured system audio, as interleaved 32-bit float PCM.
///
/// The audio counterpart of PlatformFrame, and deliberately not GPU-resident:
/// the capture -> encode invariant (CLAUDE.md) exists because a 1080p frame
/// read back to the CPU costs milliseconds and bandwidth the encoder never
/// needed. Ten milliseconds of stereo audio is under four kilobytes and the
/// CPU is where Opus runs anyway, so a plain vector is the right shape.
///
/// Both platform capturers deliver 48 kHz stereo — ScreenCaptureKit is asked
/// for it directly, WASAPI converts to it in the mixer — which is also Opus's
/// native rate, so nothing downstream ever resamples. The fields are carried
/// rather than assumed so a chunk that breaks that promise is rejected by the
/// encoder instead of being played at the wrong pitch.
struct AudioChunk {
    std::vector<float> samples;  // interleaved: L R L R ...
    int sampleRate = 48'000;
    int channels = 2;

    /// Capture time of the first sample, in microseconds on the same clock as
    /// PlatformFrame::ptsUs(). Same clock is what lets the receiver line the
    /// two tracks up.
    int64_t ptsUs = 0;

    std::size_t frames() const {
        return channels > 0 ? samples.size() / static_cast<std::size_t>(channels) : 0;
    }
};

/// Invoked on the capture backend's own audio thread. Must not block: a
/// handler that stalls makes the platform drop audio, and a dropped buffer is
/// an audible click.
using AudioCallback = std::function<void(AudioChunk)>;

}  // namespace desktophost
