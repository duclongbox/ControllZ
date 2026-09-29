#include "desktophost/input/input_injector.h"

// CoreGraphics event synthesis plus the Accessibility trust check. Both are C
// APIs, so unlike capture and encode this backend needs no Objective-C.
#include <ApplicationServices/ApplicationServices.h>
// KBGetLayoutType / LMGetKbdType: whether this Mac's keyboard is ISO, which
// swaps two key codes (see key_codes.h).
#include <Carbon/Carbon.h>
// CapsLock state. A synthesised CapsLock key event does not toggle the lock on
// macOS — only IOHIDSystem's lock state does.
#include <IOKit/hidsystem/IOHIDLib.h>
#include <IOKit/hidsystem/IOHIDParameter.h>
#include <IOKit/hidsystem/IOLLEvent.h>

#include <atomic>
#include <cmath>
#include <cstdio>
#include <optional>
#include <string_view>

#include "desktophost/input/key_codes.h"

namespace desktophost {
namespace {

CGMouseButton toCgButton(MouseButton button) {
    switch (button) {
        case MouseButton::left:
            return kCGMouseButtonLeft;
        case MouseButton::right:
            return kCGMouseButtonRight;
        case MouseButton::middle:
            return kCGMouseButtonCenter;
    }
    return kCGMouseButtonLeft;
}

CGEventType downEventFor(MouseButton button) {
    switch (button) {
        case MouseButton::left:
            return kCGEventLeftMouseDown;
        case MouseButton::right:
            return kCGEventRightMouseDown;
        case MouseButton::middle:
            return kCGEventOtherMouseDown;
    }
    return kCGEventLeftMouseDown;
}

CGEventType upEventFor(MouseButton button) {
    switch (button) {
        case MouseButton::left:
            return kCGEventLeftMouseUp;
        case MouseButton::right:
            return kCGEventRightMouseUp;
        case MouseButton::middle:
            return kCGEventOtherMouseUp;
    }
    return kCGEventLeftMouseUp;
}

/// A move with a button held is a *drag*, and macOS gives it its own event
/// type. Sending kCGEventMouseMoved while the button is down is the classic
/// "selection never extends / the window never moves" bug: apps that track
/// drags listen for the dragged events and ignore plain moves.
CGEventType moveEventFor(uint8_t heldButtons) {
    if ((heldButtons & kMaskLeft) != 0) return kCGEventLeftMouseDragged;
    if ((heldButtons & kMaskRight) != 0) return kCGEventRightMouseDragged;
    if ((heldButtons & kMaskMiddle) != 0) return kCGEventOtherMouseDragged;
    return kCGEventMouseMoved;
}

/// Generic and left/right-specific flag bits for one modifier key. Real
/// events carry both, and some apps (games, terminal emulators) read the
/// device-specific half to tell left Shift from right.
struct ModifierBits {
    CGEventFlags generic;
    uint64_t device;
};

std::optional<ModifierBits> modifierBitsFor(std::string_view code) {
    if (code == "ShiftLeft") return ModifierBits{kCGEventFlagMaskShift, NX_DEVICELSHIFTKEYMASK};
    if (code == "ShiftRight") return ModifierBits{kCGEventFlagMaskShift, NX_DEVICERSHIFTKEYMASK};
    if (code == "ControlLeft") return ModifierBits{kCGEventFlagMaskControl, NX_DEVICELCTLKEYMASK};
    if (code == "ControlRight") return ModifierBits{kCGEventFlagMaskControl, NX_DEVICERCTLKEYMASK};
    if (code == "AltLeft") return ModifierBits{kCGEventFlagMaskAlternate, NX_DEVICELALTKEYMASK};
    if (code == "AltRight") return ModifierBits{kCGEventFlagMaskAlternate, NX_DEVICERALTKEYMASK};
    if (code == "MetaLeft") return ModifierBits{kCGEventFlagMaskCommand, NX_DEVICELCMDKEYMASK};
    if (code == "MetaRight") return ModifierBits{kCGEventFlagMaskCommand, NX_DEVICERCMDKEYMASK};
    return std::nullopt;
}

/// The flags a real Apple keyboard stamps on a key by itself: keypad keys say
/// so, and the navigation and function keys carry the Fn bit because on a
/// laptop that is how they are reached. Apps do read these — a text view
/// handles an arrow without NumericPad differently from one with it.
CGEventFlags intrinsicFlagsFor(CGKeyCode key) {
    switch (key) {
        case kVK_LeftArrow:
        case kVK_RightArrow:
        case kVK_UpArrow:
        case kVK_DownArrow:
            return kCGEventFlagMaskNumericPad | kCGEventFlagMaskSecondaryFn;
        case kVK_Home:
        case kVK_End:
        case kVK_PageUp:
        case kVK_PageDown:
        case kVK_ForwardDelete:
        case kVK_Help:
        case kVK_F1: case kVK_F2: case kVK_F3: case kVK_F4: case kVK_F5:
        case kVK_F6: case kVK_F7: case kVK_F8: case kVK_F9: case kVK_F10:
        case kVK_F11: case kVK_F12: case kVK_F13: case kVK_F14: case kVK_F15:
        case kVK_F16: case kVK_F17: case kVK_F18: case kVK_F19: case kVK_F20:
            return kCGEventFlagMaskSecondaryFn;
        case kVK_ANSI_KeypadDecimal:
        case kVK_ANSI_KeypadMultiply:
        case kVK_ANSI_KeypadPlus:
        case kVK_ANSI_KeypadClear:
        case kVK_ANSI_KeypadDivide:
        case kVK_ANSI_KeypadEnter:
        case kVK_ANSI_KeypadMinus:
        case kVK_ANSI_KeypadEquals:
        case kVK_ANSI_Keypad0: case kVK_ANSI_Keypad1: case kVK_ANSI_Keypad2:
        case kVK_ANSI_Keypad3: case kVK_ANSI_Keypad4: case kVK_ANSI_Keypad5:
        case kVK_ANSI_Keypad6: case kVK_ANSI_Keypad7: case kVK_ANSI_Keypad8:
        case kVK_ANSI_Keypad9:
            return kCGEventFlagMaskNumericPad;
        default:
            return 0;
    }
}

class MacInputInjector final : public IInputInjector {
public:
    explicit MacInputInjector(uint32_t displayId) : displayId_(displayId) {
        // MACH_PORT_NULL is the default main port, spelled so it builds on SDKs
        // before and after kIOMasterPortDefault was renamed.
        const io_service_t service =
            IOServiceGetMatchingService(MACH_PORT_NULL, IOServiceMatching(kIOHIDSystemClass));
        if (service != IO_OBJECT_NULL) {
            if (IOServiceOpen(service, mach_task_self(), kIOHIDParamConnectType, &hidSystem_) !=
                KERN_SUCCESS) {
                hidSystem_ = IO_OBJECT_NULL;
            }
            IOObjectRelease(service);
        }
        if (hidSystem_ == IO_OBJECT_NULL) {
            std::fprintf(stderr, "[input] IOHIDSystem unavailable — CapsLock will not toggle\n");
        }
    }

