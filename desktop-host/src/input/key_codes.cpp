#include "desktophost/input/key_codes.h"

#include <array>

namespace desktophost {
namespace {

constexpr uint16_t kNoMac = 0xFFFF;

// macOS kVK_* values, named here so the table below reads as positions.
constexpr uint16_t kMacIsoSection = 0x0A;
constexpr uint16_t kMacGrave = 0x32;

// Windows virtual keys for the two keys sent that way.
constexpr uint16_t kVkPause = 0x13;
constexpr uint16_t kVkNumLock = 0x90;

struct KeyEntry {
    std::string_view code;
    uint16_t mac;
    uint16_t winScan;
    bool winExtended;
    uint16_t winVirtualKey;
};

// Sources: the kVK_* constants in HIToolbox/Events.h, and the set-1 scan codes
// Windows reports in WM_KEYDOWN's lParam (the same values Chromium's
// dom_code_data.inc lists for "win"). A scan code of 0 with no virtual key
// means Windows has no such key.
constexpr std::array kKeys = {
    // Letters.
    KeyEntry{"KeyA", 0x00, 0x1E, false, 0},
    KeyEntry{"KeyB", 0x0B, 0x30, false, 0},
    KeyEntry{"KeyC", 0x08, 0x2E, false, 0},
    KeyEntry{"KeyD", 0x02, 0x20, false, 0},
    KeyEntry{"KeyE", 0x0E, 0x12, false, 0},
    KeyEntry{"KeyF", 0x03, 0x21, false, 0},
    KeyEntry{"KeyG", 0x05, 0x22, false, 0},
    KeyEntry{"KeyH", 0x04, 0x23, false, 0},
    KeyEntry{"KeyI", 0x22, 0x17, false, 0},
    KeyEntry{"KeyJ", 0x26, 0x24, false, 0},
    KeyEntry{"KeyK", 0x28, 0x25, false, 0},
    KeyEntry{"KeyL", 0x25, 0x26, false, 0},
    KeyEntry{"KeyM", 0x2E, 0x32, false, 0},
    KeyEntry{"KeyN", 0x2D, 0x31, false, 0},
    KeyEntry{"KeyO", 0x1F, 0x18, false, 0},
    KeyEntry{"KeyP", 0x23, 0x19, false, 0},
    KeyEntry{"KeyQ", 0x0C, 0x10, false, 0},
    KeyEntry{"KeyR", 0x0F, 0x13, false, 0},
    KeyEntry{"KeyS", 0x01, 0x1F, false, 0},
    KeyEntry{"KeyT", 0x11, 0x14, false, 0},
    KeyEntry{"KeyU", 0x20, 0x16, false, 0},
    KeyEntry{"KeyV", 0x09, 0x2F, false, 0},
    KeyEntry{"KeyW", 0x0D, 0x11, false, 0},
    KeyEntry{"KeyX", 0x07, 0x2D, false, 0},
    KeyEntry{"KeyY", 0x10, 0x15, false, 0},
    KeyEntry{"KeyZ", 0x06, 0x2C, false, 0},

    // Digit row.
    KeyEntry{"Digit1", 0x12, 0x02, false, 0},
    KeyEntry{"Digit2", 0x13, 0x03, false, 0},
    KeyEntry{"Digit3", 0x14, 0x04, false, 0},
    KeyEntry{"Digit4", 0x15, 0x05, false, 0},
    KeyEntry{"Digit5", 0x17, 0x06, false, 0},
    KeyEntry{"Digit6", 0x16, 0x07, false, 0},
    KeyEntry{"Digit7", 0x1A, 0x08, false, 0},
    KeyEntry{"Digit8", 0x1C, 0x09, false, 0},
    KeyEntry{"Digit9", 0x19, 0x0A, false, 0},
    KeyEntry{"Digit0", 0x1D, 0x0B, false, 0},

    // Punctuation and whitespace.
    KeyEntry{"Enter", 0x24, 0x1C, false, 0},
    KeyEntry{"Escape", 0x35, 0x01, false, 0},
    KeyEntry{"Backspace", 0x33, 0x0E, false, 0},
    KeyEntry{"Tab", 0x30, 0x0F, false, 0},
    KeyEntry{"Space", 0x31, 0x39, false, 0},
    KeyEntry{"Minus", 0x1B, 0x0C, false, 0},
    KeyEntry{"Equal", 0x18, 0x0D, false, 0},
    KeyEntry{"BracketLeft", 0x21, 0x1A, false, 0},
    KeyEntry{"BracketRight", 0x1E, 0x1B, false, 0},
    KeyEntry{"Backslash", 0x2A, 0x2B, false, 0},
    KeyEntry{"Semicolon", 0x29, 0x27, false, 0},
    KeyEntry{"Quote", 0x27, 0x28, false, 0},
    KeyEntry{"Backquote", kMacGrave, 0x29, false, 0},
    KeyEntry{"Comma", 0x2B, 0x33, false, 0},
    KeyEntry{"Period", 0x2F, 0x34, false, 0},
    KeyEntry{"Slash", 0x2C, 0x35, false, 0},
    KeyEntry{"IntlBackslash", kMacIsoSection, 0x56, false, 0},
    KeyEntry{"CapsLock", 0x39, 0x3A, false, 0},

    // Function row.
    KeyEntry{"F1", 0x7A, 0x3B, false, 0},
    KeyEntry{"F2", 0x78, 0x3C, false, 0},
    KeyEntry{"F3", 0x63, 0x3D, false, 0},
    KeyEntry{"F4", 0x76, 0x3E, false, 0},
    KeyEntry{"F5", 0x60, 0x3F, false, 0},
    KeyEntry{"F6", 0x61, 0x40, false, 0},
    KeyEntry{"F7", 0x62, 0x41, false, 0},
    KeyEntry{"F8", 0x64, 0x42, false, 0},
    KeyEntry{"F9", 0x65, 0x43, false, 0},
    KeyEntry{"F10", 0x6D, 0x44, false, 0},
    KeyEntry{"F11", 0x67, 0x57, false, 0},
    KeyEntry{"F12", 0x6F, 0x58, false, 0},
    KeyEntry{"F13", 0x69, 0x64, false, 0},
    KeyEntry{"F14", 0x6B, 0x65, false, 0},
    KeyEntry{"F15", 0x71, 0x66, false, 0},
    KeyEntry{"F16", 0x6A, 0x67, false, 0},
    KeyEntry{"F17", 0x40, 0x68, false, 0},
    KeyEntry{"F18", 0x4F, 0x69, false, 0},
    KeyEntry{"F19", 0x50, 0x6A, false, 0},
    KeyEntry{"F20", 0x5A, 0x6B, false, 0},
    KeyEntry{"F21", kNoMac, 0x6C, false, 0},
    KeyEntry{"F22", kNoMac, 0x6D, false, 0},
    KeyEntry{"F23", kNoMac, 0x6E, false, 0},
    KeyEntry{"F24", kNoMac, 0x76, false, 0},

    // The block above the arrows. Windows-only keys take the Mac key Apple's
    // extended keyboard puts in the same place.
    KeyEntry{"PrintScreen", 0x69 /* F13 */, 0x37, true, 0},
    KeyEntry{"ScrollLock", 0x6B /* F14 */, 0x46, false, 0},
    KeyEntry{"Pause", 0x71 /* F15 */, 0, false, kVkPause},
    KeyEntry{"Insert", 0x72 /* Help */, 0x52, true, 0},
    KeyEntry{"Home", 0x73, 0x47, true, 0},
    KeyEntry{"PageUp", 0x74, 0x49, true, 0},
    KeyEntry{"Delete", 0x75, 0x53, true, 0},
    KeyEntry{"End", 0x77, 0x4F, true, 0},
    KeyEntry{"PageDown", 0x79, 0x51, true, 0},

    // Arrows. Extended on Windows: without the flag these are numpad 2/4/6/8.
    KeyEntry{"ArrowRight", 0x7C, 0x4D, true, 0},
    KeyEntry{"ArrowLeft", 0x7B, 0x4B, true, 0},
    KeyEntry{"ArrowDown", 0x7D, 0x50, true, 0},
    KeyEntry{"ArrowUp", 0x7E, 0x48, true, 0},

    // Numpad. A Mac keypad is always numeric; on Windows the host's own
    // NumLock state decides, as it would for a plugged-in keyboard.
    KeyEntry{"NumLock", 0x47 /* keypad Clear */, 0, false, kVkNumLock},
    KeyEntry{"NumpadDivide", 0x4B, 0x35, true, 0},
    KeyEntry{"NumpadMultiply", 0x43, 0x37, false, 0},
    KeyEntry{"NumpadSubtract", 0x4E, 0x4A, false, 0},
    KeyEntry{"NumpadAdd", 0x45, 0x4E, false, 0},
    KeyEntry{"NumpadEnter", 0x4C, 0x1C, true, 0},
    KeyEntry{"Numpad1", 0x53, 0x4F, false, 0},
    KeyEntry{"Numpad2", 0x54, 0x50, false, 0},
    KeyEntry{"Numpad3", 0x55, 0x51, false, 0},
    KeyEntry{"Numpad4", 0x56, 0x4B, false, 0},
    KeyEntry{"Numpad5", 0x57, 0x4C, false, 0},
    KeyEntry{"Numpad6", 0x58, 0x4D, false, 0},
    KeyEntry{"Numpad7", 0x59, 0x47, false, 0},
    KeyEntry{"Numpad8", 0x5B, 0x48, false, 0},
    KeyEntry{"Numpad9", 0x5C, 0x49, false, 0},
    KeyEntry{"Numpad0", 0x52, 0x52, false, 0},
    KeyEntry{"NumpadDecimal", 0x41, 0x53, false, 0},
    KeyEntry{"NumpadEqual", 0x51, 0x59, false, 0},
    KeyEntry{"NumpadComma", 0x5F, 0x7E, false, 0},

    KeyEntry{"ContextMenu", 0x6E, 0x5D, true, 0},

    // International keys (JIS, Korean, Brazilian ABNT).
    KeyEntry{"IntlRo", 0x5E, 0x73, false, 0},
    KeyEntry{"IntlYen", 0x5D, 0x7D, false, 0},
    KeyEntry{"Lang1", 0x68, 0x72, false, 0},
    KeyEntry{"Lang2", 0x66, 0x71, false, 0},
    KeyEntry{"KanaMode", kNoMac, 0x70, false, 0},
    KeyEntry{"Convert", kNoMac, 0x79, false, 0},
    KeyEntry{"NonConvert", kNoMac, 0x7B, false, 0},

    // Modifiers, by position: the key next to the space bar's outer edge is
    // Meta on both (Windows key ↔ Command), and Alt ↔ Option. Remapping Ctrl
    // to Command for shortcuts is a separate, deliberate choice and not made
    // here.
    KeyEntry{"ControlLeft", 0x3B, 0x1D, false, 0},
    KeyEntry{"ShiftLeft", 0x38, 0x2A, false, 0},
    KeyEntry{"AltLeft", 0x3A, 0x38, false, 0},
    KeyEntry{"MetaLeft", 0x37, 0x5B, true, 0},
    KeyEntry{"ControlRight", 0x3E, 0x1D, true, 0},
    KeyEntry{"ShiftRight", 0x3C, 0x36, false, 0},
    KeyEntry{"AltRight", 0x3D, 0x38, true, 0},
    KeyEntry{"MetaRight", 0x36, 0x5C, true, 0},
};

const KeyEntry* find(std::string_view code) {
    for (const KeyEntry& entry : kKeys) {
        if (entry.code == code) {
            return &entry;
        }
    }
    return nullptr;
}

}  // namespace

std::optional<uint16_t> macKeyCodeFor(std::string_view code, bool isoKeyboard) {
    const KeyEntry* entry = find(code);
    if (entry == nullptr || entry->mac == kNoMac) {
        return std::nullopt;
    }
    if (isoKeyboard) {
        if (entry->mac == kMacGrave) return kMacIsoSection;
        if (entry->mac == kMacIsoSection) return kMacGrave;
    }
    return entry->mac;
}

std::optional<WindowsKey> windowsKeyFor(std::string_view code) {
    const KeyEntry* entry = find(code);
    if (entry == nullptr || (entry->winScan == 0 && entry->winVirtualKey == 0)) {
        return std::nullopt;
    }
    return WindowsKey{entry->winScan, entry->winExtended, entry->winVirtualKey};
}

bool isModifierCode(std::string_view code) {
    return code == "ShiftLeft" || code == "ShiftRight" || code == "ControlLeft" ||
           code == "ControlRight" || code == "AltLeft" || code == "AltRight" ||
           code == "MetaLeft" || code == "MetaRight";
}

}  // namespace desktophost
