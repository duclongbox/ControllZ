include(FetchContent)

# ---------------------------------------------------------------------------
# libdatachannel — DTLS-SRTP media + data channels, without libwebrtc's build
# footprint (CLAUDE.md). We feed it already-hardware-encoded frames, so we need
# transport only. Pinned to a tag, never master.
#
# Kept enabled deliberately:
#   * media support  — required for H.264 RTP/SRTP.
#   * WebSocket client — the desktop's signaling client uses rtc::WebSocket
#     instead of pulling in a second networking library.
# ---------------------------------------------------------------------------
set(NO_EXAMPLES ON CACHE BOOL "" FORCE)
set(NO_TESTS ON CACHE BOOL "" FORCE)
set(USE_OPENSSL ON CACHE BOOL "" FORCE)

FetchContent_Declare(
    libdatachannel
    GIT_REPOSITORY https://github.com/paullouisageneau/libdatachannel.git
    GIT_TAG v0.24.5
    GIT_SHALLOW TRUE
)

# ---------------------------------------------------------------------------
# Catch2 v3 — unit tests for the module seams (encoder output format,
# packetizer), never the GPU pipeline itself.
# ---------------------------------------------------------------------------
FetchContent_Declare(
    Catch2
    GIT_REPOSITORY https://github.com/catchorg/Catch2.git
    GIT_TAG v3.15.3
    GIT_SHALLOW TRUE
)

FetchContent_MakeAvailable(libdatachannel Catch2)