    ~MacInputInjector() override {
        if (hidSystem_ != IO_OBJECT_NULL) {
            IOServiceClose(hidSystem_);
        }
    }

    MacInputInjector(const MacInputInjector&) = delete;
    MacInputInjector& operator=(const MacInputInjector&) = delete;

    DisplayBounds bounds() const override {
        const CGRect rect = CGDisplayBounds(resolveDisplay());
        if (CGRectIsNull(rect) || CGRectIsEmpty(rect)) {
            // The captured display went away (unplugged, or asleep). Falling
            // back to the main display keeps input landing somewhere real
            // rather than at the global origin.
            const CGRect main = CGDisplayBounds(CGMainDisplayID());
            return DisplayBounds{main.origin.x, main.origin.y, main.size.width, main.size.height};
        }
        return DisplayBounds{rect.origin.x, rect.origin.y, rect.size.width, rect.size.height};
    }

    void move(ScreenPoint point, uint8_t heldButtons) override {
        // The button argument is ignored by CoreGraphics for a plain move but
        // is read for a drag, so it has to name the button actually held.
        MouseButton dragging = MouseButton::left;
        if ((heldButtons & kMaskRight) != 0) dragging = MouseButton::right;
        else if ((heldButtons & kMaskMiddle) != 0) dragging = MouseButton::middle;

        post(moveEventFor(heldButtons), point, toCgButton(dragging), heldButtons == 0 ? 0 : 1);
    }

