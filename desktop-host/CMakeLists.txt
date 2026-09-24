cmake_minimum_required(VERSION 3.24)

# Pick the floor deliberately rather than inheriting the current SDK's default.
# Must be set before project().
set(CMAKE_OSX_DEPLOYMENT_TARGET "14.0" CACHE STRING "Minimum macOS version")

# Windows gets OpenSSL from vcpkg (vcpkg.json), which works through a toolchain
# file that must be known before project(). Located here rather than in the
# preset because a preset can only read $env{VCPKG_ROOT}, and that is empty in
# the very window where `setx VCPKG_ROOT` was just run — the preset then points
# at "/scripts/buildsystems/vcpkg.cmake" and fails with no hint why. Also
# re-checked when a previous attempt cached a path that does not exist.
if(CMAKE_HOST_WIN32 AND (NOT CMAKE_TOOLCHAIN_FILE OR NOT EXISTS "${CMAKE_TOOLCHAIN_FILE}"))
    set(_vcpkg_toolchain "")
    # VCPKG_INSTALLATION_ROOT: set on GitHub's Windows runners.
    foreach(_root IN ITEMS "$ENV{VCPKG_ROOT}" "$ENV{VCPKG_INSTALLATION_ROOT}" "C:/vcpkg")
        if(_root)
            file(TO_CMAKE_PATH "${_root}" _root)
            if(EXISTS "${_root}/scripts/buildsystems/vcpkg.cmake")
                set(_vcpkg_toolchain "${_root}/scripts/buildsystems/vcpkg.cmake")
                break()
            endif()
        endif()
    endforeach()
    if(NOT _vcpkg_toolchain)
        message(FATAL_ERROR
            "vcpkg not found. Checked VCPKG_ROOT, VCPKG_INSTALLATION_ROOT and C:/vcpkg.\n"
            "Install it:\n"
            "  git clone https://github.com/microsoft/vcpkg C:\\vcpkg\n"
            "  C:\\vcpkg\\bootstrap-vcpkg.bat\n"
            "or, if it lives elsewhere, set VCPKG_ROOT in this window and reconfigure:\n"
            "  $env:VCPKG_ROOT = \"D:\\path\\to\\vcpkg\"")
    endif()
    set(CMAKE_TOOLCHAIN_FILE "${_vcpkg_toolchain}" CACHE FILEPATH "vcpkg toolchain" FORCE)
    message(STATUS "Using vcpkg toolchain: ${CMAKE_TOOLCHAIN_FILE}")
endif()

project(desktop-host VERSION 0.1.0 LANGUAGES CXX)

# OBJCXX on Apple only: ScreenCaptureKit and VideoToolbox are Objective-C APIs,
# so the macOS capture and encode modules are .mm files. MSVC has no
# Objective-C compiler, so declaring it unconditionally fails configure there.
if(APPLE)
    enable_language(OBJCXX)
    set(CMAKE_OBJCXX_STANDARD 20)
endif()

set(CMAKE_CXX_STANDARD 20)          # libdatachannel requires >= 17
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)   # so clangd / IDEA understand the project

include(cmake/Dependencies.cmake)

# ---------------------------------------------------------------------------
# desktophost_core — everything except main(), so tests can link it.
# ---------------------------------------------------------------------------
# Portable sources only. Anything platform-specific is added behind the guards
# below, so this list stays the definition of what `core/` is allowed to be.
add_library(desktophost_core STATIC
    src/version.cpp
    src/encode/annex_b.cpp
    src/transport/peer_connection_rtc.cpp
    src/transport/mdns_candidate.cpp
    src/signaling/signaling_client_ws.cpp
    src/input/input_protocol.cpp
    src/input/input_router.cpp
    src/input/pointer_mapping.cpp
)

# Static on Windows. The DLL build exports std::vector<std::byte> (rtc::binary)
# from datachannel.dll, and MSVC then sees that instantiation twice — once
# imported, once from our own code — and fails with LNK2005. Static also means
# no datachannel.dll has to sit next to desktop-host.exe and the test runner.
if(WIN32)
    set(DESKTOPHOST_DATACHANNEL LibDataChannel::LibDataChannelStatic)
else()
    set(DESKTOPHOST_DATACHANNEL LibDataChannel::LibDataChannel)
endif()

target_include_directories(desktophost_core PUBLIC include)
target_link_libraries(desktophost_core
    PUBLIC ${DESKTOPHOST_DATACHANNEL}
    # Private: JSON is an implementation detail of the signaling client and
    # must not leak into the interface headers other packages compile against.
    PRIVATE nlohmann_json::nlohmann_json
)

