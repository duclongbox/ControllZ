// Windows Graphics Capture -> D3D11 video processor (BGRA -> NV12, scaled) ->
// PlatformFrame. The Windows counterpart of screen_capturer_mac.mm.
//
// Every pixel stays on the GPU: WGC hands us a texture on the shared device,
// the video processor converts it into a fresh NV12 texture on that same
// device, and the encoder reads that texture directly.

#include <unknwn.h>  // before C++/WinRT, so it can interoperate with classic COM

#include <d3d11_1.h>
#include <dxgi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/Windows.Graphics.DirectX.h>

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <memory>
#include <mutex>
#include <string>

#include "desktophost/capture/capture_size.h"
#include "desktophost/capture/screen_capturer.h"
#include "platform/win/d3d_device.h"

namespace desktophost {
namespace {

namespace wgc = winrt::Windows::Graphics::Capture;
namespace wgd = winrt::Windows::Graphics::DirectX;

using win::ComPtr;
using win::hresultMessage;

constexpr auto kPixelFormat = wgd::DirectXPixelFormat::B8G8R8A8UIntNormalized;
constexpr int32_t kPoolBuffers = 2;

/// True while this thread is inside a frame callback, so stop() called from
/// one knows not to wait for itself.
thread_local bool tInCaptureCallback = false;

std::string describe(const winrt::hresult_error& error) {
    return hresultMessage(winrt::to_string(error.message()).c_str(), error.code());
}

// ---------------------------------------------------------------------------
// BGRA -> NV12 on the GPU
// ---------------------------------------------------------------------------

/// Wraps the D3D11 video processor: colour conversion and scaling in one
/// fixed-function pass, no shaders of ours and no CPU involvement.
class Nv12Converter {
public:
    Status init(const win::SharedDevice& shared, int inW, int inH, int outW, int outH) {
        reset();
        HRESULT hr = shared.device.As(&videoDevice_);
        if (FAILED(hr)) {
            return Status::error(hresultMessage("QueryInterface(ID3D11VideoDevice)", hr));
        }
        if (FAILED(hr = shared.context.As(&videoContext_))) {
            return Status::error(hresultMessage("QueryInterface(ID3D11VideoContext)", hr));
        }
        device_ = shared.device;

        D3D11_VIDEO_PROCESSOR_CONTENT_DESC desc{};
        desc.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
        desc.InputWidth = static_cast<UINT>(inW);
        desc.InputHeight = static_cast<UINT>(inH);
        desc.OutputWidth = static_cast<UINT>(outW);
        desc.OutputHeight = static_cast<UINT>(outH);
        desc.InputFrameRate = {60, 1};
        desc.OutputFrameRate = {60, 1};
        desc.Usage = D3D11_VIDEO_USAGE_OPTIMAL_SPEED;
        if (FAILED(hr = videoDevice_->CreateVideoProcessorEnumerator(&desc, &enumerator_))) {
            return Status::error(hresultMessage("CreateVideoProcessorEnumerator", hr));
        }

        UINT support = 0;
        if (FAILED(enumerator_->CheckVideoProcessorFormat(DXGI_FORMAT_NV12, &support)) ||
            (support & D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_OUTPUT) == 0) {
            return Status::error("GPU video processor cannot output NV12");
        }
        if (FAILED(hr = videoDevice_->CreateVideoProcessor(enumerator_.Get(), 0, &processor_))) {
            return Status::error(hresultMessage("CreateVideoProcessor", hr));
        }

        outW_ = outW;
        outH_ = outH;
        configure();
        return Status::ok();
    }

