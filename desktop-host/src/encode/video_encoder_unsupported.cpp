#include "desktophost/encode/video_encoder.h"

// Placeholder for platforms without an encoder backend yet. Windows uses the
// Media Foundation H.264 MFT, which takes D3D11 textures directly and so holds
// the same GPU-resident invariant.

namespace desktophost {

std::unique_ptr<IVideoEncoder> makeVideoEncoder(const EncoderConfig&) {
    return nullptr;
}

}  // namespace desktophost