if(APPLE)
    # ScreenCaptureKit and VideoToolbox are Objective-C, so the two backends are
    # .mm translation units that expose plain C++ interfaces to everything else.
    target_sources(desktophost_core PRIVATE
        src/capture/screen_capturer_mac.mm
        src/capture/test_pattern_capturer_mac.cpp
        src/encode/video_encoder_vt.mm
        # Plain C++, unlike capture and encode: CGEvent and the Accessibility
        # trust check are C APIs, so this backend needs no Objective-C.
        src/input/input_injector_mac.cpp
    )

    # ARC for the Objective-C objects. CoreFoundation types (CVPixelBuffer,
    # CMSampleBuffer) are still retained and released by hand — ARC does not
    # manage those, which is exactly why PlatformFrame owns them explicitly.
    set_source_files_properties(
        src/capture/screen_capturer_mac.mm
        src/encode/video_encoder_vt.mm
        PROPERTIES COMPILE_OPTIONS "-fobjc-arc"
    )

    target_link_libraries(desktophost_core PUBLIC
        "-framework ScreenCaptureKit"
        "-framework VideoToolbox"
        "-framework CoreMedia"
        "-framework CoreVideo"
        "-framework CoreGraphics"
        # AXIsProcessTrustedWithOptions — the Accessibility grant that
        # CGEventPost requires.
        "-framework ApplicationServices"
        "-framework CoreFoundation"
        "-framework Foundation"
    )
elseif(WIN32)
    # Same seams, Windows backends. Capture and encode share one D3D11 device
    # (src/platform/win): a texture belongs to the device that made it, so the
    # encoder can only read capture's frames — without a CPU copy — on the
    # same device.
    target_sources(desktophost_core PRIVATE
        src/platform/win/d3d_device.cpp
        src/capture/screen_capturer_win.cpp
        src/capture/test_pattern_capturer_win.cpp
        src/encode/video_encoder_mf.cpp
        src/input/input_injector_win.cpp
    )
    target_include_directories(desktophost_core PRIVATE src)

    target_compile_definitions(desktophost_core PRIVATE
        WIN32_LEAN_AND_MEAN
        NOMINMAX
        # Windows 10 1903: the floor for Windows Graphics Capture's
        # CreateForMonitor and for MFTEnum2's adapter filter.
        _WIN32_WINNT=0x0A00
        NTDDI_VERSION=0x0A000007
    )

    target_link_libraries(desktophost_core PUBLIC
        d3d11
        dxgi
        mfplat
        mfuuid
        # CODECAPI_* property GUIDs for ICodecAPI.
        strmiids
        # C++/WinRT, for Windows.Graphics.Capture.
        windowsapp
        user32
        ws2_32
    )
else()
    # Keeps the seam compiling on platforms without a backend (Linux).
    target_sources(desktophost_core PRIVATE
        src/capture/screen_capturer_unsupported.cpp
        src/encode/video_encoder_unsupported.cpp
        src/input/input_injector_unsupported.cpp
    )
endif()

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    target_compile_options(desktophost_core PRIVATE -Wall -Wextra -Wpedantic)
elseif(MSVC)
    # /EHsc: C++/WinRT reports failure by throwing winrt::hresult_error.
    target_compile_options(desktophost_core PRIVATE /W4 /permissive- /EHsc /utf-8 /bigobj)
endif()

# ---------------------------------------------------------------------------
# Executable
# ---------------------------------------------------------------------------
add_executable(desktop-host src/main.cpp)
target_link_libraries(desktop-host PRIVATE desktophost_core)

if(WIN32)
    # Per-monitor DPI awareness, declared in the manifest rather than set from
    # main(): it has to be in force before any monitor API runs, and it is what
    # makes capture sizes and SendInput coordinates physical pixels. Without it
    # Windows reports scaled sizes and every click on a 150% display misses.
    target_sources(desktop-host PRIVATE src/platform/win/desktop-host.manifest)
    target_compile_options(desktop-host PRIVATE /utf-8)
endif()

if(APPLE)
    # Screen Recording is granted per binary identity, and an unsigned binary
    # that gets rebuilt looks like a brand-new app every time, so the TCC prompt
    # returns on every build. An ad-hoc signature with a stable identifier keeps
    # the grant.
    add_custom_command(TARGET desktop-host POST_BUILD
        COMMAND codesign --force --sign - --identifier com.remotehost.desktop-host
                "$<TARGET_FILE:desktop-host>"
        COMMENT "Ad-hoc codesigning with a stable identifier (keeps the TCC grant)"
        VERBATIM
    )
endif()

enable_testing()
add_subdirectory(tests)
