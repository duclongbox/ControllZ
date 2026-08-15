cmake_minimum_required(VERSION 3.24)

# Pick the floor deliberately rather than inheriting the current SDK's default.
# Must be set before project().
set(CMAKE_OSX_DEPLOYMENT_TARGET "14.0" CACHE STRING "Minimum macOS version")

# OBJCXX matters: ScreenCaptureKit and VideoToolbox are Objective-C APIs, so the
# capture and encode modules are .mm files calling into plain C++ elsewhere.
# Declaring the language now avoids a restructure in M1.
project(desktop-host VERSION 0.1.0 LANGUAGES CXX OBJCXX)

set(CMAKE_CXX_STANDARD 20)          # libdatachannel requires >= 17
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_OBJCXX_STANDARD 20)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)   # so clangd / IDEA understand the project

include(cmake/Dependencies.cmake)

# ---------------------------------------------------------------------------
# desktophost_core — everything except main(), so tests can link it.
# ---------------------------------------------------------------------------
add_library(desktophost_core STATIC
    src/version.cpp
)

target_include_directories(desktophost_core PUBLIC include)
target_link_libraries(desktophost_core PUBLIC LibDataChannel::LibDataChannel)

# Frameworks for M1's capture -> encode path. Linked now so a missing SDK shows
# up at scaffold time rather than mid-milestone.
target_link_libraries(desktophost_core PUBLIC
    "-framework ScreenCaptureKit"
    "-framework VideoToolbox"
    "-framework CoreMedia"
    "-framework CoreVideo"
    "-framework CoreGraphics"
    "-framework Foundation"
    "-framework AVFoundation"
)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    target_compile_options(desktophost_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

# ---------------------------------------------------------------------------
# Executable
# ---------------------------------------------------------------------------
add_executable(desktop-host src/main.cpp)
target_link_libraries(desktop-host PRIVATE desktophost_core)

# Screen Recording is granted per binary identity, and an unsigned binary that
# gets rebuilt looks like a brand-new app every time, so the TCC prompt returns
# on every build. An ad-hoc signature with a stable identifier keeps the grant.
add_custom_command(TARGET desktop-host POST_BUILD
    COMMAND codesign --force --sign - --identifier com.remotehost.desktop-host
            "$<TARGET_FILE:desktop-host>"
    COMMENT "Ad-hoc codesigning with a stable identifier (keeps the TCC grant)"
    VERBATIM
)

enable_testing()
add_subdirectory(tests)
