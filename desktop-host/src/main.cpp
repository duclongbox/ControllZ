#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>

#include "desktophost/capture/screen_capturer.h"
#include "desktophost/capture/test_pattern_capturer.h"
#include "desktophost/encode/video_encoder.h"
#include "desktophost/version.h"

namespace {

struct Options {
    std::string output = "capture.h264";
    int seconds = 10;
    int fps = 60;
    int bitrateBps = 8'000'000;
    int maxWidth = 1920;
    int maxHeight = 1080;
    uint32_t displayId = 0;
    bool showsCursor = true;
    bool testPattern = false;
};

std::atomic<bool> g_interrupted{false};

void onSignal(int) { g_interrupted.store(true); }

void printUsage() {
    std::printf(
        "desktop-host %s — record the screen to an Annex-B H.264 file.\n"
        "\n"
        "This is the capture -> encode half of the pipeline with no networking:\n"
        "verify the output with `ffplay <file>` before transport exists.\n"
        "\n"
        "Usage: desktop-host [options]\n"
        "  --record <path>     output file (default: capture.h264)\n"
        "  --seconds <n>       recording duration (default: 10)\n"
        "  --fps <n>           frame rate ceiling (default: 60)\n"
        "  --bitrate <bps>     target bitrate (default: 8000000)\n"
        "  --width <px>        max capture width (default: 1920)\n"
        "  --height <px>       max capture height (default: 1080)\n"
        "  --display <id>      CGDirectDisplayID, 0 for main (default: 0)\n"
        "  --no-cursor         do not composite the mouse cursor\n"
        "  --test-pattern      encode a synthetic pattern instead of the screen\n"
        "                      (needs no Screen Recording grant; isolates encode\n"
        "                      problems from capture ones)\n"
        "  --help              this message\n",
        desktophost::version());
}

/// Returns false on a malformed argument list, after printing why.
bool parseArgs(int argc, char** argv, Options* options, bool* shouldExit) {
    auto needsValue = [&](int i, const char* flag) {
        if (i + 1 >= argc) {
            std::fprintf(stderr, "%s requires a value\n", flag);
            return false;
        }
        return true;
    };

    for (int i = 1; i < argc; ++i) {
        const char* arg = argv[i];
        if (std::strcmp(arg, "--help") == 0 || std::strcmp(arg, "-h") == 0) {
            printUsage();
            *shouldExit = true;
            return true;
        }
        if (std::strcmp(arg, "--no-cursor") == 0) {
            options->showsCursor = false;
        } else if (std::strcmp(arg, "--test-pattern") == 0) {
            options->testPattern = true;
        } else if (std::strcmp(arg, "--record") == 0) {
            if (!needsValue(i, arg)) return false;
            options->output = argv[++i];
        } else if (std::strcmp(arg, "--seconds") == 0) {
            if (!needsValue(i, arg)) return false;
            options->seconds = std::atoi(argv[++i]);
        } else if (std::strcmp(arg, "--fps") == 0) {
            if (!needsValue(i, arg)) return false;
            options->fps = std::atoi(argv[++i]);
        } else if (std::strcmp(arg, "--bitrate") == 0) {
            if (!needsValue(i, arg)) return false;
            options->bitrateBps = std::atoi(argv[++i]);
        } else if (std::strcmp(arg, "--width") == 0) {
            if (!needsValue(i, arg)) return false;
            options->maxWidth = std::atoi(argv[++i]);
        } else if (std::strcmp(arg, "--height") == 0) {
            if (!needsValue(i, arg)) return false;
            options->maxHeight = std::atoi(argv[++i]);
        } else if (std::strcmp(arg, "--display") == 0) {
            if (!needsValue(i, arg)) return false;
            options->displayId = static_cast<uint32_t>(std::strtoul(argv[++i], nullptr, 10));
        } else {
            std::fprintf(stderr, "unknown argument: %s\n\n", arg);
            printUsage();
            return false;
        }
    }

    if (options->seconds <= 0 || options->fps <= 0 || options->bitrateBps <= 0 ||
        options->maxWidth < 2 || options->maxHeight < 2) {
        std::fprintf(stderr, "seconds, fps, bitrate and dimensions must be positive\n");
        return false;
    }
    return true;
}

}  // namespace

