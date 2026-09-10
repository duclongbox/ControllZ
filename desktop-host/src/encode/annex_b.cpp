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

}  // namespace desktophost::annexb
