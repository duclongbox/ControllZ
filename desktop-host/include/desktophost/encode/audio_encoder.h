#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <vector>

#include "desktophost/capture/audio_chunk.h"
#include "desktophost/status.h"

namespace desktophost {

/// One Opus packet. Like EncodedFrame, the point where audio stops being
/// anyone's platform type and becomes bytes for the packetizer.
struct EncodedAudioFrame {
    std::vector<std::byte> data;

    /// Capture time of the first sample in the packet, microseconds, same
    /// clock as EncodedFrame::ptsUs.
    int64_t ptsUs = 0;
};

struct AudioEncoderConfig {
    /// What the capturers deliver and what Opus runs at natively. Anything
    /// else is refused at start() rather than resampled: the capturers are
    /// configured to produce exactly this, so a mismatch is a bug upstream.
    int sampleRate = 48'000;
    int channels = 2;

    /// Game and music audio is full-band stereo; 128 kb/s is where Opus stops
    /// being distinguishable from the source for most listeners. Trivial next
    /// to the video's 8 Mb/s.
    int bitrateBps = 128'000;

    /// Packet duration. 20 ms is Opus's sweet spot: shorter packets cost
    /// proportionally more RTP header and lose the codec's look-ahead, longer
    /// ones add their whole length to the latency budget.
    int frameMs = 20;

    /// Discontinuous transmission: a silent desktop sends a one-byte marker
    /// every 400 ms instead of a packet every 20. Browsers decode the gaps as
    /// silence; nothing is heard switching on or off. Needs `complexity` of
    /// at least 7 — below that libopus skips the signal analysis the DTX
    /// decision is made from and the flag does nothing.
    bool dtx = true;

    /// 0-10. Seven is the lowest setting at which libopus runs its signal
    /// analysis, which both DTX and the music/speech mode decision depend on;
    /// a 20 ms stereo frame still encodes in well under a millisecond there.
    /// Ten is the last few percent of quality for several times the cycles.
    int complexity = 7;
};

/// Invoked on the thread that called encode(). Must not block.
using EncodedAudioCallback = std::function<void(const EncodedAudioFrame&)>;

/// Buffers PCM into fixed-length frames and encodes each one synchronously.
///
/// Synchronous on purpose, unlike IVideoEncoder: an Opus frame encodes in
/// well under a millisecond, so a worker thread would add a queue and a
/// hand-off for nothing. The capture thread calls encode() and the packet is
/// on its way before the call returns.
class IAudioEncoder {
public:
    virtual ~IAudioEncoder() = default;

    virtual Status start(EncodedAudioCallback onEncoded) = 0;

    /// Consumes the chunk. Emits zero or more packets on the callback, one per
    /// complete frame now buffered; the remainder waits for the next chunk.
    /// A chunk whose rate or channel count differ from the config is dropped.
    virtual void encode(const AudioChunk& chunk) = 0;

    /// Tears the encoder down. Idempotent. Must not run concurrently with
    /// encode(): stop the capturer first. Whatever partial frame is buffered
    /// is discarded — a trailing few milliseconds of silence is not worth a
    /// packet.
    virtual void stop() = 0;
};

/// Opus. Portable: the same backend on every platform.
std::unique_ptr<IAudioEncoder> makeOpusAudioEncoder(const AudioEncoderConfig& config);

}  // namespace desktophost