int main(int argc, char** argv) {
    Options options;
    bool shouldExit = false;
    if (!parseArgs(argc, argv, &options, &shouldExit)) {
        return 2;
    }
    if (shouldExit) {
        return 0;
    }

    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);

    desktophost::CaptureConfig captureConfig;
    captureConfig.displayId = options.displayId;
    captureConfig.maxWidth = options.maxWidth;
    captureConfig.maxHeight = options.maxHeight;
    captureConfig.maxFps = options.fps;
    captureConfig.showsCursor = options.showsCursor;

    auto capturer = options.testPattern ? desktophost::makeTestPatternCapturer(captureConfig)
                                        : desktophost::makeScreenCapturer(captureConfig);
    if (!capturer) {
        std::fprintf(stderr, "no screen capture backend on this platform\n");
        return 1;
    }

    std::ofstream file(options.output, std::ios::binary | std::ios::trunc);
    if (!file) {
        std::fprintf(stderr, "cannot open %s for writing\n", options.output.c_str());
        return 1;
    }

    // Capture has to start before the encoder so the real dimensions are known:
    // the requested size is a ceiling, and the actual one preserves the
    // display's aspect ratio inside it.
    std::atomic<bool> failed{false};
    std::mutex writeMutex;
    uint64_t frameCount = 0;
    uint64_t keyframeCount = 0;
    uint64_t byteCount = 0;

    std::unique_ptr<desktophost::IVideoEncoder> encoder;

    auto onError = [&](const desktophost::Status& status) {
        std::fprintf(stderr, "capture error: %s\n", status.message().c_str());
        failed.store(true);
    };

    auto onFrame = [&](desktophost::PlatformFrame frame) {
        if (encoder) {
            encoder->encode(std::move(frame));
        }
    };

    // Probing capture dimensions requires starting the stream, so the frame
    // callback is installed first and simply drops frames until the encoder
    // exists a few microseconds later.
    if (auto status = capturer->start(onFrame, onError); status.failed()) {
        std::fprintf(stderr, "capture failed to start: %s\n", status.message().c_str());
        return 1;
    }

    desktophost::EncoderConfig encoderConfig;
    encoderConfig.width = capturer->width();
    encoderConfig.height = capturer->height();
    encoderConfig.fps = options.fps;
    encoderConfig.bitrateBps = options.bitrateBps;

    encoder = desktophost::makeVideoEncoder(encoderConfig);
    if (!encoder) {
        std::fprintf(stderr, "no video encoder backend on this platform\n");
        capturer->stop();
        return 1;
    }

    auto onEncoded = [&](const desktophost::EncodedFrame& frame) {
        std::lock_guard<std::mutex> lock(writeMutex);
        file.write(reinterpret_cast<const char*>(frame.annexB.data()),
                   static_cast<std::streamsize>(frame.annexB.size()));
        ++frameCount;
        keyframeCount += frame.isKeyframe ? 1 : 0;
        byteCount += frame.annexB.size();
    };

    if (auto status = encoder->start(onEncoded); status.failed()) {
        std::fprintf(stderr, "encoder failed to start: %s\n", status.message().c_str());
        capturer->stop();
        return 1;
    }

    // The file has to open on an IDR or nothing downstream can start decoding.
    encoder->forceKeyframe();

    std::printf("recording %dx%d at up to %d fps, %d kbps -> %s (%d s, Ctrl-C to stop early)\n",
                capturer->width(), capturer->height(), options.fps, options.bitrateBps / 1000,
                options.output.c_str(), options.seconds);

    const auto started = std::chrono::steady_clock::now();
    const auto deadline = started + std::chrono::seconds(options.seconds);
    while (std::chrono::steady_clock::now() < deadline && !g_interrupted.load() && !failed.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    capturer->stop();
    encoder->stop();

    const double elapsed =
        std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();

    std::lock_guard<std::mutex> lock(writeMutex);
    file.close();

    if (frameCount == 0) {
        std::fprintf(stderr,
                     "no frames were encoded. If the screen was completely static this is "
                     "expected; otherwise check the Screen Recording permission.\n");
        return 1;
    }

    std::printf(
        "wrote %llu frames (%llu keyframes), %.2f MB in %.1fs — %.1f fps, %.2f Mbps\n"
        "verify: ffplay %s\n",
        static_cast<unsigned long long>(frameCount), static_cast<unsigned long long>(keyframeCount),
        static_cast<double>(byteCount) / (1024.0 * 1024.0), elapsed,
        static_cast<double>(frameCount) / elapsed,
        (static_cast<double>(byteCount) * 8.0) / elapsed / 1'000'000.0, options.output.c_str());

    return failed.load() ? 1 : 0;
}