    void buttonDown(ScreenPoint point, MouseButton button, int clickCount) override {
        post(downEventFor(button), point, toCgButton(button), clickCount);
    }

    void buttonUp(ScreenPoint point, MouseButton button, int clickCount) override {
        post(upEventFor(button), point, toCgButton(button), clickCount);
    }

    void scroll(ScreenPoint point, double dx, double dy) override {
        // Pixel units, which are what a trackpad produces and what apps scroll
        // smoothly by. CoreGraphics' signs are the opposite of the DOM's on
        // both axes: wheel 1 positive scrolls up, wheel 2 positive scrolls
        // left. The intent is that the direction the user's own browser chose
        // is the one the Mac shows, i.e. that "natural scrolling" on the host
        // does not re-invert a synthesised event. Unverified on hardware: if
        // scrolling runs backwards with natural scrolling on, this is where.
        pendingX_ -= dx;
        pendingY_ -= dy;
        const auto wheelY = static_cast<int32_t>(std::trunc(pendingY_));
        const auto wheelX = static_cast<int32_t>(std::trunc(pendingX_));
        if (wheelX == 0 && wheelY == 0) {
            return;
        }
        pendingY_ -= wheelY;
        pendingX_ -= wheelX;

        CGEventRef event =
            CGEventCreateScrollWheelEvent2(nullptr, kCGScrollEventUnitPixel, 2, wheelY, wheelX, 0);
        if (event == nullptr) {
            return;
        }
        // A scroll goes to the window under the event's location, which by
        // default is wherever the cursor was; setting it pins the scroll to
        // the point the user's pointer is actually over.
        CGEventSetLocation(event, CGPointMake(point.x, point.y));
        // Option-scroll, Shift-scroll (horizontal in many apps) and friends.
        CGEventSetFlags(event, modifierFlags());
        CGEventPost(kCGHIDEventTap, event);
        CFRelease(event);
    }

    bool key(std::string_view code, bool down, bool repeat) override {
        const bool iso = KBGetLayoutType(LMGetKbdType()) == kKeyboardISO;
        const auto keyCode = macKeyCodeFor(code, iso);
        if (!keyCode) {
            return false;
        }

        if (code == "CapsLock") {
            // Toggled on the press only. The phone turns a Mac client's
            // on/off-style CapsLock events into press+release pairs, so every
            // press here is one flip, wherever it came from.
            if (down && !repeat) {
                toggleCapsLock();
            }
            return true;
        }

        const auto modifier = modifierBitsFor(code);
        if (modifier) {
            if (down) {
                heldDeviceBits_.fetch_or(modifier->device);
            } else {
                heldDeviceBits_.fetch_and(~modifier->device);
            }
        }

        CGEventRef event = CGEventCreateKeyboardEvent(nullptr, *keyCode, down);
        if (event == nullptr) {
            return true;
        }
        if (modifier) {
            // What a real keyboard sends for a modifier: not a key down/up but
            // a flags change, carrying the new state. Apps that track
            // modifiers (and the system's own shortcut handling) watch these.
            CGEventSetType(event, kCGEventFlagsChanged);
        }
        CGEventSetFlags(event, modifierFlags() | capsLockFlag() | intrinsicFlagsFor(*keyCode));
        // Characters come from the key code through the layout for this
        // keyboard type, so the event has to name the type the ISO decision
        // above was made for.
        CGEventSetIntegerValueField(event, kCGKeyboardEventKeyboardType, LMGetKbdType());
        if (repeat) {
            CGEventSetIntegerValueField(event, kCGKeyboardEventAutorepeat, 1);
        }
        CGEventPost(kCGHIDEventTap, event);
        CFRelease(event);
        return true;
    }

private:
    CGDirectDisplayID resolveDisplay() const {
        return displayId_ == 0 ? CGMainDisplayID() : static_cast<CGDirectDisplayID>(displayId_);
    }

