#pragma once

#include <cstdint>
#include <utility>

namespace desktophost {

/// A captured screen frame that still lives in GPU memory.
///
/// The architecture invariant (CLAUDE.md) is that capture -> encode never
/// touches raw pixels on the CPU, so this type deliberately exposes no pixel
/// access at all: it is an owning handle that travels from the capture backend
/// to the encoder backend and nowhere else. `core/` sees EncodedFrame, never
/// this.
///
/// The underlying object is platform-specific and reference-counted by the OS
/// (an IOSurface-backed CVPixelBufferRef on macOS, an ID3D11Texture2D on
/// Windows). Ownership is expressed here rather than at the call sites because
/// the frame crosses a thread boundary — the capture queue produces it, the
/// encoder consumes it — and a raw CoreFoundation pointer handed across that
/// boundary without a retain is the classic use-after-free in this pipeline.
class PlatformFrame {
public:
    /// Releases one reference to the native handle. Supplied by the backend
    /// that created the frame so this header stays free of platform types.
    using ReleaseFn = void (*)(void*) noexcept;

    PlatformFrame() = default;

    /// Takes ownership of `handle`; the caller must have already retained it.
    PlatformFrame(void* handle, ReleaseFn release, int width, int height, int64_t ptsUs)
        : handle_(handle), release_(release), width_(width), height_(height), ptsUs_(ptsUs) {}

    ~PlatformFrame() { reset(); }

    PlatformFrame(const PlatformFrame&) = delete;
    PlatformFrame& operator=(const PlatformFrame&) = delete;

    PlatformFrame(PlatformFrame&& other) noexcept { moveFrom(other); }

    PlatformFrame& operator=(PlatformFrame&& other) noexcept {
        if (this != &other) {
            reset();
            moveFrom(other);
        }
        return *this;
    }

    bool valid() const { return handle_ != nullptr; }

    /// Only a platform backend may interpret this. Everything else treats the
    /// frame as opaque.
    void* nativeHandle() const { return handle_; }

    int width() const { return width_; }
    int height() const { return height_; }

    /// Capture time in microseconds on the host's monotonic clock.
    ///
    /// Carried from capture rather than derived from a frame counter: screen
    /// capture is variable-rate (no frames arrive while the screen is static),
    /// so "frame index * frame duration" would drift against wall time and
    /// make playback speed wander once this feeds the 90 kHz RTP clock.
    int64_t ptsUs() const { return ptsUs_; }

    void reset() {
        if (handle_ != nullptr && release_ != nullptr) {
            release_(handle_);
        }
        handle_ = nullptr;
        release_ = nullptr;
    }

private:
    void moveFrom(PlatformFrame& other) {
        handle_ = std::exchange(other.handle_, nullptr);
        release_ = std::exchange(other.release_, nullptr);
        width_ = other.width_;
        height_ = other.height_;
        ptsUs_ = other.ptsUs_;
    }

    void* handle_ = nullptr;
    ReleaseFn release_ = nullptr;
    int width_ = 0;
    int height_ = 0;
    int64_t ptsUs_ = 0;
};

}  // namespace desktophost
