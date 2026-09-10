include(Catch)

add_executable(desktophost_tests
    smoke_test.cpp
    annex_b_test.cpp
)

# Exercises the real VideoToolbox encoder against the synthetic frame source.
# No Screen Recording grant is involved, so this runs unattended in CI.
if(APPLE)
    target_sources(desktophost_tests PRIVATE encode_pipeline_test.cpp)
endif()

target_link_libraries(desktophost_tests PRIVATE
    desktophost_core
    Catch2::Catch2WithMain
)

catch_discover_tests(desktophost_tests)