    /// Flags for the modifiers the *phone* holds. The system's own modifier
    /// state only follows the physical keyboard, so without these a
    /// synthesised Shift+A types "a" and Shift-click is a plain click.
    CGEventFlags modifierFlags() const {
        const uint64_t device = heldDeviceBits_.load();
        CGEventFlags flags = static_cast<CGEventFlags>(device);
        if ((device & (NX_DEVICELSHIFTKEYMASK | NX_DEVICERSHIFTKEYMASK)) != 0)
            flags |= kCGEventFlagMaskShift;
        if ((device & (NX_DEVICELCTLKEYMASK | NX_DEVICERCTLKEYMASK)) != 0)
            flags |= kCGEventFlagMaskControl;
        if ((device & (NX_DEVICELALTKEYMASK | NX_DEVICERALTKEYMASK)) != 0)
            flags |= kCGEventFlagMaskAlternate;
        if ((device & (NX_DEVICELCMDKEYMASK | NX_DEVICERCMDKEYMASK)) != 0)
            flags |= kCGEventFlagMaskCommand;
        return flags;
    }

    /// Read on every key, not cached: the person at the Mac can press the real
    /// CapsLock too, and the letter's case has to follow the actual lock.
    CGEventFlags capsLockFlag() const {
        bool locked = false;
        if (hidSystem_ != IO_OBJECT_NULL &&
            IOHIDGetModifierLockState(hidSystem_, kIOHIDCapsLockState, &locked) == KERN_SUCCESS &&
            locked) {
            return kCGEventFlagMaskAlphaShift;
        }
        return 0;
    }

    void toggleCapsLock() {
        bool locked = false;
        if (hidSystem_ == IO_OBJECT_NULL ||
            IOHIDGetModifierLockState(hidSystem_, kIOHIDCapsLockState, &locked) != KERN_SUCCESS) {
            return;
        }
        IOHIDSetModifierLockState(hidSystem_, kIOHIDCapsLockState, !locked);
    }

    void post(CGEventType type, ScreenPoint point, CGMouseButton button, int clickState) const {
        CGEventRef event =
            CGEventCreateMouseEvent(nullptr, type, CGPointMake(point.x, point.y), button);
        if (event == nullptr) {
            return;
        }
        // The double-click carrier. Two independent clicks at the same spot are
        // two single clicks to every app that asks; it is this field, not the
        // timing, that makes the second one a double.
        CGEventSetIntegerValueField(event, kCGMouseEventClickState, clickState);
        // Shift-click, Cmd-click, Option-drag: the modifiers held on the
        // keys channel have to ride on the pointer events too.
        CGEventSetFlags(event, modifierFlags());

        // kCGHIDEventTap posts at the lowest level, so the event reaches the
        // window server the way a real device's would and moves the visible
        // cursor with it.
        CGEventPost(kCGHIDEventTap, event);
        CFRelease(event);
    }

    uint32_t displayId_;
    // Sub-pixel remainder carried to the next scroll. Only touched from
    // InputRouter, under its lock.
    double pendingX_ = 0;
    double pendingY_ = 0;
    // NX_DEVICE* bits of the modifiers the phone holds. Atomic because the
    // keys channel writes it under KeyboardRouter's lock while pointer events
    // read it under InputRouter's — two different threads.
    std::atomic<uint64_t> heldDeviceBits_{0};
    io_connect_t hidSystem_ = IO_OBJECT_NULL;
};

}  // namespace

std::unique_ptr<IInputInjector> makeInputInjector(uint32_t displayId) {
    return std::make_unique<MacInputInjector>(displayId);
}

bool inputInjectionPermitted(bool prompt) {
    if (!prompt) {
        return AXIsProcessTrusted();
    }

    const void* keys[] = {kAXTrustedCheckOptionPrompt};
    const void* values[] = {kCFBooleanTrue};
    CFDictionaryRef options =
        CFDictionaryCreate(nullptr, keys, values, 1, &kCFTypeDictionaryKeyCallBacks,
                           &kCFTypeDictionaryValueCallBacks);
    const bool trusted = AXIsProcessTrustedWithOptions(options);
    if (options != nullptr) {
        CFRelease(options);
    }
    return trusted;
}

}  // namespace desktophost
