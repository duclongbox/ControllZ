#pragma once

#include <cstdint>
#include <optional>
#include <string_view>

namespace desktophost {

/// Physical key → native key, for both hosts.
///
/// The wire carries DOM `KeyboardEvent.code`: a *position* on the keyboard
/// ("the key right of Tab"), not a character. The host maps the position to its
/// own native code and lets its own layout decide the character, exactly as if
/// a keyboard were plugged into it. That is the only mapping that survives the
/// two ends having different layouts, and it is why dead keys and AltGr
/// characters come out right: the host's layout does the composing.
///
/// Both tables live in one portable file so they are tested on every platform
/// — the Windows table is checked on a Mac CI runner and vice versa.

/// A macOS virtual key code (`kVK_*`). Nullopt for a key the Mac has no
/// equivalent for (F21–F24, the Japanese conversion keys).
///
/// Keys a Windows keyboard has and a Mac does not land where Apple's own
/// extended keyboard puts them: Insert → Help, PrintScreen / ScrollLock /
/// Pause → F13 / F14 / F15, NumLock → keypad Clear.
///
/// `isoKeyboard`: on an ISO Mac keyboard, macOS reports the key left of 1 and
/// the key right of left Shift with each other's codes (`kVK_ISO_Section` and
/// `kVK_ANSI_Grave` swap). The browser undoes that swap when it reports a
/// `code`, so the host has to redo it for its own keyboard type or those two
/// keys type each other's characters.
std::optional<uint16_t> macKeyCodeFor(std::string_view code, bool isoKeyboard);

/// How a key is sent with `SendInput` on Windows.
struct WindowsKey {
    /// Set-1 scan code, without the 0xE0 prefix.
    uint16_t scanCode = 0;
    /// Needs KEYEVENTF_EXTENDEDKEY — the E0-prefixed keys. It is the only
    /// thing that tells the arrow cluster from the numpad, right Ctrl/Alt from
    /// left, and Enter from numpad Enter.
    bool extended = false;
    /// Non-zero for the few keys a scan code cannot express (Pause is an E1
    /// sequence; NumLock's scan code is ambiguous with Pause). Sent as a
    /// virtual key instead. Only ever a layout-independent key, so nothing is
    /// lost by skipping the layout.
    uint16_t virtualKey = 0;
};

/// Nullopt for a key Windows has no equivalent for. Sent by scan code, not
/// virtual key, so the Windows host's layout decides the character — the
/// same rule as the Mac side.
std::optional<WindowsKey> windowsKeyFor(std::string_view code);

/// Shift, Control, Alt/Option, Meta/Command, left or right. CapsLock is not
/// one: it is a toggle, and each host treats it separately.
bool isModifierCode(std::string_view code);

}  // namespace desktophost
