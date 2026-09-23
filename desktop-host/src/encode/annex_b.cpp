#include "desktophost/encode/annex_b.h"

#include <cstdint>

namespace desktophost::annexb {
namespace {

/// Reads a big-endian unsigned integer of `size` bytes (1-4).
uint32_t readBigEndian(std::span<const std::byte> bytes, int size) {
    uint32_t value = 0;
    for (int i = 0; i < size; ++i) {
        value = (value << 8) | static_cast<uint32_t>(bytes[static_cast<size_t>(i)]);
    }
    return value;
}

}  // namespace

void appendNal(std::span<const std::byte> nal, std::vector<std::byte>& out) {
    out.insert(out.end(), std::begin(kStartCode), std::end(kStartCode));
    out.insert(out.end(), nal.begin(), nal.end());
}

bool appendAvcc(std::span<const std::byte> avcc, int nalLengthSize, std::vector<std::byte>& out) {
    if (nalLengthSize < 1 || nalLengthSize > 4) {
        return false;
    }

    // Validate the whole buffer before writing anything, so a malformed frame
    // leaves `out` untouched rather than half-converted.
    size_t offset = 0;
    while (offset < avcc.size()) {
        const size_t remaining = avcc.size() - offset;
        if (remaining < static_cast<size_t>(nalLengthSize)) {
            return false;  // truncated length prefix
        }
        const uint32_t nalSize = readBigEndian(avcc.subspan(offset, static_cast<size_t>(nalLengthSize)),
                                               nalLengthSize);
        if (nalSize == 0) {
            return false;  // a NAL unit is at minimum its own header byte
        }
        offset += static_cast<size_t>(nalLengthSize);
        if (nalSize > avcc.size() - offset) {
            return false;  // length runs past the end
        }
        offset += nalSize;
    }

    offset = 0;
    while (offset < avcc.size()) {
        const uint32_t nalSize = readBigEndian(avcc.subspan(offset, static_cast<size_t>(nalLengthSize)),
                                               nalLengthSize);
        offset += static_cast<size_t>(nalLengthSize);
        appendNal(avcc.subspan(offset, nalSize), out);
        offset += nalSize;
    }

    return true;
}

bool buildFrame(const ParameterSets& parameterSets, std::span<const std::byte> avcc,
                int nalLengthSize, std::vector<std::byte>& out) {
    std::vector<std::byte> converted;
    converted.reserve(avcc.size() + sizeof(kStartCode) * (parameterSets.size() + 4));

    for (const auto& set : parameterSets) {
        if (set.empty()) {
            return false;
        }
        appendNal(set, converted);
    }

    if (!appendAvcc(avcc, nalLengthSize, converted)) {
        return false;
    }

    out = std::move(converted);
    return true;
}

namespace {

constexpr int kNalIdr = 5;
constexpr int kNalSps = 7;
constexpr int kNalPps = 8;
constexpr int kNalAccessUnitDelimiter = 9;

int nalType(std::span<const std::byte> nal) { return static_cast<int>(nal[0]) & 0x1F; }

/// Offset of the next 00 00 01 at or after `from`, or `data.size()`. Emulation
/// prevention guarantees that sequence never occurs inside a NAL unit.
size_t findStartCode(std::span<const std::byte> data, size_t from) {
    for (size_t i = from; i + 3 <= data.size(); ++i) {
        if (data[i] == std::byte{0} && data[i + 1] == std::byte{0} && data[i + 2] == std::byte{1}) {
            return i;
        }
    }
    return data.size();
}

/// Splits Annex-B into NAL units without their start codes. The zero byte of a
/// 4-byte start code, and any trailing_zero_8bits, belong to neither
/// neighbour, so trailing zeros are trimmed from each unit.
std::vector<std::span<const std::byte>> splitAnnexB(std::span<const std::byte> data) {
    std::vector<std::span<const std::byte>> nals;
    size_t start = findStartCode(data, 0);
    while (start < data.size()) {
        const size_t payload = start + 3;
        const size_t next = findStartCode(data, payload);
        size_t end = next;
        while (end > payload && data[end - 1] == std::byte{0}) {
            --end;
        }
        if (end > payload) {
            nals.push_back(data.subspan(payload, end - payload));
        }
        start = next;
    }
    return nals;
}

}  // namespace

bool normalizeFrame(std::span<const std::byte> annexB, ParameterSetCache& cache,
                    std::vector<std::byte>& out, bool& isKeyframe) {
    const auto nals = splitAnnexB(annexB);
    if (nals.empty()) {
        return false;
    }

    // Update the cache first, so an IDR that carries its own (possibly new)
    // parameter sets is prefixed with those rather than the previous ones.
    ParameterSetCache updated = cache;
    bool hasIdr = false;
    for (const auto& nal : nals) {
        const int type = nalType(nal);
        if (type == kNalSps) {
            updated.sps.assign(nal.begin(), nal.end());
        } else if (type == kNalPps) {
            updated.pps.assign(nal.begin(), nal.end());
        } else if (type == kNalIdr) {
            hasIdr = true;
        }
    }
    if (hasIdr && (updated.sps.empty() || updated.pps.empty())) {
        return false;
    }

    std::vector<std::byte> converted;
    converted.reserve(annexB.size() + updated.sps.size() + updated.pps.size() +
                      2 * sizeof(kStartCode));
    if (hasIdr) {
        appendNal(updated.sps, converted);
        appendNal(updated.pps, converted);
    }
    for (const auto& nal : nals) {
        const int type = nalType(nal);
        if (type == kNalSps || type == kNalPps || type == kNalAccessUnitDelimiter) {
            continue;
        }
        appendNal(nal, converted);
    }

    cache = std::move(updated);
    out = std::move(converted);
    isKeyframe = hasIdr;
    return true;
}

}  // namespace desktophost::annexb
