#include <catch2/catch_test_macros.hpp>

#include <cstddef>
#include <initializer_list>
#include <vector>

#include "desktophost/encode/annex_b.h"

using desktophost::annexb::appendAvcc;
using desktophost::annexb::appendNal;
using desktophost::annexb::buildFrame;
using desktophost::annexb::ParameterSets;

namespace {

std::vector<std::byte> bytes(std::initializer_list<int> values) {
    std::vector<std::byte> result;
    result.reserve(values.size());
    for (int value : values) {
        result.push_back(static_cast<std::byte>(value));
    }
    return result;
}

}  // namespace

TEST_CASE("appendNal prefixes a 4-byte start code", "[annexb]") {
    std::vector<std::byte> out;
    appendNal(bytes({0x65, 0xAA}), out);
    REQUIRE(out == bytes({0x00, 0x00, 0x00, 0x01, 0x65, 0xAA}));
}

TEST_CASE("appendAvcc rewrites a single length-prefixed NAL", "[annexb]") {
    // [00 00 00 02][65 AA]
    const auto avcc = bytes({0x00, 0x00, 0x00, 0x02, 0x65, 0xAA});
    std::vector<std::byte> out;
    REQUIRE(appendAvcc(avcc, 4, out));
    REQUIRE(out == bytes({0x00, 0x00, 0x00, 0x01, 0x65, 0xAA}));
}

TEST_CASE("appendAvcc rewrites several NALs from one buffer", "[annexb]") {
    // VideoToolbox packs every NAL of a frame into one block buffer, so this
    // is the ordinary case, not an edge case.
    const auto avcc = bytes({0x00, 0x00, 0x00, 0x01, 0x09,               // NAL 1 (1 byte)
                             0x00, 0x00, 0x00, 0x03, 0x65, 0x11, 0x22});  // NAL 2 (3 bytes)
    std::vector<std::byte> out;
    REQUIRE(appendAvcc(avcc, 4, out));
    REQUIRE(out == bytes({0x00, 0x00, 0x00, 0x01, 0x09,  //
                          0x00, 0x00, 0x00, 0x01, 0x65, 0x11, 0x22}));
}

TEST_CASE("appendAvcc honours a non-4-byte length prefix", "[annexb]") {
    const auto avcc = bytes({0x00, 0x02, 0x41, 0x99});
    std::vector<std::byte> out;
    REQUIRE(appendAvcc(avcc, 2, out));
    REQUIRE(out == bytes({0x00, 0x00, 0x00, 0x01, 0x41, 0x99}));
}

TEST_CASE("appendAvcc appends to existing content rather than replacing it", "[annexb]") {
    std::vector<std::byte> out = bytes({0xFF});
    REQUIRE(appendAvcc(bytes({0x00, 0x00, 0x00, 0x01, 0x41}), 4, out));
    REQUIRE(out == bytes({0xFF, 0x00, 0x00, 0x00, 0x01, 0x41}));
}

TEST_CASE("appendAvcc accepts an empty buffer", "[annexb]") {
    std::vector<std::byte> out;
    REQUIRE(appendAvcc({}, 4, out));
    REQUIRE(out.empty());
}

TEST_CASE("appendAvcc rejects malformed buffers without partial output", "[annexb]") {
    std::vector<std::byte> out;

    SECTION("truncated length prefix") {
        REQUIRE_FALSE(appendAvcc(bytes({0x00, 0x00}), 4, out));
    }
    SECTION("length runs past the end") {
        REQUIRE_FALSE(appendAvcc(bytes({0x00, 0x00, 0x00, 0x09, 0x65}), 4, out));
    }
    SECTION("zero-length NAL") {
        REQUIRE_FALSE(appendAvcc(bytes({0x00, 0x00, 0x00, 0x00}), 4, out));
    }
    SECTION("second NAL is truncated") {
        REQUIRE_FALSE(appendAvcc(bytes({0x00, 0x00, 0x00, 0x01, 0x09, 0x00, 0x00}), 4, out));
    }
    SECTION("unsupported length size") {
        REQUIRE_FALSE(appendAvcc(bytes({0x00, 0x00, 0x00, 0x01, 0x09}), 5, out));
        REQUIRE_FALSE(appendAvcc(bytes({0x00, 0x00, 0x00, 0x01, 0x09}), 0, out));
    }

    REQUIRE(out.empty());
}

TEST_CASE("buildFrame prepends parameter sets ahead of the payload", "[annexb]") {
    // The black-screen bug this whole file exists to prevent: SPS/PPS live in
    // VideoToolbox's format description, never in the bitstream, so a keyframe
    // is only decodable once they are spliced in front of it.
    const ParameterSets sets = {bytes({0x67, 0x42}), bytes({0x68, 0xCE})};
    const auto avcc = bytes({0x00, 0x00, 0x00, 0x02, 0x65, 0xAA});

    std::vector<std::byte> out;
    REQUIRE(buildFrame(sets, avcc, 4, out));
    REQUIRE(out == bytes({0x00, 0x00, 0x00, 0x01, 0x67, 0x42,    // SPS
                          0x00, 0x00, 0x00, 0x01, 0x68, 0xCE,    // PPS
                          0x00, 0x00, 0x00, 0x01, 0x65, 0xAA}));  // IDR
}

TEST_CASE("buildFrame emits no parameter sets for a delta frame", "[annexb]") {
    std::vector<std::byte> out;
    REQUIRE(buildFrame({}, bytes({0x00, 0x00, 0x00, 0x02, 0x41, 0x0B}), 4, out));
    REQUIRE(out == bytes({0x00, 0x00, 0x00, 0x01, 0x41, 0x0B}));
}

TEST_CASE("buildFrame replaces the output buffer", "[annexb]") {
    std::vector<std::byte> out = bytes({0xDE, 0xAD});
    REQUIRE(buildFrame({}, bytes({0x00, 0x00, 0x00, 0x01, 0x41}), 4, out));
    REQUIRE(out == bytes({0x00, 0x00, 0x00, 0x01, 0x41}));
}

TEST_CASE("buildFrame leaves the output untouched when the payload is malformed", "[annexb]") {
    std::vector<std::byte> out = bytes({0xDE, 0xAD});
    REQUIRE_FALSE(buildFrame({bytes({0x67})}, bytes({0x00, 0x00}), 4, out));
    REQUIRE(out == bytes({0xDE, 0xAD}));
}

TEST_CASE("buildFrame rejects an empty parameter set", "[annexb]") {
    std::vector<std::byte> out;
    REQUIRE_FALSE(buildFrame({{}}, bytes({0x00, 0x00, 0x00, 0x01, 0x65}), 4, out));
}
