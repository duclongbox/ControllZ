#pragma once

#include <cstddef>
#include <span>
#include <vector>

/// AVCC -> Annex-B conversion.
///
/// VideoToolbox emits length-prefixed NAL units ("AVCC": a big-endian length
/// field, then the payload) and keeps SPS/PPS out of the bitstream entirely, in
/// the sample's format description. RTP wants start-code-delimited NAL units
/// ("Annex-B") with the parameter sets inline ahead of each IDR. Forwarding
/// VideoToolbox output unchanged produces a stream the browser cannot decode
/// and reports no error for — it just renders black.
///
/// This is deliberately pure, platform-free C++: it is the one piece of the
/// capture->encode path that can be tested without a GPU, and it is where the
/// format bug would live.
namespace desktophost::annexb {

/// The 4-byte start code (0x00 0x00 0x00 0x01) prefixed to every NAL unit.
inline constexpr std::byte kStartCode[4] = {std::byte{0x00}, std::byte{0x00}, std::byte{0x00},
                                            std::byte{0x01}};

/// Appends `nal` to `out`, preceded by a start code.
void appendNal(std::span<const std::byte> nal, std::vector<std::byte>& out);

/// Rewrites a length-prefixed buffer as start-code-delimited NAL units,
/// appending to `out`. `nalLengthSize` is the prefix width in bytes (1-4),
/// reported by the encoder's format description.
///
/// Returns false and leaves `out` unmodified if the buffer is malformed: a
/// truncated length prefix, a length running past the end, or a zero-length
/// NAL unit. An empty input is not malformed.
bool appendAvcc(std::span<const std::byte> avcc, int nalLengthSize, std::vector<std::byte>& out);

/// SPS, PPS, and any further parameter sets, in the order the encoder reports.
using ParameterSets = std::vector<std::vector<std::byte>>;

/// Builds one complete Annex-B frame into `out`, replacing its contents.
///
/// `parameterSets` should be non-empty for a keyframe and empty otherwise:
/// prepending SPS/PPS to every IDR is what lets a decoder join the stream at
/// any keyframe without out-of-band configuration.
bool buildFrame(const ParameterSets& parameterSets, std::span<const std::byte> avcc,
                int nalLengthSize, std::vector<std::byte>& out);

}  // namespace desktophost::annexb
