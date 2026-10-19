#pragma once

// Internal to the Windows capture backend. Nothing under include/ may depend
// on this: the audio seam is IScreenCapturer::start()'s audio callback.

#include <atomic>
#include <thread>

#include "desktophost/capture/audio_chunk.h"
#include "desktophost/status.h"

namespace desktophost::win {

/// System audio via WASAPI loopback on the default render endpoint.
///
/// Loopback capture reads what the shared-mode mixer is about to send to the
/// speakers, which is every application's output mixed, after volume. The
/// mixer is asked to deliver 48 kHz stereo float directly (AUTOCONVERTPCM),
/// so whatever the device's own format is, the chunks match the encoder.
///
/// Polled every 10 ms on its own thread rather than event-driven: WASAPI's
/// event callback is not reliably signalled for loopback streams, and a 10 ms
/// poll against a 50 ms buffer never misses a packet.
///
/// If the device goes away (unplugged, default output changed) the thread
/// reopens the current default after a short pause, so the phone follows the
/// desktop's output device at the cost of a moment of silence.
class AudioLoopback {
public:
    AudioLoopback() = default;
    ~AudioLoopback() { stop(); }

    AudioLoopback(const AudioLoopback&) = delete;
    AudioLoopback& operator=(const AudioLoopback&) = delete;

    /// Opens the default output for loopback. Fails if there is none, which a
    /// headless machine or a VM may not have; the caller then streams
    /// video-only rather than refusing the session.
    Status start(AudioCallback onAudio);

    /// Blocks until the thread has exited: no callback runs afterwards.
    void stop();

private:
    std::atomic<bool> running_{false};
    std::thread worker_;
};

}  // namespace desktophost::win
