#include <catch2/catch_test_macros.hpp>

#include <cstddef>
#include <initializer_list>
#include <vector>

#include "desktophost/encode/annex_b.h"

using desktophost::annexb::appendAvcc;
using desktophost::annexb::appendNal;
using desktophost::annexb::buildFrame;
using desktophost::annexb::normalizeFrame;
using desktophost::annexb::ParameterSetCache;
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

// normalizeFrame: Media Foundation encoders emit Annex-B with parameter sets
// in-band, but only some vendors repeat them before every IDR. A keyframe
// without them is one a new viewer cannot join at, and it fails silently.

TEST_CASE("normalizeFrame orders in-band parameter sets ahead of the IDR", "[annexb]") {
    // AUD, SPS, PPS, IDR — with a mix of 3- and 4-byte start codes.
    const auto in = bytes({0x00, 0x00, 0x00, 0x01, 0x09, 0xF0,        // AUD
                           0x00, 0x00, 0x01, 0x67, 0x42,              // SPS
                           0x00, 0x00, 0x00, 0x01, 0x68, 0xCE,        // PPS
                           0x00, 0x00, 0x01, 0x65, 0x88, 0x84});      // IDR
    ParameterSetCache cache;
    std::vector<std::byte> out;
    bool isKeyframe = false;
    REQUIRE(normalizeFrame(in, cache, out, isKeyframe));
    CHECK(isKeyframe);
    CHECK(out == bytes({0x00, 0x00, 0x00, 0x01, 0x67, 0x42,
                        0x00, 0x00, 0x00, 0x01, 0x68, 0xCE,
                        0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84}));
    CHECK(cache.sps == bytes({0x67, 0x42}));
    CHECK(cache.pps == bytes({0x68, 0xCE}));
}

TEST_CASE("normalizeFrame re-inserts cached parameter sets on a bare IDR", "[annexb]") {
    ParameterSetCache cache{bytes({0x67, 0x42}), bytes({0x68, 0xCE})};
    std::vector<std::byte> out;
    bool isKeyframe = false;
    REQUIRE(normalizeFrame(bytes({0x00, 0x00, 0x00, 0x01, 0x65, 0x11}), cache, out, isKeyframe));
    CHECK(isKeyframe);
    CHECK(out == bytes({0x00, 0x00, 0x00, 0x01, 0x67, 0x42,
                        0x00, 0x00, 0x00, 0x01, 0x68, 0xCE,
                        0x00, 0x00, 0x00, 0x01, 0x65, 0x11}));
}

TEST_CASE("normalizeFrame keeps delta frames free of parameter sets", "[annexb]") {
    ParameterSetCache cache{bytes({0x67, 0x42}), bytes({0x68, 0xCE})};
    const auto in = bytes({0x00, 0x00, 0x00, 0x01, 0x09, 0x30,
                           0x00, 0x00, 0x00, 0x01, 0x67, 0x4D,   // SPS on a delta frame
                           0x00, 0x00, 0x00, 0x01, 0x41, 0x9A});
    std::vector<std::byte> out;
    bool isKeyframe = true;
    REQUIRE(normalizeFrame(in, cache, out, isKeyframe));
    CHECK_FALSE(isKeyframe);
    CHECK(out == bytes({0x00, 0x00, 0x00, 0x01, 0x41, 0x9A}));
    // Still remembered, for the next IDR.
    CHECK(cache.sps == bytes({0x67, 0x4D}));
}

TEST_CASE("normalizeFrame trims trailing zero bytes between NAL units", "[annexb]") {
    ParameterSetCache cache;
    const auto in = bytes({0x00, 0x00, 0x01, 0x41, 0x9A, 0x00, 0x00,
                           0x00, 0x00, 0x01, 0x41, 0x9B});
    std::vector<std::byte> out;
    bool isKeyframe = false;
    REQUIRE(normalizeFrame(in, cache, out, isKeyframe));
    CHECK(out == bytes({0x00, 0x00, 0x00, 0x01, 0x41, 0x9A,
                        0x00, 0x00, 0x00, 0x01, 0x41, 0x9B}));
}

TEST_CASE("normalizeFrame refuses an IDR it cannot make decodable", "[annexb]") {
    ParameterSetCache cache;
    std::vector<std::byte> out = bytes({0x01});
    bool isKeyframe = false;
    CHECK_FALSE(normalizeFrame(bytes({0x00, 0x00, 0x00, 0x01, 0x65, 0x11}), cache, out,
                               isKeyframe));
    CHECK(out == bytes({0x01}));
    CHECK_FALSE(normalizeFrame(bytes({0x12, 0x34}), cache, out, isKeyframe));
}
