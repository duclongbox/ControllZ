#include <atomic>
#include <cctype>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "desktophost/capture/screen_capturer.h"
#include "desktophost/capture/test_pattern_capturer.h"
#include "desktophost/encode/video_encoder.h"
#include "desktophost/input/input_injector.h"
#include "desktophost/input/input_router.h"
#include "desktophost/signaling/signaling_client.h"
#include "desktophost/transport/mdns_candidate.h"
#include "desktophost/transport/peer_connection.h"
#include "desktophost/version.h"

namespace {

struct Options {
    // Recorder mode
    std::string output = "capture.h264";
    int seconds = 10;

    // Shared
    int fps = 60;
    int bitrateBps = 8'000'000;
    int maxWidth = 1920;
    int maxHeight = 1080;
    uint32_t displayId = 0;
    bool showsCursor = true;
    bool testPattern = false;

    // Serve mode
    bool serve = false;
    std::string signalingUrl = "ws://localhost:8080/ws";
    std::string displayName = "Desktop";
    std::string identityPath;  // empty: resolved under $HOME
    // Raw --stun value: a comma-separated list, "none" to disable STUN, or
    // empty to leave PeerConnectionConfig's built-in list untouched. Keeping
    // the default in exactly one place (peer_connection.h) stops the two
    // copies drifting apart, which is how a host ends up quietly gathering
    // against a server nobody meant to use.
    std::string stunUrl;
    bool input = true;
};

std::atomic<bool> g_interrupted{false};

void onSignal(int) { g_interrupted.store(true); }

std::string defaultIdentityPath() {
    const char* home = std::getenv("HOME");
    if (home == nullptr) {
        // Windows does not set HOME; USERPROFILE is its equivalent.
        home = std::getenv("USERPROFILE");
    }
    if (home == nullptr) {
        return "desktop-identity.json";
    }
    return std::string(home) + "/.remotehost/desktop-identity.json";
}

/// Splits a comma-separated list, trimming surrounding spaces and dropping
/// empty fields, so "a, b," yields {"a", "b"}.
std::vector<std::string> splitList(const std::string& value) {
    std::vector<std::string> out;
    std::size_t start = 0;
    while (start <= value.size()) {
        const std::size_t comma = value.find(',', start);
        const std::size_t end = comma == std::string::npos ? value.size() : comma;
        std::size_t first = start;
        std::size_t last = end;
        while (first < last && std::isspace(static_cast<unsigned char>(value[first]))) ++first;
        while (last > first && std::isspace(static_cast<unsigned char>(value[last - 1]))) --last;
        if (last > first) out.push_back(value.substr(first, last - first));
        if (comma == std::string::npos) break;
        start = comma + 1;
    }
    return out;
}

void printUsage() {
    std::printf(
        "desktop-host %s — capture the screen and either record it or stream it.\n"
        "\n"
        "Two modes:\n"
        "  (default)  record to an Annex-B H.264 file; verify with `ffplay <file>`.\n"
        "  --serve    connect to the signaling server and stream to a paired phone.\n"
        "\n"
        "Usage: desktop-host [options]\n"
        "  --serve             stream instead of recording\n"
        "  --signaling <url>   signaling WebSocket (default: ws://localhost:8080/ws)\n"
        "  --name <text>       name shown on the phone (default: Desktop)\n"
        "  --identity <path>   where the device identity is stored\n"
        "                      (default: ~/.remotehost/desktop-identity.json)\n"
        "  --stun <urls>       comma-separated STUN servers, or 'none' for host\n"
        "                      candidates only (default: Cloudflare, Google and\n"
        "                      Twilio on port 3478)\n"
        "  --no-input          stream only; refuse pointer control from the phone\n"
        "  --record <path>     output file (default: capture.h264)\n"
        "  --seconds <n>       recording duration (default: 10)\n"
        "  --fps <n>           frame rate ceiling (default: 60)\n"
        "  --bitrate <bps>     target bitrate (default: 8000000)\n"
        "  --width <px>        max capture width (default: 1920)\n"
        "  --height <px>       max capture height (default: 1080)\n"
        "  --display <id>      display to capture, 0 for main (default: 0). macOS:\n"
        "                      CGDirectDisplayID. Windows: monitor number, from 1\n"
        "  --no-cursor         do not composite the mouse cursor\n"
        "  --test-pattern      encode a synthetic pattern instead of the screen\n"
        "                      (needs no capture permission; combine with\n"
        "                      --serve to test the browser path on its own)\n"
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
        } else if (std::strcmp(arg, "--no-input") == 0) {
            options->input = false;
        } else if (std::strcmp(arg, "--serve") == 0) {
            options->serve = true;
        } else if (std::strcmp(arg, "--signaling") == 0) {
            if (!needsValue(i, arg)) return false;
            options->signalingUrl = argv[++i];
        } else if (std::strcmp(arg, "--name") == 0) {
            if (!needsValue(i, arg)) return false;
            options->displayName = argv[++i];
        } else if (std::strcmp(arg, "--identity") == 0) {
            if (!needsValue(i, arg)) return false;
            options->identityPath = argv[++i];
        } else if (std::strcmp(arg, "--stun") == 0) {
            if (!needsValue(i, arg)) return false;
            options->stunUrl = argv[++i];
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

desktophost::CaptureConfig captureConfigFrom(const Options& options) {
    desktophost::CaptureConfig config;
    config.displayId = options.displayId;
    config.maxWidth = options.maxWidth;
    config.maxHeight = options.maxHeight;
    config.maxFps = options.fps;
    config.showsCursor = options.showsCursor;
    return config;
}

std::unique_ptr<desktophost::IScreenCapturer> makeCapturer(const Options& options) {
    const desktophost::CaptureConfig config = captureConfigFrom(options);
    return options.testPattern ? desktophost::makeTestPatternCapturer(config)
                               : desktophost::makeScreenCapturer(config);
}

// ---------------------------------------------------------------------------
// Recorder mode
// ---------------------------------------------------------------------------

int runRecord(const Options& options) {
    auto capturer = makeCapturer(options);
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

    // What the capture queue reads. `encoder` itself is assigned on this
    // thread while frames are already arriving, so the capture side only ever
    // sees this pointer, published once the encoder is started.
    std::atomic<desktophost::IVideoEncoder*> liveEncoder{nullptr};

    auto onError = [&](const desktophost::Status& status) {
        std::fprintf(stderr, "capture error: %s\n", status.message().c_str());
        failed.store(true);
    };

    auto onFrame = [&](desktophost::PlatformFrame frame) {
        if (auto* target = liveEncoder.load()) {
            target->encode(std::move(frame));
        }
    };

    // Probing capture dimensions requires starting the stream, so the frame
    // callback is installed first and simply drops frames until the encoder
    // is published a few milliseconds later.
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
    liveEncoder.store(encoder.get());

    std::printf("recording %dx%d at up to %d fps, %d kbps -> %s (%d s, Ctrl-C to stop early)\n",
                capturer->width(), capturer->height(), options.fps, options.bitrateBps / 1000,
                options.output.c_str(), options.seconds);

    const auto started = std::chrono::steady_clock::now();
    const auto deadline = started + std::chrono::seconds(options.seconds);
    while (std::chrono::steady_clock::now() < deadline && !g_interrupted.load() && !failed.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    // Order matters: stop() guarantees no frame callback is still inside
    // encode(), so the encoder session can be torn down safely after it.
    capturer->stop();
    encoder->stop();

    const double elapsed =
        std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();

    std::lock_guard<std::mutex> lock(writeMutex);
    file.close();

    if (frameCount == 0) {
        std::fprintf(stderr,
                     "no frames were encoded. If the screen was completely static this is "
                     "expected; otherwise check the Screen Recording permission (macOS).\n");
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

// ---------------------------------------------------------------------------
// Serve mode
// ---------------------------------------------------------------------------

/// Everything one viewer owns. Rebuilt per session and destroyed when the
/// phone leaves, so the next connection starts from a fresh encoder rather
/// than mid-GOP.
struct Session {
    std::string id;
    std::unique_ptr<desktophost::IScreenCapturer> capturer;
    std::unique_ptr<desktophost::IVideoEncoder> encoder;
    std::unique_ptr<desktophost::IPeerConnection> peer;
    std::unique_ptr<desktophost::IInputInjector> injector;
    std::unique_ptr<desktophost::InputRouter> router;

    // Published only once each stage is running; the capture and encoder
    // threads read these rather than the unique_ptrs, which the session
    // thread is still assigning.
    std::atomic<desktophost::IVideoEncoder*> liveEncoder{nullptr};
    std::atomic<desktophost::IPeerConnection*> livePeer{nullptr};
    // Read by libdatachannel's thread on every input message and by the main
    // loop's deadman tick.
    std::atomic<desktophost::InputRouter*> liveRouter{nullptr};
};

void stopSession(const std::shared_ptr<Session>& session) {
    if (!session) {
        return;
    }
    // Unpublish first so in-flight frames stop reaching a closing encoder.
    session->liveEncoder.store(nullptr);
    session->livePeer.store(nullptr);
    session->liveRouter.store(nullptr);

    // Before the peer connection goes: no pointerUp can arrive after this, so
    // anything still held has to be let go here or the desktop is left with a
    // stuck mouse button and no way to hear about it.
    if (session->router) {
        session->router->releaseAll();
    }

    if (session->capturer) {
        session->capturer->stop();
    }
    if (session->encoder) {
        session->encoder->stop();
    }
    if (session->peer) {
        session->peer->close();
    }
}

int runServe(const Options& options) {
    desktophost::SignalingConfig signalingConfig;
    signalingConfig.url = options.signalingUrl;
    signalingConfig.displayName = options.displayName;
    signalingConfig.identityPath =
        options.identityPath.empty() ? defaultIdentityPath() : options.identityPath;

    auto signaling = desktophost::makeSignalingClient(signalingConfig);
    if (!signaling) {
        std::fprintf(stderr, "no signaling backend on this platform\n");
        return 1;
    }

    // Asked for once at startup, with the prompt, rather than at session start:
    // the dialog is useless the moment the user is holding the phone. This is
    // the Accessibility grant, NOT the Screen Recording one capture already
    // has — seeing the screen does not imply being allowed to click on it.
    if (options.input && !desktophost::inputInjectionPermitted(true)) {
        std::fprintf(stderr,
                     "\n  Pointer control needs the Accessibility permission.\n"
                     "  System Settings > Privacy & Security > Accessibility, then restart "
                     "this host.\n"
                     "  Launched from a terminal, the permission lands on the TERMINAL app\n"
                     "  (Terminal, iTerm, your IDE), not on desktop-host.\n"
                     "  Sessions still stream video meanwhile; they are just view-only.\n\n");
    }

    std::mutex sessionMutex;
    std::shared_ptr<Session> current;
    std::atomic<bool> disconnected{false};

    // Runs on the signaling thread. Everything the session needs is built
    // here, in dependency order: capture first (it decides the resolution),
    // then the encoder, then the peer connection whose offer starts ICE.
    auto startSession = [&](const std::string& sessionId, const std::string& peerDeviceId) {
        std::printf("session %s: phone %s connected\n", sessionId.c_str(), peerDeviceId.c_str());

        auto session = std::make_shared<Session>();
        session->id = sessionId;
        session->capturer = makeCapturer(options);
        if (!session->capturer) {
            std::fprintf(stderr, "no screen capture backend on this platform\n");
            return;
        }

        auto captureStatus = session->capturer->start(
            [session](desktophost::PlatformFrame frame) {
                if (auto* encoder = session->liveEncoder.load()) {
                    encoder->encode(std::move(frame));
                }
            },
            [](const desktophost::Status& status) {
                std::fprintf(stderr, "capture error: %s\n", status.message().c_str());
            });
        if (captureStatus.failed()) {
            std::fprintf(stderr, "capture failed to start: %s\n", captureStatus.message().c_str());
            return;
        }

        desktophost::EncoderConfig encoderConfig;
        encoderConfig.width = session->capturer->width();
        encoderConfig.height = session->capturer->height();
        encoderConfig.fps = options.fps;
        encoderConfig.bitrateBps = options.bitrateBps;

        session->encoder = desktophost::makeVideoEncoder(encoderConfig);
        if (!session->encoder) {
            std::fprintf(stderr, "no video encoder backend on this platform\n");
            session->capturer->stop();
            return;
        }

        auto encoderStatus = session->encoder->start([session](
                                                         const desktophost::EncodedFrame& frame) {
            if (auto* peer = session->livePeer.load()) {
                peer->sendFrame(frame);
            }
        });
        if (encoderStatus.failed()) {
            std::fprintf(stderr, "encoder failed to start: %s\n", encoderStatus.message().c_str());
            session->capturer->stop();
            return;
        }

        // Input is set up before the offer, because whether the offer carries
        // an SCTP m-line at all depends on whether this side can inject: a
        // channel the host would only ever ignore is worse than no channel,
        // since the phone would show a live cursor that does nothing.
        if (options.input) {
            session->injector = desktophost::makeInputInjector(options.displayId);
            if (!session->injector) {
                std::fprintf(stderr, "no input backend on this platform — view-only session\n");
            } else if (!desktophost::inputInjectionPermitted(false)) {
                std::fprintf(stderr,
                             "Accessibility permission missing — view-only session. Grant it in\n"
                             "System Settings > Privacy & Security > Accessibility, then "
                             "reconnect.\n");
                session->injector.reset();
            } else {
                session->router = std::make_unique<desktophost::InputRouter>(
                    session->injector.get());
            }
        }

        desktophost::PeerConnectionConfig peerConfig;
        if (options.stunUrl == "none") {
            peerConfig.iceServers.clear();
        } else if (!options.stunUrl.empty()) {
            peerConfig.iceServers = splitList(options.stunUrl);
        }
        peerConfig.bitrateKbps = options.bitrateBps / 1000;
        peerConfig.enableInputChannel = session->router != nullptr;

        session->peer = desktophost::makePeerConnection(peerConfig);

        desktophost::PeerConnectionCallbacks peerCallbacks;
        peerCallbacks.onLocalDescription = [&signaling, sessionId](const std::string& sdp,
                                                                   const std::string& type) {
            if (type == "offer") {
                signaling->sendOffer(sessionId, sdp);
            }
        };
        peerCallbacks.onLocalCandidate = [&signaling, sessionId](const std::string& candidate,
                                                                 const std::string& mid) {
            std::printf("  ice local  > %s\n", candidate.c_str());
            signaling->sendIceCandidate(sessionId, candidate, mid);
        };
        peerCallbacks.onStateChange = [session](desktophost::PeerState state) {
            switch (state) {
                case desktophost::PeerState::connected:
                    std::printf("session %s: peer connected\n", session->id.c_str());
                    // The viewer cannot decode a thing until an IDR arrives,
                    // and the encoder emits none on its own. Everything sent
                    // before the track opened was dropped, so ask now.
                    if (auto* encoder = session->liveEncoder.load()) {
                        encoder->forceKeyframe();
                    }
                    break;
                case desktophost::PeerState::failed:
                    std::fprintf(stderr, "session %s: ICE failed — no route to the phone\n",
                                 session->id.c_str());
                    break;
                default:
                    break;
            }
        };
        peerCallbacks.onKeyframeRequest = [session] {
            if (auto* encoder = session->liveEncoder.load()) {
                encoder->forceKeyframe();
            }
        };
        // Injected straight from libdatachannel's thread. CGEventPost does not
        // block, so a worker thread in between would add a queue and a frame of
        // latency to buy nothing; a backend that can block needs one.
        peerCallbacks.onInputMessage = [session](std::string message) {
            if (auto* router = session->liveRouter.load()) {
                router->handleMessage(message, std::chrono::steady_clock::now());
            }
        };
        peerCallbacks.onInputChannelClosed = [session] {
            if (auto* router = session->liveRouter.load()) {
                router->releaseAll();
            }
        };

        if (auto status = session->peer->start(std::move(peerCallbacks)); status.failed()) {
            std::fprintf(stderr, "transport failed to start: %s\n", status.message().c_str());
            session->capturer->stop();
            session->encoder->stop();
            return;
        }

        session->livePeer.store(session->peer.get());
        session->liveEncoder.store(session->encoder.get());
        session->liveRouter.store(session->router.get());

        std::shared_ptr<Session> previous;
        {
            std::lock_guard<std::mutex> lock(sessionMutex);
            previous = std::move(current);
            current = session;
        }
        stopSession(previous);

        std::printf("session %s: streaming %dx%d, input %s\n", sessionId.c_str(),
                    session->capturer->width(), session->capturer->height(),
                    session->router ? "enabled" : "disabled");
    };

    auto withSession = [&](const std::string& sessionId, auto&& action) {
        std::shared_ptr<Session> session;
        {
            std::lock_guard<std::mutex> lock(sessionMutex);
            session = current;
        }
        if (session && session->id == sessionId) {
            action(session);
        }
    };

    desktophost::SignalingCallbacks callbacks;
    callbacks.onRegistered = [](const std::string& deviceId) {
        std::printf("registered with the signaling server as %s\n", deviceId.c_str());
    };
    callbacks.onAuthenticated = [](const std::string& deviceId) {
        std::printf("authenticated as %s\n", deviceId.c_str());
    };
    callbacks.onPairCodeIssued = [](const std::string& code, const std::string& expiresAt) {
        std::printf("\n  pairing code: %s   (expires %s)\n  enter it on the phone to pair.\n\n",
                    code.c_str(), expiresAt.c_str());
    };
    callbacks.onPaired = [&](const std::string& peerDeviceId, const std::string& peerDisplayName) {
        std::printf("paired with %s (%s)\n",
                    peerDisplayName.empty() ? "a phone" : peerDisplayName.c_str(),
                    peerDeviceId.c_str());
        // The code that was just redeemed is spent. Issue the next one now, so
        // pairing a second device never means restarting the host.
        signaling->requestPairCode();
    };
    callbacks.onSessionStarted = startSession;
    callbacks.onSdpAnswer = [&](const std::string& sessionId, const std::string& sdp) {
        withSession(sessionId,
                    [&](const std::shared_ptr<Session>& session) {
                        session->peer->setRemoteDescription(sdp, "answer");
                    });
    };
    callbacks.onIceCandidate = [&](const std::string& sessionId, const std::string& candidate,
                                   const std::string& sdpMid) {
        withSession(sessionId, [&](const std::shared_ptr<Session>& session) {
            std::printf("  ice remote < %s\n", candidate.c_str());

            // A browser hides the phone's local IP behind a random
            // "<uuid>.local" name, which libjuice discards outright. Resolving
            // it restores the one pair that works when both peers sit behind
            // the same router. Resolution talks to mDNSResponder and can take
            // a moment, and this runs on the signaling socket's thread, so it
            // goes to a worker: the shared_ptr keeps the session alive for as
            // long as that worker needs it.
            if (candidate.find(".local") != std::string::npos) {
                std::thread([session, candidate, sdpMid] {
                    const std::optional<std::string> resolved =
                        desktophost::resolveMdnsCandidate(candidate,
                                                          desktophost::resolveHostAddress);
                    if (!resolved) {
                        std::fprintf(stderr,
                                     "  ice remote < ^ mDNS name did not resolve; dropping this\n"
                                     "                host candidate. Same-network pairing now\n"
                                     "                relies on the phone reaching *our* host\n"
                                     "                candidate.\n");
                        return;
                    }
                    std::printf("  ice remote < ^ resolved to %s\n", resolved->c_str());
                    session->peer->addRemoteCandidate(*resolved, sdpMid);
                }).detach();
                return;
            }

            session->peer->addRemoteCandidate(candidate, sdpMid);
        });
    };
    callbacks.onPeerDisconnected = [&](const std::string& sessionId) {
        std::printf("session %s: phone disconnected\n", sessionId.c_str());
        std::shared_ptr<Session> session;
        {
            std::lock_guard<std::mutex> lock(sessionMutex);
            if (current && current->id == sessionId) {
                session = std::move(current);
                current.reset();
            }
        }
        stopSession(session);
    };
    callbacks.onError = [](const std::string& code, const std::string& message) {
        std::fprintf(stderr, "signaling error: %s (%s)\n", message.c_str(), code.c_str());
    };
    callbacks.onClosed = [&](const desktophost::Status& status) {
        if (status.failed()) {
            std::fprintf(stderr, "signaling connection lost: %s\n", status.message().c_str());
        } else {
            std::fprintf(stderr, "signaling connection closed\n");
        }
        disconnected.store(true);
    };

    if (auto status = signaling->connect(std::move(callbacks)); status.failed()) {
        std::fprintf(stderr, "cannot reach the signaling server: %s\n", status.message().c_str());
        return 1;
    }

    // Always offer a code: pairing is idempotent on the server, and a desktop
    // with no way to show one is a desktop no new phone can ever reach.
    signaling->requestPairCode();

    // Codes expire after five minutes on the server, so refresh inside that
    // window: a host left running while you find your phone must still be
    // pairable. Skipped while a session is live — nobody is reading the
    // terminal then, and the code would go stale again anyway.
    constexpr auto kCodeRefresh = std::chrono::minutes(4);
    auto nextCodeAt = std::chrono::steady_clock::now() + kCodeRefresh;

    std::printf("waiting for a paired phone (Ctrl-C to stop)\n");
    while (!g_interrupted.load() && !disconnected.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));

        // The deadman. A live session repairs a lost pointerUp within a frame
        // from the button mask on the next move; this is for when the samples
        // stop altogether — the phone locked, the network dropped — and there
        // is nothing left to repair against.
        {
            std::lock_guard<std::mutex> lock(sessionMutex);
            if (current) {
                if (auto* router = current->liveRouter.load()) {
                    router->tick(std::chrono::steady_clock::now());
                }
            }
        }

        if (std::chrono::steady_clock::now() < nextCodeAt) {
            continue;
        }
        nextCodeAt = std::chrono::steady_clock::now() + kCodeRefresh;

        bool idle = false;
        {
            std::lock_guard<std::mutex> lock(sessionMutex);
            idle = (current == nullptr);
        }
        if (idle) {
            signaling->requestPairCode();
        }
    }

    std::shared_ptr<Session> session;
    {
        std::lock_guard<std::mutex> lock(sessionMutex);
        session = std::move(current);
        current.reset();
    }
    stopSession(session);
    signaling->close();

    return disconnected.load() ? 1 : 0;
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

    // Serve mode prints a pairing code and then waits, so its output has to
    // appear as it happens even when piped to a log or a pager — block
    // buffering would hold the code back until the process exits.
#if defined(_WIN32)
    // The MSVC runtime has no line buffering (_IOLBF means full buffering) and
    // treats a zero size as an invalid parameter, which aborts the process.
    std::setvbuf(stdout, nullptr, _IONBF, 0);
#else
    std::setvbuf(stdout, nullptr, _IOLBF, 0);
#endif

    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);

    return options.serve ? runServe(options) : runRecord(options);
}
