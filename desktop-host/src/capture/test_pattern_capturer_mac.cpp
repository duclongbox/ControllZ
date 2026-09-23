#include "desktophost/capture/test_pattern_capturer.h"

#include <CoreVideo/CoreVideo.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <thread>

namespace desktophost {
namespace {

/// Allocates an IOSurface-backed NV12 buffer, matching what ScreenCaptureKit
/// hands us so the encoder path under test is the real one.
CVPixelBufferRef createNv12Buffer(int width, int height) {
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
    return buffer;
}

void releasePixelBuffer(void* handle) noexcept {
    CVPixelBufferRelease(static_cast<CVPixelBufferRef>(handle));
}

/// A bar sweeping horizontally over a gradient: enough real motion that the
/// encoder produces non-trivial P-frames rather than near-empty ones.
void drawPattern(CVPixelBufferRef buffer, int frameIndex) {
    CVPixelBufferLockBaseAddress(buffer, 0);

    const size_t width = CVPixelBufferGetWidthOfPlane(buffer, 0);
    const size_t height = CVPixelBufferGetHeightOfPlane(buffer, 0);
    const size_t lumaStride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0);
    auto* luma = static_cast<uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(buffer, 0));

    const size_t barPosition = static_cast<size_t>(frameIndex * 8) % std::max<size_t>(width, 1);
    for (size_t y = 0; y < height; ++y) {
        uint8_t* row = luma + y * lumaStride;
        for (size_t x = 0; x < width; ++x) {
            const bool inBar = x >= barPosition && x < barPosition + 32;
            row[x] = inBar ? 235 : static_cast<uint8_t>(16 + ((x + y) % 200));
        }
    }

    const size_t chromaHeight = CVPixelBufferGetHeightOfPlane(buffer, 1);
    const size_t chromaStride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 1);
    auto* chroma = static_cast<uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(buffer, 1));
    for (size_t y = 0; y < chromaHeight; ++y) {
        std::memset(chroma + y * chromaStride, 128, chromaStride);  // neutral colour
    }

    CVPixelBufferUnlockBaseAddress(buffer, 0);
}

class TestPatternCapturer final : public IScreenCapturer {
public:
    explicit TestPatternCapturer(const CaptureConfig& config)
        : width_(std::max(2, config.maxWidth & ~1)),
          height_(std::max(2, config.maxHeight & ~1)),
          fps_(std::max(1, config.maxFps)) {}

    ~TestPatternCapturer() override { stop(); }

    Status start(FrameCallback onFrame, CaptureErrorCallback onError) override {
        if (running_.load()) {
            return Status::error("capture already started");
        }
        (void)onError;  // a synthetic source has no asynchronous failure mode

        running_.store(true);
        worker_ = std::thread([this, onFrame = std::move(onFrame)] {
            const auto started = std::chrono::steady_clock::now();
            const auto interval = std::chrono::nanoseconds(1'000'000'000 / fps_);
            int frameIndex = 0;

            while (running_.load()) {
                CVPixelBufferRef buffer = createNv12Buffer(width_, height_);
                if (buffer == nullptr) {
                    return;
                }
                drawPattern(buffer, frameIndex++);

                const auto now = std::chrono::steady_clock::now();
                const auto ptsUs =
                    std::chrono::duration_cast<std::chrono::microseconds>(now - started).count();

                onFrame(PlatformFrame(buffer, releasePixelBuffer, width_, height_, ptsUs));

                std::this_thread::sleep_for(interval);
            }
        });

        return Status::ok();
    }

    void stop() override {
        running_.store(false);
        if (worker_.joinable()) {
            worker_.join();
        }
    }

    int width() const override { return width_; }
    int height() const override { return height_; }

private:
    int width_;
    int height_;
    int fps_;
    std::atomic<bool> running_{false};
    std::thread worker_;
};

}  // namespace

PlatformFrame makeTestPatternFrame(int width, int height, int index, int64_t ptsUs) {
    CVPixelBufferRef buffer = createNv12Buffer(width, height);
    if (buffer == nullptr) {
        return PlatformFrame{};
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
    return PlatformFrame(buffer, releasePixelBuffer, width, height, ptsUs);
}

std::unique_ptr<IScreenCapturer> makeTestPatternCapturer(const CaptureConfig& config) {
    return std::make_unique<TestPatternCapturer>(config);
}

}  // namespace desktophost
