#include <catch2/catch_test_macros.hpp>

#include <rtc/rtc.hpp>

#if defined(_WIN32)
#include <process.h>
#else
#include <unistd.h>
#endif

#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

#include "desktophost/signaling/signaling_client.h"

using namespace desktophost;
using namespace std::chrono_literals;

namespace {

/// A stand-in signaling server: records what the client sent and answers with
/// whatever the test dictates. Real WebSocket frames over loopback, so the
/// client's own socket handling is on trial too — which is the point, since
/// the bug being guarded lives in how it reacts to a message, not in parsing.
class FakeServer {
public:
    FakeServer() {
        rtc::WebSocketServer::Configuration config;
        config.port = 0;  // ephemeral: parallel test runs must not collide
        config.bindAddress = "127.0.0.1";
        server_ = std::make_unique<rtc::WebSocketServer>(config);
        server_->onClient([this](std::shared_ptr<rtc::WebSocket> socket) {
            {
                std::lock_guard<std::mutex> lock(mutex_);
                client_ = socket;
            }
            socket->onMessage([this](rtc::message_variant data) {
                if (!std::holds_alternative<std::string>(data)) {
                    return;
                }
                {
                    std::lock_guard<std::mutex> lock(mutex_);
                    received_.push_back(std::get<std::string>(data));
                }
                signal_.notify_all();
            });
        });
    }

    ~FakeServer() { server_->stop(); }

    std::string url() const {
        std::ostringstream out;
        out << "ws://127.0.0.1:" << server_->port() << "/ws";
        return out.str();
    }

    /// Waits for the client's nth message (1-based), returning it.
    std::string awaitMessage(std::size_t nth) {
        std::unique_lock<std::mutex> lock(mutex_);
        const bool arrived =
            signal_.wait_for(lock, 5s, [&] { return received_.size() >= nth; });
        REQUIRE(arrived);
        return received_[nth - 1];
    }

    void send(const std::string& message) {
        std::shared_ptr<rtc::WebSocket> socket;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            socket = client_;
        }
        REQUIRE(socket != nullptr);
        socket->send(message);
    }

    std::size_t messageCount() {
        std::lock_guard<std::mutex> lock(mutex_);
        return received_.size();
    }

private:
    std::unique_ptr<rtc::WebSocketServer> server_;
    std::mutex mutex_;
    std::condition_variable signal_;
    std::shared_ptr<rtc::WebSocket> client_;
    std::vector<std::string> received_;
};

/// Keeps concurrent test runs (ctest -j) out of each other's directories.
long long processId() {
#if defined(_WIN32)
    return _getpid();
#else
    return ::getpid();
#endif
}

/// An identity file in a directory of its own, removed with the fixture.
class TempIdentity {
public:
    explicit TempIdentity(const std::string& contents) {
        directory_ = std::filesystem::temp_directory_path() /
                     ("desktophost-test-" + std::to_string(processId()) + "-" +
                      std::to_string(counter_++));
        std::filesystem::create_directories(directory_);
        path_ = directory_ / "desktop-identity.json";
        if (!contents.empty()) {
            std::ofstream out(path_);
            out << contents;
        }
    }

    ~TempIdentity() {
        std::error_code ec;
        std::filesystem::remove_all(directory_, ec);
    }

    std::string path() const { return path_.string(); }

    std::string contents() const {
        std::ifstream in(path_);
        return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    }

private:
    static inline int counter_ = 0;
    std::filesystem::path directory_;
    std::filesystem::path path_;
};

bool contains(const std::string& haystack, const std::string& needle) {
    return haystack.find(needle) != std::string::npos;
}

}  // namespace

// The failure this guards: the signaling server keeps devices in memory, so
// restarting it forgets every enrolment while the desktop still holds the
// credential on disk. The host authenticated, was told "Unknown device or bad
// credential", and exited — permanently unable to start until the file was
// deleted by hand, with nothing on screen saying so.
TEST_CASE("a forgotten identity re-enrols instead of failing the handshake", "[signaling]") {
    FakeServer server;
    TempIdentity identity(R"({"deviceId":"ca363bdc-b11d-4cc9-b57f-246e8931d49d",
                              "credential":"stale-secret"})");

    SignalingConfig config;
    config.url = server.url();
    config.displayName = "Studio Mac";
    config.identityPath = identity.path();

    auto client = makeSignalingClient(config);
    REQUIRE(client != nullptr);

    std::string registeredId;
    SignalingCallbacks callbacks;
    callbacks.onRegistered = [&](const std::string& deviceId) { registeredId = deviceId; };

    // connect() blocks until the handshake settles, so the server's half runs
    // on this thread while the client's runs on its own.
    std::thread serverSide([&] {
        const std::string first = server.awaitMessage(1);
        REQUIRE(contains(first, "\"type\":\"authenticate\""));
        REQUIRE(contains(first, "stale-secret"));

        server.send(R"({"type":"error","code":"invalidCredential",)"
                    R"("message":"Unknown device or bad credential"})");

        const std::string second = server.awaitMessage(2);
        REQUIRE(contains(second, "\"type\":\"register\""));
        REQUIRE(contains(second, "\"deviceType\":\"desktop\""));
        REQUIRE(contains(second, "Studio Mac"));

        server.send(R"({"type":"registered","deviceId":"11111111-2222-3333-4444-555555555555",)"
                    R"("credential":"fresh-secret","deviceType":"desktop"})");
    });

    const Status status = client->connect(std::move(callbacks));
    serverSide.join();

    CHECK(status.ok());
    CHECK(registeredId == "11111111-2222-3333-4444-555555555555");

    // The new credential has to reach disk, or the next run repeats all this.
    const std::string stored = identity.contents();
    CHECK(contains(stored, "fresh-secret"));
    CHECK_FALSE(contains(stored, "stale-secret"));

    client->close();
}

// The retry is deliberately one-shot. A server that refuses the credential it
// has just issued is broken, and a client that keeps registering would hammer
// it while reporting nothing.
TEST_CASE("a second refusal is reported rather than retried", "[signaling]") {
    FakeServer server;
    TempIdentity identity(R"({"deviceId":"ca363bdc-b11d-4cc9-b57f-246e8931d49d",
                              "credential":"stale-secret"})");

    SignalingConfig config;
    config.url = server.url();
    config.identityPath = identity.path();

    auto client = makeSignalingClient(config);
    REQUIRE(client != nullptr);

    std::thread serverSide([&] {
        server.awaitMessage(1);
        server.send(R"({"type":"error","code":"invalidCredential","message":"Unknown device"})");
        server.awaitMessage(2);
        server.send(R"({"type":"error","code":"invalidCredential","message":"Unknown device"})");
    });

    const Status status = client->connect({});
    serverSide.join();

    CHECK(status.failed());
    CHECK(contains(status.message(), "invalidCredential"));
    // Exactly two: authenticate, then the single re-registration.
    CHECK(server.messageCount() == 2);

    client->close();
}
