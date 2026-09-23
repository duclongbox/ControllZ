#include "desktophost/input/input_injector.h"

// SendInput with absolute virtual-desktop coordinates — the Windows
// counterpart of input_injector_mac.cpp.

#include <windows.h>

#include "desktophost/input/pointer_mapping.h"
#include "platform/win/d3d_device.h"

namespace desktophost {
namespace {

DWORD downFlagFor(MouseButton button) {
    switch (button) {
        case MouseButton::left:
            return MOUSEEVENTF_LEFTDOWN;
        case MouseButton::right:
            return MOUSEEVENTF_RIGHTDOWN;
        case MouseButton::middle:
            return MOUSEEVENTF_MIDDLEDOWN;
    }
    return MOUSEEVENTF_LEFTDOWN;
}

DWORD upFlagFor(MouseButton button) {
    switch (button) {
        case MouseButton::left:
            return MOUSEEVENTF_LEFTUP;
        case MouseButton::right:
            return MOUSEEVENTF_RIGHTUP;
        case MouseButton::middle:
            return MOUSEEVENTF_MIDDLEUP;
    }
    return MOUSEEVENTF_LEFTUP;
}

DisplayBounds boundsOf(HMONITOR monitor) {
    MONITORINFO info{};
    info.cbSize = sizeof(info);
    if (monitor == nullptr || !GetMonitorInfoW(monitor, &info)) {
        return DisplayBounds{};
    }
    const RECT& r = info.rcMonitor;
    return DisplayBounds{static_cast<double>(r.left), static_cast<double>(r.top),
                         static_cast<double>(r.right - r.left),
                         static_cast<double>(r.bottom - r.top)};
}

/// An absolute move to `point`, in the 0…65535 virtual-desktop space. Virtual
/// desktop, not primary monitor: without MOUSEEVENTF_VIRTUALDESK the range
/// spans the primary monitor only and a second screen is unreachable.
INPUT absoluteMove(ScreenPoint point) {
    const double originX = GetSystemMetrics(SM_XVIRTUALSCREEN);
    const double originY = GetSystemMetrics(SM_YVIRTUALSCREEN);
    const double extentX = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    const double extentY = GetSystemMetrics(SM_CYVIRTUALSCREEN);

    INPUT input{};
    input.type = INPUT_MOUSE;
    input.mi.dx = toAbsoluteInput(point.x, originX, extentX);
    input.mi.dy = toAbsoluteInput(point.y, originY, extentY);
    input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    return input;
}

class WindowsInputInjector final : public IInputInjector {
public:
    explicit WindowsInputInjector(uint32_t displayId) : displayId_(displayId) {}

    DisplayBounds bounds() const override {
        // Physical pixels in virtual-desktop coordinates, because the process
        // is per-monitor DPI aware (see desktop-host.manifest) — the same
        // space SendInput addresses.
        const DisplayBounds bounds = boundsOf(win::resolveMonitor(displayId_));
        if (bounds.valid()) {
            return bounds;
        }
        // The captured monitor went away. Falling back to the primary keeps
        // input landing somewhere real rather than at the virtual origin.
        return boundsOf(win::resolveMonitor(0));
    }

    // Windows needs no drag/move distinction: a move while a button is down is
    // a drag, because the system tracks the button state itself.
    void move(ScreenPoint point, uint8_t heldButtons) override {
        (void)heldButtons;
        INPUT input = absoluteMove(point);
        SendInput(1, &input, sizeof(INPUT));
    }

    // `clickCount` is not forwarded: Windows builds double-clicks itself from
    // two presses within the double-click time and distance, which a phone
    // double-tap meets. There is no field to carry it in.
    void buttonDown(ScreenPoint point, MouseButton button, int clickCount) override {
        (void)clickCount;
        sendAt(point, downFlagFor(button));
    }

    void buttonUp(ScreenPoint point, MouseButton button, int clickCount) override {
        (void)clickCount;
        sendAt(point, upFlagFor(button));
    }

private:
    /// Move and press as one SendInput call, so no other input can land
    /// between them and the press happens where the phone tapped.
    static void sendAt(ScreenPoint point, DWORD buttonFlag) {
        INPUT inputs[2] = {absoluteMove(point), {}};
        inputs[1].type = INPUT_MOUSE;
        inputs[1].mi.dwFlags = buttonFlag;
        SendInput(2, inputs, sizeof(INPUT));
    }

    uint32_t displayId_;
};

}  // namespace

std::unique_ptr<IInputInjector> makeInputInjector(uint32_t displayId) {
    return std::make_unique<WindowsInputInjector>(displayId);
}

bool inputInjectionPermitted(bool prompt) {
    (void)prompt;
    // No grant to ask for. The limit Windows does impose (UIPI: no input into
    // windows of a higher integrity level, such as an elevated app or the UAC
    // prompt) is per target window, so there is nothing to check up front;
    // SendInput is silently ignored for those windows.
    return true;
}

}  // namespace desktophost
