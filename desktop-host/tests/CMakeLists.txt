include(Catch)

add_executable(desktophost_tests
    smoke_test.cpp
    capture_size_test.cpp
    annex_b_test.cpp
    # Portable: libdatachannel is the transport on every platform, and
    # gathering host candidates needs no network.
    transport_test.cpp
    # Drives the real signaling client against a loopback WebSocket server, so
    # the re-enrolment path is exercised end to end. No external network.
    signaling_reenrol_test.cpp
    # Portable, and the whole point of the injector seam: the router's
    # sequencing, repair and deadman logic is tested against a fake injector,
    # so none of it needs a display or an Accessibility grant in CI.
    input_router_test.cpp
    input_protocol_test.cpp
    pointer_mapping_test.cpp
)

# Exercises the real platform encoder (VideoToolbox / Media Foundation) against
# the synthetic frame source. No capture permission is involved, so this runs
# unattended in CI.
if(APPLE OR WIN32)
    target_sources(desktophost_tests PRIVATE encode_pipeline_test.cpp capture_stop_test.cpp)
endif()

target_link_libraries(desktophost_tests PRIVATE
    desktophost_core
    Catch2::Catch2WithMain
)

if(MSVC)
    target_compile_options(desktophost_tests PRIVATE /utf-8)
endif()

catch_discover_tests(desktophost_tests)