    /// A new NV12 texture holding `source` (its top-left `contentW x contentH`)
    /// scaled to the output size, or null on failure.
    ///
    /// A fresh texture per frame, not a ring: the frame's lifetime ends
    /// whenever the encoder releases it, which nothing here can observe, and
    /// reusing a texture the encoder is still reading tears the picture.
    ComPtr<ID3D11Texture2D> convert(ID3D11Texture2D* source, int contentW, int contentH) {
        D3D11_TEXTURE2D_DESC desc{};
        desc.Width = static_cast<UINT>(outW_);
        desc.Height = static_cast<UINT>(outH_);
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.Format = DXGI_FORMAT_NV12;
        desc.SampleDesc.Count = 1;
        desc.Usage = D3D11_USAGE_DEFAULT;
        desc.BindFlags = D3D11_BIND_RENDER_TARGET;

        ComPtr<ID3D11Texture2D> output;
        if (FAILED(device_->CreateTexture2D(&desc, nullptr, &output))) {
            return nullptr;
        }

        D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC outputDesc{};
        outputDesc.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
        ComPtr<ID3D11VideoProcessorOutputView> outputView;
        if (FAILED(videoDevice_->CreateVideoProcessorOutputView(output.Get(), enumerator_.Get(),
                                                                &outputDesc, &outputView))) {
            return nullptr;
        }

        D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC inputDesc{};
        inputDesc.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
        ComPtr<ID3D11VideoProcessorInputView> inputView;
        if (FAILED(videoDevice_->CreateVideoProcessorInputView(source, enumerator_.Get(),
                                                               &inputDesc, &inputView))) {
            return nullptr;
        }

        // The pool texture can be larger than the picture in it (the display
        // shrank and the pool has not been recreated yet), so read only the
        // content rectangle.
        const RECT sourceRect{0, 0, contentW, contentH};
        videoContext_->VideoProcessorSetStreamSourceRect(processor_.Get(), 0, TRUE, &sourceRect);

        D3D11_VIDEO_PROCESSOR_STREAM stream{};
        stream.Enable = TRUE;
        stream.pInputSurface = inputView.Get();
        if (FAILED(videoContext_->VideoProcessorBlt(processor_.Get(), outputView.Get(), 0, 1,
                                                    &stream))) {
            return nullptr;
        }
        return output;
    }

    void reset() {
        processor_.Reset();
        enumerator_.Reset();
        videoContext_.Reset();
        videoDevice_.Reset();
        device_.Reset();
    }

private:
    void configure() {
        const RECT outputRect{0, 0, outW_, outH_};
        videoContext_->VideoProcessorSetStreamDestRect(processor_.Get(), 0, TRUE, &outputRect);
        videoContext_->VideoProcessorSetOutputTargetRect(processor_.Get(), TRUE, &outputRect);
        videoContext_->VideoProcessorSetStreamFrameFormat(processor_.Get(), 0,
                                                          D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
        // No driver "enhancements" (denoise, edge enhancement): text on a
        // desktop is exactly what those damage.
        videoContext_->VideoProcessorSetStreamAutoProcessingMode(processor_.Get(), 0, FALSE);

        // Full-range sRGB in, BT.709 limited range out — what the encoder's
        // media types declare, so the colours the phone shows are the ones
        // on the screen.
        ComPtr<ID3D11VideoContext1> context1;
        if (SUCCEEDED(videoContext_.As(&context1))) {
            context1->VideoProcessorSetStreamColorSpace1(processor_.Get(), 0,
                                                         DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709);
            context1->VideoProcessorSetOutputColorSpace1(processor_.Get(),
                                                         DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709);
        } else {
            D3D11_VIDEO_PROCESSOR_COLOR_SPACE input{};
            input.RGB_Range = 0;  // 0-255
            videoContext_->VideoProcessorSetStreamColorSpace(processor_.Get(), 0, &input);
            D3D11_VIDEO_PROCESSOR_COLOR_SPACE output{};
            output.YCbCr_Matrix = 1;  // BT.709
            output.Nominal_Range = D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_16_235;
            videoContext_->VideoProcessorSetOutputColorSpace(processor_.Get(), &output);
        }
    }

    ComPtr<ID3D11Device> device_;
    ComPtr<ID3D11VideoDevice> videoDevice_;
    ComPtr<ID3D11VideoContext> videoContext_;
    ComPtr<ID3D11VideoProcessorEnumerator> enumerator_;
    ComPtr<ID3D11VideoProcessor> processor_;
    int outW_ = 0;
    int outH_ = 0;
};

// ---------------------------------------------------------------------------
// Capturer
// ---------------------------------------------------------------------------

/// Callback state shared with WinRT event handlers, which can outlive stop()
/// by the width of a race; they reach the callbacks only through here.
struct CaptureSink {
    std::mutex mutex;
    std::condition_variable idle;
    bool running = false;
    int inFlight = 0;
    FrameCallback onFrame;
    CaptureErrorCallback onError;
};

class WindowsScreenCapturer final : public IScreenCapturer {
public:
    explicit WindowsScreenCapturer(const CaptureConfig& config)
        : config_(config), sink_(std::make_shared<CaptureSink>()) {}

    ~WindowsScreenCapturer() override { stop(); }

    Status start(FrameCallback onFrame, CaptureErrorCallback onError) override {
        if (session_) {
            return Status::error("capture already started");
        }
        try {
            return startCapture(std::move(onFrame), std::move(onError));
        } catch (const winrt::hresult_error& error) {
            teardown();
            return Status::error("capture failed to start: " + describe(error));
        }
    }

