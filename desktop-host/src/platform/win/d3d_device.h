#pragma once

// Internal to the Windows backends. Nothing under include/ may depend on this:
// the whole point of the capture/encode seams is that core/ never sees a
// platform type.

#include <d3d11.h>
#include <mfapi.h>
#include <mfidl.h>
#include <windows.h>
#include <wrl/client.h>

#include <cstdint>
#include <memory>
#include <string>

namespace desktophost::win {

using Microsoft::WRL::ComPtr;

/// The one D3D11 device capture and encode share.
///
/// On macOS an IOSurface is readable by anyone in the process, so capture and
/// encode never had to agree on anything. A D3D11 texture belongs to the
/// device that created it, so the encoder can only consume capture's frames
/// without a CPU round trip if both run on the same device. That is why this
/// is process-wide rather than owned by either backend.
struct SharedDevice {
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;

    /// Hands `device` to Media Foundation (MFT_MESSAGE_SET_D3D_MANAGER).
    ComPtr<IMFDXGIDeviceManager> deviceManager;

    /// Which GPU `device` lives on. The encoder MFT is enumerated for this
    /// adapter only: on a hybrid laptop the default H.264 encoder may belong
    /// to the other GPU, and handing it our textures fails or copies.
    LUID adapterLuid{};

    /// False on the Basic Render Driver / WARP fallback (CI runners, VMs).
    /// The video processor capture needs is unavailable there.
    bool videoSupport = false;
};

/// Creates the device on first use and returns the same one afterwards.
/// Thread-safe. On failure returns nullptr and describes why in `error`.
///
/// Also starts Media Foundation, and turns on D3D11 multithread protection:
/// the capture thread and the encoder's own threads use the immediate context
/// concurrently, which D3D11 otherwise does not allow.
std::shared_ptr<const SharedDevice> sharedDevice(std::string* error);

/// The monitor `displayId` names, matching CaptureConfig::displayId: 0 is the
/// primary monitor, N is the Nth monitor in EnumDisplayMonitors order.
/// Returns nullptr when N does not exist.
///
/// Capture and input both resolve through here, so "display 2" is the same
/// physical screen for what the phone sees and where its taps land.
HMONITOR resolveMonitor(uint32_t displayId);

/// "<what> failed (HRESULT 0x........)".
std::string hresultMessage(const char* what, HRESULT hr);

/// Adds a reference for a PlatformFrame to own, and the matching release. A
/// PlatformFrame's native handle on Windows is always an ID3D11Texture2D* on
/// the shared device.
void* retainTexture(ID3D11Texture2D* texture);
void releaseTexture(void* handle) noexcept;

}  // namespace desktophost::win
