#include "desktophost/input/pointer_mapping.h"

#include <cmath>

namespace desktophost {
namespace {

double clamp01(double value) {
    if (!std::isfinite(value)) {
        return 0.0;
    }
    return value < 0.0 ? 0.0 : (value > 1.0 ? 1.0 : value);
}

}  // namespace

ScreenPoint mapToScreen(double nx, double ny, const DisplayBounds& bounds) {
    if (!bounds.valid()) {
        return ScreenPoint{};
    }

    // The far edge maps to width - epsilon, not width: a point exactly on the
    // right edge of a 1512-wide display is x = 1512, which belongs to the
    // *next* display in the global space (or to nothing at all). Landing one
    // point inside keeps an edge swipe on the display the user is looking at,
    // which is what reaches a macOS menu bar or Dock at the screen edge.
    constexpr double kEdge = 1.0;
    const double x = bounds.x + clamp01(nx) * bounds.width;
    const double y = bounds.y + clamp01(ny) * bounds.height;

    return ScreenPoint{
        x > bounds.x + bounds.width - kEdge ? bounds.x + bounds.width - kEdge : x,
        y > bounds.y + bounds.height - kEdge ? bounds.y + bounds.height - kEdge : y,
    };
}

int32_t toAbsoluteInput(double coordinate, double origin, double extent) {
    if (!std::isfinite(coordinate) || !(extent >= 1.0)) {
        return 0;
    }
    constexpr int64_t kScale = 65536;
    constexpr int64_t kMax = 65535;
    const auto pixel = static_cast<int64_t>(std::floor(coordinate - origin));
    const auto span = static_cast<int64_t>(extent);
    if (pixel <= 0) {
        return 0;
    }
    // Ceiling division: the smallest n whose truncated inverse is `pixel`.
    const int64_t n = (pixel * kScale + span - 1) / span;
    return static_cast<int32_t>(n > kMax ? kMax : n);
}

}  // namespace desktophost
