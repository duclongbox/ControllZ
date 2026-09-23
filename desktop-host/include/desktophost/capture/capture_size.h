#pragma once

#include <algorithm>

namespace desktophost {

struct CaptureSize {
    int width = 0;
    int height = 0;
};

/// Largest even-dimensioned box with `srcW:srcH` aspect that fits in
/// `maxW x maxH`, never upscaling. Even because H.264 4:2:0 subsamples chroma
/// by two; aspect preserving because forcing a 16:10 panel into 1920x1080
/// stretches it. Shared by every capture backend so they size frames alike.
inline CaptureSize fitWithin(int srcW, int srcH, int maxW, int maxH) {
    if (srcW <= 0 || srcH <= 0) {
        return CaptureSize{maxW & ~1, maxH & ~1};
    }
    const double scale =
        std::min(static_cast<double>(maxW) / srcW, static_cast<double>(maxH) / srcH);
    const int w = static_cast<int>(srcW * (scale < 1.0 ? scale : 1.0));
    const int h = static_cast<int>(srcH * (scale < 1.0 ? scale : 1.0));
    return CaptureSize{std::max(2, w & ~1), std::max(2, h & ~1)};
}

}  // namespace desktophost
