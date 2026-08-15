include(Catch)

add_executable(desktophost_tests
    smoke_test.cpp
)

target_link_libraries(desktophost_tests PRIVATE
    desktophost_core
    Catch2::Catch2WithMain
)

catch_discover_tests(desktophost_tests)
