#include <catch2/catch_test_macros.hpp>

#include <string>
#include <vector>

#include "desktophost/input/input_protocol.h"
#include "desktophost/input/key_codes.h"
#include "desktophost/input/keyboard_router.h"

using desktophost::DisplayBounds;
using desktophost::KeyboardRouter;
using desktophost::MouseButton;
using desktophost::ScreenPoint;

/* Keyboard runs on the ordered, reliable `keys` channel, so unlike the pointer
 * tests there is no reordering or loss to simulate. What can still go wrong is
 * a key left held on the desktop, a key typed twice, and a key that means one
 * thing on the sending OS and another on the host — which is most of this
 * file. */

namespace {

struct KeyEvent {
    std::string code;
    bool down;
    bool repeat;
};

class FakeInjector final : public desktophost::IInputInjector {
public:
    std::vector<KeyEvent> keys;
    /// Codes the fake pretends this host has no key for.
    std::vector<std::string> unmapped;

    DisplayBounds bounds() const override { return DisplayBounds{0, 0, 1000, 500}; }
    void move(ScreenPoint, uint8_t) override {}
    void buttonDown(ScreenPoint, MouseButton, int) override {}
    void buttonUp(ScreenPoint, MouseButton, int) override {}
    void scroll(ScreenPoint, double, double) override {}

