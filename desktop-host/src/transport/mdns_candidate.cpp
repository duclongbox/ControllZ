#include "desktophost/transport/mdns_candidate.h"

#if defined(_WIN32)
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <netdb.h>
#include <sys/socket.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#endif

#include <algorithm>
#include <cctype>
#include <cstring>
#include <string>
#include <vector>

namespace desktophost {
namespace {

/// Field 5 of an ICE candidate line, counting from one:
///   candidate:<foundation> <component> <transport> <priority> <address> ...
/// See RFC 5245 §15.1.
constexpr std::size_t kAddressField = 4;

bool endsWithLocal(const std::string& host) {
    static constexpr char kSuffix[] = ".local";
    constexpr std::size_t kLength = sizeof(kSuffix) - 1;
    if (host.size() <= kLength) {
        return false;
    }
    const std::string tail = host.substr(host.size() - kLength);
    return std::equal(tail.begin(), tail.end(), kSuffix, [](char a, char b) {
        return std::tolower(static_cast<unsigned char>(a)) == b;
    });
}

std::vector<std::string> splitOnSpaces(const std::string& line) {
    std::vector<std::string> fields;
    std::size_t start = 0;
    while (start <= line.size()) {
        const std::size_t space = line.find(' ', start);
        const std::size_t end = space == std::string::npos ? line.size() : space;
        fields.push_back(line.substr(start, end - start));
        if (space == std::string::npos) {
            break;
        }
        start = space + 1;
    }
    return fields;
}

std::string join(const std::vector<std::string>& fields) {
    std::string out;
    for (std::size_t i = 0; i < fields.size(); ++i) {
        if (i != 0) {
            out += ' ';
        }
        out += fields[i];
    }
    return out;
}

}  // namespace

std::string resolveHostAddress(const std::string& host) {
#if defined(_WIN32)
    // getaddrinfo fails with WSANOTINITIALISED until something has started
    // Winsock. libdatachannel does, but only once a peer connection exists, and
    // this must not depend on call order. Reference-counted, never undone.
    static const bool winsockReady = [] {
        WSADATA data{};
        return WSAStartup(MAKEWORD(2, 2), &data) == 0;
    }();
    if (!winsockReady) {
        return {};
    }
#endif
    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_DGRAM;

    addrinfo* results = nullptr;
    if (getaddrinfo(host.c_str(), nullptr, &hints, &results) != 0 || results == nullptr) {
        return {};
    }

    char text[INET6_ADDRSTRLEN] = {};
    std::string address;
    for (const addrinfo* it = results; it != nullptr; it = it->ai_next) {
        // IPv4 wins when both are offered. The peer's other candidates are the
        // reflexive ones STUN handed back over IPv4, and ICE only pairs
        // candidates of the same family — a v6 address here would gather a
        // candidate with nothing on the far side to match it.
        if (it->ai_family == AF_INET) {
            const auto* v4 = reinterpret_cast<const sockaddr_in*>(it->ai_addr);
            // Loopback is never the peer. Resolving a name the machine also
            // answers for returns 127.0.0.1 ahead of the real address, and a
            // candidate pointing there sends the phone's video to ourselves.
            if (ntohl(v4->sin_addr.s_addr) >> 24 == 127) {
                continue;
            }
            if (inet_ntop(AF_INET, &v4->sin_addr, text, sizeof(text)) != nullptr) {
                address = text;
                break;
            }
        } else if (it->ai_family == AF_INET6 && address.empty()) {
            const auto* v6 = reinterpret_cast<const sockaddr_in6*>(it->ai_addr);
            if (IN6_IS_ADDR_LOOPBACK(&v6->sin6_addr) || IN6_IS_ADDR_LINKLOCAL(&v6->sin6_addr)) {
                continue;
            }
            if (inet_ntop(AF_INET6, &v6->sin6_addr, text, sizeof(text)) != nullptr) {
                address = text;
            }
        }
    }

    freeaddrinfo(results);
    return address;
}

std::optional<std::string> resolveMdnsCandidate(const std::string& candidate,
                                                const HostResolver& resolve) {
    std::vector<std::string> fields = splitOnSpaces(candidate);
    if (fields.size() <= kAddressField) {
        // Too short to be a candidate this code understands. Handing it on
        // unchanged leaves the verdict to ICE, which owns the grammar.
        return candidate;
    }
    if (!endsWithLocal(fields[kAddressField])) {
        return candidate;
    }
    if (!resolve) {
        return std::nullopt;
    }

    const std::string address = resolve(fields[kAddressField]);
    if (address.empty()) {
        return std::nullopt;
    }

    fields[kAddressField] = address;
    return join(fields);
}

}  // namespace desktophost
