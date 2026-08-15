# RemoteHost

Phone-to-desktop remote control. The phone (PWA in the browser) receives a
WebRTC video stream of the desktop screen and sends touch input back over a
WebRTC DataChannel. The backend only brokers session setup — video and input
never touch our servers once a session is established.

- Architecture and message catalog: [`docs/system-design.md`](docs/system-design.md)
- Milestone scope and acceptance criteria: [`docs/implementation-plan.md`](docs/implementation-plan.md)
- Toolchain and per-package setup: [`docs/setup.md`](docs/setup.md)
- Architecture invariants (read before changing anything): [`CLAUDE.md`](CLAUDE.md)

## Packages

| Path | Stack | What it is |
|---|---|---|
| `web-client/` | React + TypeScript, Vite | PWA phone client — renders the video, captures touch input |
| `signaling-server/` | Java 25 + Spring Boot 4.1 | WebSocket signaling, pairing/identity, presence |
| `desktop-host/` | C++20 / Objective-C++, libdatachannel | Screen capture, hardware encode, WebRTC host |
| `shared/` | JSON Schema | Message-schema source of truth; both sides generate types from it |

## Prerequisites

macOS on Apple Silicon (first desktop-host platform), plus:

```bash
brew install cmake ninja pkg-config openssl@3
```

Node ≥ 22.12, JDK 25, and full Xcode (for the ScreenCaptureKit and
VideoToolbox SDKs).

## Running each package

```bash
# web-client — dev server, reachable from the phone over LAN
cd web-client && npm install && npm run dev

# signaling-server — http://localhost:8080, health at /actuator/health
cd signaling-server && ./mvnw spring-boot:run

# desktop-host
cd desktop-host && cmake --preset debug && cmake --build --preset debug
./build/debug/desktop-host --help
```

## Lint, test, build

Every package exposes the same three steps; CI runs exactly these.

| Package | Command |
|---|---|
| `web-client` | `npm run lint && npm run test && npm run build` |
| `signaling-server` | `./mvnw verify` (Spotless check + tests) |
| `desktop-host` | `cmake --build --preset debug && ctest --preset debug` |
| `shared` | `npm run validate` (samples against schemas) |

End-to-end browser tests: `cd web-client && npm run test:e2e`.