    bool key(std::string_view code, bool down, bool repeat) override {
        for (const std::string& missing : unmapped) {
            if (missing == code) return false;
        }
        keys.push_back(KeyEvent{std::string(code), down, repeat});
        return true;
    }
};

std::string keyMessage(const char* type, const char* code, bool repeat = false) {
    return std::string(R"({"type":")") + type + R"(","code":")" + code + R"(","t":1)" +
           (repeat ? R"(,"repeat":true)" : "") + "}";
}

}  // namespace

// -- parsing -----------------------------------------------------------------

TEST_CASE("parses keyDown and keyUp") {
    const auto down = desktophost::parseKeyMessage(
        R"({"type":"keyDown","code":"KeyA","t":1757030412,"repeat":true})");
    REQUIRE(down.has_value());
    CHECK(down->down);
    CHECK(down->code == "KeyA");
    CHECK(down->repeat);
    CHECK(down->sentAtMs == 1757030412);

    const auto up = desktophost::parseKeyMessage(R"({"type":"keyUp","code":"ShiftLeft"})");
    REQUIRE(up.has_value());
    CHECK_FALSE(up->down);
    CHECK_FALSE(up->repeat);
}

TEST_CASE("malformed key messages are rejected") {
    const char* rejected[] = {
        R"({"type":"keyPress","code":"KeyA"})",
        R"({"type":"keyDown"})",
        R"({"type":"keyDown","code":""})",
        R"({"type":"keyDown","code":"Key A"})",
        R"({"type":"keyDown","code":"../../etc"})",
        R"({"type":"keyDown","code":"KeyAKeyAKeyAKeyAKeyAKeyAKeyAKeyAKeyA"})",
        R"({"type":"keyDown","code":65})",
        R"({"type":"keyDown","code":"KeyA","repeat":"true"})",
        R"(not json)",
    };
    for (const char* json : rejected) {
        INFO(json);
        CHECK_FALSE(desktophost::parseKeyMessage(json).has_value());
    }
}

// -- routing -----------------------------------------------------------------

TEST_CASE("a keystroke is pressed and released") {
    FakeInjector injector;
    KeyboardRouter router(&injector);

    router.handleMessage(keyMessage("keyDown", "KeyA"));
    router.handleMessage(keyMessage("keyUp", "KeyA"));

    REQUIRE(injector.keys.size() == 2);
    CHECK(injector.keys[0].down);
    CHECK_FALSE(injector.keys[1].down);
    CHECK(router.heldCount() == 0);
}

TEST_CASE("autorepeat is forwarded, because no host repeats a synthesised key") {
    FakeInjector injector;
    KeyboardRouter router(&injector);

    router.handleMessage(keyMessage("keyDown", "Backspace"));
    router.handleMessage(keyMessage("keyDown", "Backspace", true));
    router.handleMessage(keyMessage("keyDown", "Backspace", true));

    REQUIRE(injector.keys.size() == 3);
    CHECK_FALSE(injector.keys[0].repeat);
    CHECK(injector.keys[1].repeat);
    CHECK(injector.keys[2].repeat);
}

TEST_CASE("a second press of a held key is treated as a repeat") {
    FakeInjector injector;
    KeyboardRouter router(&injector);

    router.handleMessage(keyMessage("keyDown", "KeyA"));
    router.handleMessage(keyMessage("keyDown", "KeyA"));

    REQUIRE(injector.keys.size() == 2);
    CHECK(injector.keys[1].repeat);
}

TEST_CASE("modifier autorepeat is dropped") {
    // Windows repeats a held Shift like any key; on a Mac host each would be a
    // spurious flags-changed event.
    FakeInjector injector;
    KeyboardRouter router(&injector);

    router.handleMessage(keyMessage("keyDown", "ShiftLeft"));
    router.handleMessage(keyMessage("keyDown", "ShiftLeft", true));
    router.handleMessage(keyMessage("keyDown", "ShiftLeft", true));

    CHECK(injector.keys.size() == 1);
}

TEST_CASE("a release for a key not held is ignored") {
    FakeInjector injector;
    KeyboardRouter router(&injector);

    router.handleMessage(keyMessage("keyUp", "KeyQ"));

    CHECK(injector.keys.empty());
    CHECK(router.stats().orphanReleases == 1);
}

TEST_CASE("a key this host lacks is counted and never held") {
    FakeInjector injector;
    injector.unmapped.push_back("F24");
    KeyboardRouter router(&injector);

    router.handleMessage(keyMessage("keyDown", "F24"));
    router.handleMessage(keyMessage("keyUp", "F24"));

    CHECK(injector.keys.empty());
    CHECK(router.heldCount() == 0);
    CHECK(router.stats().unmappedDropped == 1);
}

TEST_CASE("releaseAll lets go of everything, modifiers last") {
    FakeInjector injector;
    KeyboardRouter router(&injector);

    router.handleMessage(keyMessage("keyDown", "ControlLeft"));
    router.handleMessage(keyMessage("keyDown", "ShiftLeft"));
    router.handleMessage(keyMessage("keyDown", "KeyZ"));
    injector.keys.clear();

    router.releaseAll();

    REQUIRE(injector.keys.size() == 3);
    CHECK(injector.keys[0].code == "KeyZ");
    for (const KeyEvent& event : injector.keys) {
        CHECK_FALSE(event.down);
    }
    CHECK(router.heldCount() == 0);

    // Nothing left to release a second time.
    injector.keys.clear();
    router.releaseAll();
    CHECK(injector.keys.empty());
}

TEST_CASE("garbage on the keys channel is counted, not typed") {
    FakeInjector injector;
    KeyboardRouter router(&injector);

    router.handleMessage("{}");
    router.handleMessage(R"({"type":"keyDown","code":"Key A"})");

    CHECK(injector.keys.empty());
    CHECK(router.stats().invalidDropped == 2);
}

// -- the OS mismatch tables ----------------------------------------------------

TEST_CASE("letters and digits map by position on both hosts") {
    CHECK(desktophost::macKeyCodeFor("KeyA", false) == 0x00);
    CHECK(desktophost::macKeyCodeFor("KeyQ", false) == 0x0C);
    CHECK(desktophost::macKeyCodeFor("Digit1", false) == 0x12);

    const auto a = desktophost::windowsKeyFor("KeyA");
    REQUIRE(a.has_value());
    CHECK(a->scanCode == 0x1E);
    CHECK_FALSE(a->extended);
}

TEST_CASE("Windows key and Command share a position, as do Alt and Option") {
    CHECK(desktophost::macKeyCodeFor("MetaLeft", false) == 0x37);   // kVK_Command
    CHECK(desktophost::macKeyCodeFor("MetaRight", false) == 0x36);  // kVK_RightCommand
    CHECK(desktophost::macKeyCodeFor("AltLeft", false) == 0x3A);    // kVK_Option
    CHECK(desktophost::macKeyCodeFor("AltRight", false) == 0x3D);   // kVK_RightOption

    const auto meta = desktophost::windowsKeyFor("MetaLeft");
    REQUIRE(meta.has_value());
    CHECK(meta->scanCode == 0x5B);
    CHECK(meta->extended);
}

TEST_CASE("Windows-only keys land where Apple's extended keyboard has them") {
    CHECK(desktophost::macKeyCodeFor("Insert", false) == 0x72);       // Help
    CHECK(desktophost::macKeyCodeFor("PrintScreen", false) == 0x69);  // F13
    CHECK(desktophost::macKeyCodeFor("ScrollLock", false) == 0x6B);   // F14
    CHECK(desktophost::macKeyCodeFor("Pause", false) == 0x71);        // F15
    CHECK(desktophost::macKeyCodeFor("NumLock", false) == 0x47);      // keypad Clear
}

TEST_CASE("keys a Mac has no equivalent for are unmapped, not guessed") {
    CHECK_FALSE(desktophost::macKeyCodeFor("F24", false).has_value());
    CHECK_FALSE(desktophost::macKeyCodeFor("Convert", false).has_value());
    CHECK_FALSE(desktophost::macKeyCodeFor("NotAKey", false).has_value());
    CHECK_FALSE(desktophost::windowsKeyFor("NotAKey").has_value());
}

TEST_CASE("an ISO Mac swaps the key left of 1 with the key right of left Shift") {
    CHECK(desktophost::macKeyCodeFor("Backquote", false) == 0x32);
    CHECK(desktophost::macKeyCodeFor("IntlBackslash", false) == 0x0A);
    CHECK(desktophost::macKeyCodeFor("Backquote", true) == 0x0A);
    CHECK(desktophost::macKeyCodeFor("IntlBackslash", true) == 0x32);
    // Nothing else moves.
    CHECK(desktophost::macKeyCodeFor("KeyA", true) == 0x00);
}

TEST_CASE("the Windows extended flag separates the arrow cluster from the numpad") {
    const auto arrow = desktophost::windowsKeyFor("ArrowLeft");
    const auto numpad = desktophost::windowsKeyFor("Numpad4");
    REQUIRE(arrow.has_value());
    REQUIRE(numpad.has_value());
    // Same scan code; the flag is the only difference.
    CHECK(arrow->scanCode == numpad->scanCode);
    CHECK(arrow->extended);
    CHECK_FALSE(numpad->extended);

    const auto enter = desktophost::windowsKeyFor("Enter");
    const auto numpadEnter = desktophost::windowsKeyFor("NumpadEnter");
    CHECK(enter->scanCode == numpadEnter->scanCode);
    CHECK(numpadEnter->extended);

    CHECK(desktophost::windowsKeyFor("ControlRight")->extended);
    CHECK(desktophost::windowsKeyFor("AltRight")->extended);
    CHECK_FALSE(desktophost::windowsKeyFor("ControlLeft")->extended);
}

TEST_CASE("Pause and NumLock go to Windows as virtual keys") {
    const auto pause = desktophost::windowsKeyFor("Pause");
    const auto numLock = desktophost::windowsKeyFor("NumLock");
    REQUIRE(pause.has_value());
    REQUIRE(numLock.has_value());
    CHECK(pause->virtualKey == 0x13);    // VK_PAUSE
    CHECK(numLock->virtualKey == 0x90);  // VK_NUMLOCK
}

TEST_CASE("Mac-only keys still reach Windows") {
    // F13–F19 exist on Apple's extended keyboard; keypad = on its numpad.
    CHECK(desktophost::windowsKeyFor("F13")->scanCode == 0x64);
    CHECK(desktophost::windowsKeyFor("F19")->scanCode == 0x6A);
    CHECK(desktophost::windowsKeyFor("NumpadEqual")->scanCode == 0x59);
}

TEST_CASE("modifiers are recognised, CapsLock is not one") {
    CHECK(desktophost::isModifierCode("ShiftRight"));
    CHECK(desktophost::isModifierCode("MetaLeft"));
    CHECK_FALSE(desktophost::isModifierCode("CapsLock"));
    CHECK_FALSE(desktophost::isModifierCode("KeyA"));
}
