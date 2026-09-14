#include "desktophost/signaling/signaling_client.h"

#include <nlohmann/json.hpp>
#include <rtc/rtc.hpp>

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <exception>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <string>
#include <utility>

namespace desktophost {
namespace {

using nlohmann::json;

constexpr auto kHandshakeTimeout = std::chrono::seconds(10);

/// The device's half of an enrollment: what has to survive a restart for the
/// phone's pairing to stay valid.
struct Identity {
    std::string deviceId;
    std::string credential;

    bool valid() const { return !deviceId.empty() && !credential.empty(); }
};

Identity loadIdentity(const std::string& path) {
    if (path.empty()) {
        return {};
    }
    std::ifstream file(path);
    if (!file) {
        return {};
    }
    try {
        const json parsed = json::parse(file);
        return Identity{parsed.value("deviceId", ""), parsed.value("credential", "")};
    } catch (const std::exception& e) {
        std::fprintf(stderr, "[signaling] ignoring unreadable identity at %s: %s\n", path.c_str(),
                     e.what());
        return {};
    }
}

void saveIdentity(const std::string& path, const Identity& identity) {
    if (path.empty()) {
        return;
    }
    std::error_code ec;
    const std::filesystem::path file(path);
    if (file.has_parent_path()) {
        std::filesystem::create_directories(file.parent_path(), ec);
    }

    std::ofstream out(path, std::ios::trunc);
    if (!out) {
        std::fprintf(stderr, "[signaling] cannot write identity to %s\n", path.c_str());
        return;
    }
    out << json{{"deviceId", identity.deviceId}, {"credential", identity.credential}}.dump(2);
    out.close();

    // The credential is a bearer secret: anyone holding it is this desktop.
    std::filesystem::permissions(file,
                                 std::filesystem::perms::owner_read |
                                     std::filesystem::perms::owner_write,
                                 std::filesystem::perm_options::replace, ec);
}

class WebSocketSignalingClient final : public ISignalingClient {
public:
    explicit WebSocketSignalingClient(const SignalingConfig& config) : config_(config) {}

    ~WebSocketSignalingClient() override { close(); }

    Status connect(SignalingCallbacks callbacks) override {
        if (ws_ != nullptr) {
            return Status::error("signaling client already connected");
        }
        callbacks_ = std::move(callbacks);
        identity_ = loadIdentity(config_.identityPath);

        ws_ = std::make_shared<rtc::WebSocket>();

        ws_->onOpen([this] {
            std::lock_guard<std::mutex> lock(mutex_);
            open_ = true;
            signal_.notify_all();
        });
        ws_->onMessage([this](rtc::message_variant data) {
            if (!std::holds_alternative<std::string>(data)) {
                return;  // the protocol is text-only; binary is not ours
            }
            handleMessage(std::get<std::string>(data));
        });
        ws_->onClosed([this] {
            {
                std::lock_guard<std::mutex> lock(mutex_);
                open_ = false;
                // Unblocks connect() if the socket dies mid-handshake.
                signal_.notify_all();
            }
            if (callbacks_.onClosed) {
                callbacks_.onClosed(Status::ok());
            }
        });
        ws_->onError([this](std::string error) {
            {
                std::lock_guard<std::mutex> lock(mutex_);
                lastError_ = error;
                signal_.notify_all();
            }
            if (callbacks_.onClosed) {
                callbacks_.onClosed(Status::error("signaling socket error: " + error));
            }
        });

        try {
            ws_->open(config_.url);
        } catch (const std::exception& e) {
            ws_.reset();
            return Status::error(std::string("cannot open ") + config_.url + ": " + e.what());
        }

        {
            std::unique_lock<std::mutex> lock(mutex_);
            if (!signal_.wait_for(lock, kHandshakeTimeout,
                                  [this] { return open_ || !lastError_.empty(); })) {
                return Status::error("timed out connecting to " + config_.url);
            }
            if (!lastError_.empty()) {
                return Status::error("cannot reach " + config_.url + ": " + lastError_);
            }
        }

        // An identity from a previous run keeps existing pairings valid;
        // without one this is a first run and the server issues both.
        if (identity_.valid()) {
            send(json{{"type", "authenticate"},
                      {"deviceId", identity_.deviceId},
                      {"credential", identity_.credential}});
        } else {
            send(json{{"type", "register"},
                      {"deviceType", "desktop"},
                      {"displayName", config_.displayName}});
        }

        {
            std::unique_lock<std::mutex> lock(mutex_);
            if (!signal_.wait_for(lock, kHandshakeTimeout,
                                  [this] { return identified_ || !handshakeError_.empty(); })) {
                return Status::error("signaling server did not answer the handshake");
            }
            if (!handshakeError_.empty()) {
                return Status::error(handshakeError_);
            }
        }

        return Status::ok();
    }