    void stop() override {
        {
            std::unique_lock<std::mutex> lock(sink_->mutex);
            if (!sink_->running && !session_) {
                return;
            }
            sink_->running = false;
        }

        teardown();

        // The running flag only stops handlers that have not read it yet; one
        // already inside the callback may still be running, and the caller is
        // about to tear the encoder down. Wait it out — unless stop() is being
        // called from inside that callback, which would wait on itself.
        std::unique_lock<std::mutex> lock(sink_->mutex);
        const int self = tInCaptureCallback ? 1 : 0;
        sink_->idle.wait(lock, [&] { return sink_->inFlight <= self; });
    }

    int width() const override { return width_; }
    int height() const override { return height_; }

private:
    Status startCapture(FrameCallback onFrame, CaptureErrorCallback onError) {
        // The frame pool's events arrive on a system thread pool; this only
        // has to make WinRT activation legal on the calling thread.
        try {
            winrt::init_apartment(winrt::apartment_type::multi_threaded);
        } catch (const winrt::hresult_error&) {
            // Already initialised on this thread (possibly as STA): fine.
        }

        if (!wgc::GraphicsCaptureSession::IsSupported()) {
            return Status::error("Windows Graphics Capture is not supported on this system "
                                 "(needs Windows 10 1903 or later)");
        }

        std::string error;
        device_ = win::sharedDevice(&error);
        if (!device_) {
            return Status::error("no D3D11 device: " + error);
        }
        if (!device_->videoSupport) {
            return Status::error("this GPU driver has no D3D11 video support, which screen "
                                 "capture needs for colour conversion");
        }

        const HMONITOR monitor = win::resolveMonitor(config_.displayId);
        if (monitor == nullptr) {
            return Status::error("display " + std::to_string(config_.displayId) + " not found");
        }

        auto interop = winrt::get_activation_factory<wgc::GraphicsCaptureItem,
                                                     IGraphicsCaptureItemInterop>();
        wgc::GraphicsCaptureItem item{nullptr};
        winrt::check_hresult(interop->CreateForMonitor(
            monitor, winrt::guid_of<wgc::GraphicsCaptureItem>(), winrt::put_abi(item)));

        ComPtr<IDXGIDevice> dxgiDevice;
        winrt::check_hresult(device_->device.As(&dxgiDevice));
        winrt::com_ptr<::IInspectable> inspectable;
        winrt::check_hresult(
            CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.Get(), inspectable.put()));
        d3dDevice_ = inspectable.as<wgd::Direct3D11::IDirect3DDevice>();

        // WGC reports the monitor in physical pixels (the manifest makes the
        // process per-monitor DPI aware), so this is the real panel size.
        const auto itemSize = item.Size();
        const CaptureSize size =
            fitWithin(itemSize.Width, itemSize.Height, config_.maxWidth, config_.maxHeight);
        width_ = size.width;
        height_ = size.height;

        if (Status status = converter_.init(*device_, itemSize.Width, itemSize.Height, width_,
                                             height_);
            status.failed()) {
            return status;
        }
        poolSize_ = itemSize;

        {
            std::lock_guard<std::mutex> lock(sink_->mutex);
            sink_->onFrame = std::move(onFrame);
            sink_->onError = std::move(onError);
            sink_->running = true;
        }

        // Free-threaded: FrameArrived fires on a system worker thread, so no
        // message loop or dispatcher queue is needed.
        pool_ = wgc::Direct3D11CaptureFramePool::CreateFreeThreaded(d3dDevice_, kPixelFormat,
                                                                    kPoolBuffers, itemSize);
        session_ = pool_.CreateCaptureSession(item);
        try {
            session_.IsCursorCaptureEnabled(config_.showsCursor);
        } catch (const winrt::hresult_error&) {
            // Windows 10 before 2004: the cursor is always captured.
        }

        // `sink` is captured by value and checked before `this` is touched: a
        // handler already dispatched when stop() revokes it can still run,
        // possibly after this object is gone. Past the running check, stop()
        // is guaranteed to wait for it.
        auto sink = sink_;
        frameArrived_ = pool_.FrameArrived(
            winrt::auto_revoke,
            [this, sink](const wgc::Direct3D11CaptureFramePool& pool,
                         const winrt::Windows::Foundation::IInspectable&) {
                FrameCallback callback;
                {
                    std::lock_guard<std::mutex> lock(sink->mutex);
                    if (!sink->running) {
                        return;
                    }
                    ++sink->inFlight;
                    callback = sink->onFrame;
                }
                onFrameArrived(pool, callback);
            });

