#pragma once

#include <cstdint>
#include <memory>

namespace desktophost {

enum class MouseButton { left, right, middle };

/// Button bit values. These match DOM `MouseEvent.buttons` exactly, because
/// that is what the phone reads them from — 1 left, 2 right, 4 middle. Keeping
/// the same numbering means the mask crosses the wire without translation on
/// either side.
constexpr uint8_t kMaskLeft = 1;
constexpr uint8_t kMaskRight = 2;
constexpr uint8_t kMaskMiddle = 4;
constexpr uint8_t kMaskAll = kMaskLeft | kMaskRight | kMaskMiddle;

constexpr uint8_t buttonMask(MouseButton button) {
    switch (button) {
        case MouseButton::left:
            return kMaskLeft;
        case MouseButton::right:
            return kMaskRight;
        case MouseButton::middle:
            return kMaskMiddle;
    }
    return 0;
}

/// One display's rectangle in the OS's *global* coordinate space, in points.
///
/// Points, not pixels, and global, not display-local — that is what the
/// injection APIs take. On macOS this is `CGDisplayBounds`, whose origin is the
/// top-left of the main display, so a second monitor has a non-zero (and
/// possibly negative) origin. Mapping a normalised coordinate against the
/// captured frame's pixel dimensions instead would land every click on the
/// wrong monitor the moment we capture display 2.
struct DisplayBounds {
    double x = 0;
    double y = 0;
    double width = 0;
    double height = 0;

    bool valid() const { return width > 0 && height > 0; }
};

/// A point in that same global space.
struct ScreenPoint {
    double x = 0;
    double y = 0;
};

/// Synthesises pointer input into the OS.
///
/// Calls arrive on libdatachannel's thread (see InputRouter) and must not
/// block: on macOS `CGEventPost` is a fast non-blocking syscall, which is why
/// there is no worker thread between the channel and here. A backend that
/// cannot promise that needs one.
class IInputInjector {
public:
    virtual ~IInputInjector() = default;

    /// The captured display's rectangle, re-read rather than cached: the user
    /// can change resolution or unplug a monitor mid-session, and re-reading is
    /// what makes a normalised coordinate keep meaning the same thing.
    virtual DisplayBounds bounds() const = 0;

    /// `heldButtons` decides whether this is a move or a drag. macOS treats
    /// them as different events, and an app tracking a drag ignores a plain
    /// mouse-moved — so a drag sent as a move looks like the button was never
    /// held down.
    virtual void move(ScreenPoint point, uint8_t heldButtons) = 0;

    /// `clickCount` is 1 single, 2 double, 3 triple, and is passed through from
    /// the phone. On macOS it becomes `kCGMouseEventClickState`: two plain
    /// clicks in a row do not register as a double-click in most apps, so
    /// without this a double-tap does nothing recognisable.
    virtual void buttonDown(ScreenPoint point, MouseButton button, int clickCount) = 0;

    virtual void buttonUp(ScreenPoint point, MouseButton button, int clickCount) = 0;

    /// Scrolls whatever is under `point`. `dx`/`dy` are the wire's units —
    /// sender CSS pixels, DOM signs (positive dy scrolls down), one wheel
    /// notch = 100 — and each backend converts to its own. Backends keep the
    /// sub-unit remainder, so a touchpad's stream of small deltas is not
    /// rounded away one event at a time.
    virtual void scroll(ScreenPoint point, double dx, double dy) = 0;
};

/// `displayId` 0 means the main display, matching `CaptureConfig::displayId`.
/// Returns nullptr on a platform with no backend.
std::unique_ptr<IInputInjector> makeInputInjector(uint32_t displayId);

/// Whether the OS will accept synthesised input from this process.
///
/// On macOS this is the **Accessibility** TCC grant, which is a different
/// permission from the Screen Recording grant capture already needs — being
/// able to see the screen does not imply being able to click on it. Pass
/// `prompt` to raise the system dialog (once per process is enough).
bool inputInjectionPermitted(bool prompt);

}  // namespace desktophost