    void requestPairCode() override { send(json{{"type", "pairCodeRequest"}}); }

    void sendOffer(const std::string& sessionId, const std::string& sdp) override {
        send(json{{"type", "sdpOffer"}, {"sessionId", sessionId}, {"sdp", sdp}});
    }

    void sendIceCandidate(const std::string& sessionId, const std::string& candidate,
                          const std::string& sdpMid) override {
        send(json{{"type", "iceCandidate"},
                  {"sessionId", sessionId},
                  {"candidate", candidate},
                  {"sdpMid", sdpMid}});
    }

    void close() override {
        std::shared_ptr<rtc::WebSocket> socket;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            socket = std::move(ws_);
            ws_.reset();
            open_ = false;
        }
        if (socket != nullptr) {
            try {
                socket->close();
            } catch (const std::exception&) {
                // Teardown; nothing useful to report.
            }
        }
    }

private:
    void send(const json& message) {
        std::shared_ptr<rtc::WebSocket> socket;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            socket = ws_;
        }
        if (socket == nullptr) {
            return;
        }
        try {
            socket->send(message.dump());
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[signaling] send failed: %s\n", e.what());
        }
    }

    void handleMessage(const std::string& payload) {
        json message;
        try {
            message = json::parse(payload);
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[signaling] unparseable message: %s\n", e.what());
            return;
        }

        const std::string type = message.value("type", "");

        if (type == "registered") {
            identity_ = Identity{message.value("deviceId", ""), message.value("credential", "")};
            saveIdentity(config_.identityPath, identity_);
            finishHandshake("");
            if (callbacks_.onRegistered) {
                callbacks_.onRegistered(identity_.deviceId);
            }
        } else if (type == "authenticated") {
            finishHandshake("");
            if (callbacks_.onAuthenticated) {
                callbacks_.onAuthenticated(message.value("deviceId", ""));
            }
        } else if (type == "pairCodeIssued") {
            if (callbacks_.onPairCodeIssued) {
                callbacks_.onPairCodeIssued(message.value("code", ""),
                                            message.value("expiresAt", ""));
            }
        } else if (type == "pairedConfirmed") {
            if (callbacks_.onPaired) {
                callbacks_.onPaired(message.value("peerDeviceId", ""),
                                    message.value("peerDisplayName", ""));
            }
        } else if (type == "sessionStarted") {
            if (callbacks_.onSessionStarted) {
                callbacks_.onSessionStarted(message.value("sessionId", ""),
                                            message.value("peerDeviceId", ""));
            }
        } else if (type == "sdpAnswer") {
            if (callbacks_.onSdpAnswer) {
                callbacks_.onSdpAnswer(message.value("sessionId", ""), message.value("sdp", ""));
            }
        } else if (type == "iceCandidate") {
            if (callbacks_.onIceCandidate) {
                std::string sdpMid;
                if (message.contains("sdpMid") && message["sdpMid"].is_string()) {
                    sdpMid = message["sdpMid"].get<std::string>();
                }
                callbacks_.onIceCandidate(message.value("sessionId", ""),
                                          message.value("candidate", ""), sdpMid);
            }
        } else if (type == "peerDisconnected") {
            if (callbacks_.onPeerDisconnected) {
                callbacks_.onPeerDisconnected(message.value("sessionId", ""));
            }
        } else if (type == "error") {
            const std::string code = message.value("code", "");
            const std::string text = message.value("message", "");
            // An error arriving before the handshake completes is the reason
            // connect() is still blocked, so it has to unblock it.
            finishHandshake("signaling rejected this device: " + text + " (" + code + ")");
            if (callbacks_.onError) {
                callbacks_.onError(code, text);
            }
        }
        // connectRejected, heartbeatAck and echo need no action on this side;
        // the phone drives those flows.
    }

    void finishHandshake(const std::string& error) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (identified_ || !handshakeError_.empty()) {
                return;  // already settled; a later error is a runtime one
            }
            if (error.empty()) {
                identified_ = true;
            } else {
                handshakeError_ = error;
            }
        }
        signal_.notify_all();
    }

    SignalingConfig config_;
    SignalingCallbacks callbacks_;
    Identity identity_;

    std::mutex mutex_;
    std::condition_variable signal_;
    std::shared_ptr<rtc::WebSocket> ws_;
    bool open_ = false;
    bool identified_ = false;
    std::string handshakeError_;
    std::string lastError_;
};

}  // namespace

std::unique_ptr<ISignalingClient> makeSignalingClient(const SignalingConfig& config) {
    return std::make_unique<WebSocketSignalingClient>(config);
}

}  // namespace desktophost
