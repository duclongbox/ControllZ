include(Catch)

add_executable(desktophost_tests
    smoke_test.cpp
    annex_b_test.cpp
    # Portable: libdatachannel is the transport on every platform, and
    # gathering host candidates needs no network.
    transport_test.cpp
)

# Exercises the real VideoToolbox encoder against the synthetic frame source.
# No Screen Recording grant is involved, so this runs unattended in CI.
if(APPLE)
    target_sources(desktophost_tests PRIVATE encode_pipeline_test.cpp capture_stop_test.cpp)
endif()

target_link_libraries(desktophost_tests PRIVATE
    desktophost_core
    Catch2::Catch2WithMain
)

catch_discover_tests(desktophost_tests)
