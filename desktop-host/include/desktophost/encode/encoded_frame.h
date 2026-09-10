#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace desktophost {

/// One compressed frame, in Annex-B form and owned by ordinary heap memory.
///
/// This is the boundary where the pipeline stops being platform-specific: GPU
/// buffers and CoreFoundation lifetimes end at the encoder, and everything
/// downstream (packetizer, transport, file writer) moves plain bytes. Copying
/// here is cheap — a compressed frame is tens of kilobytes, not the megabytes
/// a raw one would be.
struct EncodedFrame {
    /// Annex-B bitstream. Parameter sets (SPS/PPS) are already prepended when
    /// `isKeyframe` is true.
    std::vector<std::byte> annexB;

    /// True for an IDR. Downstream needs this to answer "can a new viewer
    /// start decoding here?".
    bool isKeyframe = false;

    /// Capture timestamp carried through from PlatformFrame, in microseconds.
    int64_t ptsUs = 0;
};

}  // namespace desktophost