        // Fires when the monitor is unplugged, or capture is revoked.
        itemClosed_ = item.Closed(winrt::auto_revoke, [sink](const wgc::GraphicsCaptureItem&,
                                                             const winrt::Windows::Foundation::IInspectable&) {
            CaptureErrorCallback callback;
            {
                std::lock_guard<std::mutex> lock(sink->mutex);
                if (!sink->running) {
                    return;
                }
                sink->running = false;
                callback = sink->onError;
            }
            if (callback) {
                callback(Status::error("capture stopped: the display went away"));
            }
        });
        item_ = item;

        // Synchronous: a refusal throws here, and is reported by start()
        // rather than as a silent black stream.
        session_.StartCapture();
        return Status::ok();
    }

    /// Runs with `inFlight` already counted.
    void onFrameArrived(const wgc::Direct3D11CaptureFramePool& pool, const FrameCallback& callback) {
        tInCaptureCallback = true;

        // An exception escaping a WinRT event handler terminates the process.
        try {
            deliver(pool, callback);
        } catch (const winrt::hresult_error& error) {
            std::fprintf(stderr, "[capture] %s\n", describe(error).c_str());
        }

        tInCaptureCallback = false;
        {
            std::lock_guard<std::mutex> lock(sink_->mutex);
            --sink_->inFlight;
        }
        sink_->idle.notify_all();
    }

    void deliver(const wgc::Direct3D11CaptureFramePool& pool, const FrameCallback& callback) {
        const wgc::Direct3D11CaptureFrame frame = pool.TryGetNextFrame();
        if (!frame || !callback) {
            return;
        }

        const auto content = frame.ContentSize();
        if (content.Width != poolSize_.Width || content.Height != poolSize_.Height) {
            // Resolution changed. Output size stays fixed — the encoder was
            // opened at it — and the video processor rescales into it.
            pool.Recreate(d3dDevice_, kPixelFormat, kPoolBuffers, content);
            poolSize_ = content;
            if (Status status =
                    converter_.init(*device_, content.Width, content.Height, width_, height_);
                status.failed()) {
                std::fprintf(stderr, "[capture] %s\n", status.message().c_str());
            }
            return;  // this frame's texture belongs to the old pool
        }

        auto access = frame.Surface()
                          .as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
        ComPtr<ID3D11Texture2D> source;
        winrt::check_hresult(access->GetInterface(IID_PPV_ARGS(&source)));

        ComPtr<ID3D11Texture2D> nv12 = converter_.convert(source.Get(), content.Width,
                                                          content.Height);
        if (!nv12) {
            return;
        }

        // QPC-based, like ScreenCaptureKit's host-clock timestamps.
        const int64_t ptsUs =
            std::chrono::duration_cast<std::chrono::microseconds>(frame.SystemRelativeTime())
                .count();

        callback(PlatformFrame(win::retainTexture(nv12.Get()), win::releaseTexture, width_,
                               height_, ptsUs));
    }

    void teardown() {
        frameArrived_.revoke();
        itemClosed_.revoke();
        try {
            if (session_) {
                session_.Close();
            }
            if (pool_) {
                pool_.Close();
            }
        } catch (const winrt::hresult_error&) {
            // Already closed by the system (display removed).
        }
        session_ = nullptr;
        pool_ = nullptr;
        item_ = nullptr;
    }

    CaptureConfig config_;
    std::shared_ptr<CaptureSink> sink_;
    std::shared_ptr<const win::SharedDevice> device_;
    Nv12Converter converter_;

    wgd::Direct3D11::IDirect3DDevice d3dDevice_{nullptr};
    wgc::GraphicsCaptureItem item_{nullptr};
    wgc::Direct3D11CaptureFramePool pool_{nullptr};
    wgc::GraphicsCaptureSession session_{nullptr};
    wgc::Direct3D11CaptureFramePool::FrameArrived_revoker frameArrived_;
    wgc::GraphicsCaptureItem::Closed_revoker itemClosed_;

    /// Only touched on the frame-arrived thread after start().
    winrt::Windows::Graphics::SizeInt32 poolSize_{};

    int width_ = 0;
    int height_ = 0;
};

}  // namespace

std::unique_ptr<IScreenCapturer> makeScreenCapturer(const CaptureConfig& config) {
    return std::make_unique<WindowsScreenCapturer>(config);
}

}  // namespace desktophost
