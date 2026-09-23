#include "platform/win/d3d_device.h"

#include <d3d10.h>
#include <dxgi.h>

#include <cstdio>
#include <iterator>
#include <mutex>
#include <vector>

namespace desktophost::win {
namespace {

struct Attempt {
    D3D_DRIVER_TYPE driver;
    UINT flags;
    const char* label;
};

}  // namespace

std::string hresultMessage(const char* what, HRESULT hr) {
    char code[16];
    std::snprintf(code, sizeof(code), "0x%08lX", static_cast<unsigned long>(hr));
    return std::string(what) + " failed (HRESULT " + code + ")";
}

std::shared_ptr<const SharedDevice> sharedDevice(std::string* error) {
    static std::mutex mutex;
    static std::shared_ptr<const SharedDevice> cached;
    static std::string cachedError;

    std::lock_guard<std::mutex> lock(mutex);
    if (cached || !cachedError.empty()) {
        if (error != nullptr) {
            *error = cachedError;
        }
        return cached;
    }

    auto fail = [&](std::string message) -> std::shared_ptr<const SharedDevice> {
        cachedError = std::move(message);
        if (error != nullptr) {
            *error = cachedError;
        }
        return nullptr;
    };

    // Never shut down: the device lives for the process, and MFShutdown while
    // an MFT still holds our device manager is a crash, not a cleanup.
    if (const HRESULT hr = MFStartup(MF_VERSION, MFSTARTUP_LITE); FAILED(hr)) {
        return fail(hresultMessage("MFStartup", hr));
    }

    auto shared = std::make_shared<SharedDevice>();

    // BGRA: Windows Graphics Capture delivers B8G8R8A8. VIDEO_SUPPORT: the
    // video processor (BGRA -> NV12 on the GPU) and the encoder MFT need it.
    // The Basic Render Driver on GPU-less machines refuses VIDEO_SUPPORT, so
    // fall back without it — enough for the test-pattern source, and capture
    // reports the gap clearly instead of the whole process failing.
    const Attempt attempts[] = {
        {D3D_DRIVER_TYPE_HARDWARE,
         D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT, "hardware"},
        {D3D_DRIVER_TYPE_HARDWARE, D3D11_CREATE_DEVICE_BGRA_SUPPORT, "hardware, no video"},
        {D3D_DRIVER_TYPE_WARP, D3D11_CREATE_DEVICE_BGRA_SUPPORT, "WARP"},
    };
    const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};

    HRESULT lastHr = E_FAIL;
    for (const Attempt& attempt : attempts) {
        lastHr = D3D11CreateDevice(nullptr, attempt.driver, nullptr, attempt.flags, levels,
                                   static_cast<UINT>(std::size(levels)), D3D11_SDK_VERSION,
                                   &shared->device, nullptr, &shared->context);
        if (SUCCEEDED(lastHr)) {
            shared->videoSupport = (attempt.flags & D3D11_CREATE_DEVICE_VIDEO_SUPPORT) != 0;
            if (attempt.driver != D3D_DRIVER_TYPE_HARDWARE || !shared->videoSupport) {
                std::fprintf(stderr, "[d3d] using %s device: no GPU video support\n",
                             attempt.label);
            }
            break;
        }
    }
    if (FAILED(lastHr)) {
        return fail(hresultMessage("D3D11CreateDevice", lastHr));
    }

    ComPtr<ID3D10Multithread> multithread;
    if (SUCCEEDED(shared->device.As(&multithread))) {
        multithread->SetMultithreadProtected(TRUE);
    }

    ComPtr<IDXGIDevice> dxgiDevice;
    ComPtr<IDXGIAdapter> adapter;
    DXGI_ADAPTER_DESC adapterDesc{};
    if (SUCCEEDED(shared->device.As(&dxgiDevice)) &&
        SUCCEEDED(dxgiDevice->GetAdapter(&adapter)) &&
        SUCCEEDED(adapter->GetDesc(&adapterDesc))) {
        shared->adapterLuid = adapterDesc.AdapterLuid;
    }

    UINT resetToken = 0;
    if (const HRESULT hr = MFCreateDXGIDeviceManager(&resetToken, &shared->deviceManager);
        FAILED(hr)) {
        return fail(hresultMessage("MFCreateDXGIDeviceManager", hr));
    }
    if (const HRESULT hr = shared->deviceManager->ResetDevice(shared->device.Get(), resetToken);
        FAILED(hr)) {
        return fail(hresultMessage("IMFDXGIDeviceManager::ResetDevice", hr));
    }

    cached = std::move(shared);
    return cached;
}

HMONITOR resolveMonitor(uint32_t displayId) {
    if (displayId == 0) {
        return MonitorFromPoint(POINT{0, 0}, MONITOR_DEFAULTTOPRIMARY);
    }

    std::vector<HMONITOR> monitors;
    EnumDisplayMonitors(
        nullptr, nullptr,
        [](HMONITOR monitor, HDC, LPRECT, LPARAM data) -> BOOL {
            reinterpret_cast<std::vector<HMONITOR>*>(data)->push_back(monitor);
            return TRUE;
        },
        reinterpret_cast<LPARAM>(&monitors));

    if (displayId > monitors.size()) {
        return nullptr;
    }
    return monitors[displayId - 1];
}

void* retainTexture(ID3D11Texture2D* texture) {
    texture->AddRef();
    return texture;
}

void releaseTexture(void* handle) noexcept {
    static_cast<ID3D11Texture2D*>(handle)->Release();
}

}  // namespace desktophost::win
