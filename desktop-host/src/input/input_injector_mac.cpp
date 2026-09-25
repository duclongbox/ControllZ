#include "desktophost/input/input_injector.h"

// CoreGraphics event synthesis plus the Accessibility trust check. Both are C
// APIs, so unlike capture and encode this backend needs no Objective-C.
#include <ApplicationServices/ApplicationServices.h>

#include <cmath>
#include <cstdio>

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

class MacInputInjector final : public IInputInjector {
public:
    explicit MacInputInjector(uint32_t displayId) : displayId_(displayId) {}

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
        CGEventPost(kCGHIDEventTap, event);
        CFRelease(event);
    }

private:
    CGDirectDisplayID resolveDisplay() const {
        return displayId_ == 0 ? CGMainDisplayID() : static_cast<CGDirectDisplayID>(displayId_);
    }

    static void post(CGEventType type, ScreenPoint point, CGMouseButton button, int clickState) {
        CGEventRef event =
            CGEventCreateMouseEvent(nullptr, type, CGPointMake(point.x, point.y), button);
        if (event == nullptr) {
            return;
        }
        // The double-click carrier. Two independent clicks at the same spot are
        // two single clicks to every app that asks; it is this field, not the
        // timing, that makes the second one a double.
        CGEventSetIntegerValueField(event, kCGMouseEventClickState, clickState);

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
