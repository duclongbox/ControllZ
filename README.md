# RemoteHost

Phone-to-desktop remote control. The phone (PWA in the browser) receives a
WebRTC video stream of the desktop screen and sends touch input back over a
WebRTC DataChannel. The backend only brokers session setup — video and input
never touch our servers once a session is established.

- Architecture and message catalog: [`docs/system-design.md`](docs/system-design.md)
- Milestone scope and acceptance criteria: [`docs/implementation-plan.md`](docs/implementation-plan.md)
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


## Target repository structure

End state of Milestone 0. Files marked `←` are the ones you actually
hand-write; everything else comes from a generator.

```
RemoteHost/
├── CLAUDE.md                      ← moved from Docs/ (§1.1)
├── README.md                      ← what this is, how to run each package
├── .gitignore                     ←
├── .gitattributes                 ←
├── .editorconfig                  ← shared indent/EOL rules across 3 languages
├── .github/
│   └── workflows/ci.yml           ← one job per package (§7)
│
├── docs/
│   ├── system-design.md
│   ├── implementation-plan.md
│   └── setup.md                   ← this file
│
├── shared/                        # message-schema source of truth
│   ├── README.md                  ← documents the codegen flow
│   └── schemas/                   # empty in M0; first schema lands in M1
│       └── .gitkeep
│
├── web-client/                    # PWA phone client — React + TS + Vite
│   ├── package.json               # scripts: dev lint test test:e2e build
│   ├── vite.config.ts             # + basic-ssl and host:true for phone testing (§6.1)
│   ├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
│   ├── eslint.config.js
│   ├── playwright.config.ts
│   ├── index.html
│   ├── public/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx                # M0: renders a version string, nothing more
│   │   └── vite-env.d.ts
│   ├── tests/                     # Vitest unit tests
│   └── e2e/                       # Playwright specs
│
├── signaling-server/              # Java 25 + Spring Boot 4.1
│   ├── pom.xml                    # + spotless (lint) bound to verify
│   ├── mvnw / mvnw.cmd / .mvn/
│   └── src/
│       ├── main/java/com/remotehost/signaling/
│       │   └── SignalingServerApplication.java
│       ├── main/resources/application.yaml
│       └── test/java/com/remotehost/signaling/
│           └── SignalingServerApplicationTests.java
│
└── desktop-host/                  # C++20 / Objective-C++ native host
    ├── CMakeLists.txt             ←
    ├── CMakePresets.json          ← IDEA/CLion picks these up automatically
    ├── cmake/Dependencies.cmake   ← FetchContent: libdatachannel, Catch2
    ├── include/desktophost/       # public headers for the 4 module seams
    ├── src/
    │   └── main.cpp               # M0: prints version, exits
    └── tests/
        └── smoke_test.cpp
```
