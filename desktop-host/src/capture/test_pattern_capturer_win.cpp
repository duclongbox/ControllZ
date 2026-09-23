#include "desktophost/capture/test_pattern_capturer.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include "platform/win/d3d_device.h"

// The Windows twin of test_pattern_capturer_mac.cpp: NV12 textures on the
// shared D3D11 device, the same kind the real capturer produces, so the encoder
// under test takes its production input path.
//
// The pattern is drawn on the CPU and uploaded as the texture's initial data.
// That is fine here and only here: it is a synthetic source, not the capture
// path the GPU-resident invariant is about.

namespace desktophost {
namespace {

/// NV12 as D3D11 expects initial data for it: the luma plane, then the
/// interleaved chroma plane directly after it at the same pitch.
struct Nv12Image {
    std::vector<uint8_t> bytes;
    int pitch = 0;
};

Nv12Image allocate(int width, int height) {
    Nv12Image image;
    image.pitch = width;
    image.bytes.assign(static_cast<size_t>(width) * static_cast<size_t>(height) * 3 / 2, 128);
    return image;
}

/// A bar sweeping horizontally over a gradient: enough real motion that the
/// encoder produces non-trivial P-frames rather than near-empty ones.
void drawPattern(Nv12Image& image, int width, int height, int frameIndex) {
    const int barPosition = (frameIndex * 8) % std::max(width, 1);
    for (int y = 0; y < height; ++y) {
        uint8_t* row = image.bytes.data() + static_cast<size_t>(y) * image.pitch;
        for (int x = 0; x < width; ++x) {
            const bool inBar = x >= barPosition && x < barPosition + 32;
            row[x] = inBar ? 235 : static_cast<uint8_t>(16 + ((x + y) % 200));
        }
    }
    // Chroma stays at the neutral 128 it was allocated with.
}

void fillFlat(Nv12Image& image, int width, int height, int index) {
    const uint8_t luma = static_cast<uint8_t>(16 + (index * 7) % 200);
    std::memset(image.bytes.data(), luma, static_cast<size_t>(width) * static_cast<size_t>(height));
}

/// Uploads `image` into a new texture on the shared device, or returns null.
ID3D11Texture2D* createTexture(const Nv12Image& image, int width, int height) {
    auto shared = win::sharedDevice(nullptr);
    if (!shared) {
        return nullptr;
    }

    D3D11_TEXTURE2D_DESC desc{};
    desc.Width = static_cast<UINT>(width);
    desc.Height = static_cast<UINT>(height);
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_NV12;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    // Render-target, like the real capturer's video-processor output, so the
    // encoder sees an identically created texture.
    desc.BindFlags = D3D11_BIND_RENDER_TARGET;

    D3D11_SUBRESOURCE_DATA data{};
    data.pSysMem = image.bytes.data();
    data.SysMemPitch = static_cast<UINT>(image.pitch);

    ID3D11Texture2D* texture = nullptr;
    if (FAILED(shared->device->CreateTexture2D(&desc, &data, &texture))) {
        // WARP, on GPU-less machines, may refuse NV12 render targets.
        desc.BindFlags = 0;
        if (FAILED(shared->device->CreateTexture2D(&desc, &data, &texture))) {
            return nullptr;
        }
    }
    return texture;
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

        std::string error;
        if (!win::sharedDevice(&error)) {
            return Status::error("no D3D11 device: " + error);
        }

        running_.store(true);
        worker_ = std::thread([this, onFrame = std::move(onFrame)] {
            const auto started = std::chrono::steady_clock::now();
            const auto interval = std::chrono::nanoseconds(1'000'000'000 / fps_);
            Nv12Image image = allocate(width_, height_);
            int frameIndex = 0;

            while (running_.load()) {
                drawPattern(image, width_, height_, frameIndex++);
                ID3D11Texture2D* texture = createTexture(image, width_, height_);
                if (texture == nullptr) {
                    std::fprintf(stderr, "[test-pattern] could not create an NV12 texture\n");
                    return;
                }

                const auto ptsUs = std::chrono::duration_cast<std::chrono::microseconds>(
                                       std::chrono::steady_clock::now() - started)
                                       .count();

                // createTexture's reference is the one the frame owns.
                onFrame(PlatformFrame(texture, win::releaseTexture, width_, height_, ptsUs));

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
    Nv12Image image = allocate(width, height);
    fillFlat(image, width, height, index);
    ID3D11Texture2D* texture = createTexture(image, width, height);
    if (texture == nullptr) {
        return PlatformFrame{};
    }
    return PlatformFrame(texture, win::releaseTexture, width, height, ptsUs);
}

std::unique_ptr<IScreenCapturer> makeTestPatternCapturer(const CaptureConfig& config) {
    return std::make_unique<TestPatternCapturer>(config);
}

}  // namespace desktophost
