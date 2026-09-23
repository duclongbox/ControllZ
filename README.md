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

##  Mac commands

```bash
# web-client — pick ONE, they are mutually exclusive:
#
#   npm run dev          direct LAN access (http://<your-lan-ip>:5173). Add
#                        HTTPS=1 for a secure context, which service workers
#                        and the PWA install prompt both require.
#   npm run dev:tunnel   access through the tunnel URL only. This pins the HMR
#                        socket to wss://<host>:443, so loading the LAN address
#                        under it fails with ERR_CONNECTION_REFUSED and an
#                        uncaught "WebSocket closed without opened".
cd web-client && npm install && npm run dev:tunnel

# signaling-server — http://localhost:8080, health at /actuator/health
cd signaling-server ./mvnw spring-boot:run

# the tunnel — ngrok rather than cloudflared. Cloudflare Tunnel needs outbound
# port 7844, which guest and public Wi-Fi routinely block; the symptom is a
# Cloudflare "Error 1033" page while the local dev server is perfectly healthy.
# ngrok runs over 443, so it survives those networks.
brew install --cask ngrok
ngrok config add-authtoken <token>   # one-time, from dashboard.ngrok.com
npm run tunnel                       # = ngrok http 5173

# First visit on the phone shows ngrok's ERR_NGROK_6024 warning page instead of
# the app — tap "Visit Site" once; a cookie then suppresses it for 7 days. Use
# the tunnel URL on every network, including your own Wi-Fi: it is the one
# address that works everywhere, so nothing needs reconfiguring per network.

# ngrok's free tier allows 20k requests/month, and the dev server spends
# hundreds of them per phone reload (one request per module). For a long phone
# session, tunnel a production build instead — a handful of requests:
npm run build && npm run preview     
npm run tunnel:preview               

# restart validated devices:
rm ~/.remotehost/desktop-identity.json

# desktop-host
cd desktop-host && cmake --preset debug && cmake --build --preset debug
./build/debug/desktop-host --serve --name "Studio Mac"
```

## PowerShell commands (Windows 10 1903+ / 11)
```bash
# 1. One-time setup (open a new PowerShell window afterwards)
winget install Git.Git Kitware.CMake
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
git clone https://github.com/microsoft/vcpkg C:\vcpkg
C:\vcpkg\bootstrap-vcpkg.bat
setx VCPKG_ROOT C:\vcpkg

# 2. Build and test
git clone https://github.com/duclongbox/ControllZ.git
cd ControllZ\desktop-host
git checkout feat/windows-host
cmake --preset windows-release
cmake --build --preset windows-release
ctest --preset windows-release

# 3. Run, one step at a time
$exe = ".\build\windows-release\RelWithDebInfo\desktop-host.exe"
& $exe --test-pattern --seconds 5 --record test.h264   # encoder only
& $exe --seconds 5 --record screen.h264                # real screen capture
& $exe --serve --signaling ws://<signaling-host-ip>:8080/ws   # stream to the phone
# Allow it through the Windows Firewall when prompted. --display 2 picks the second monitor.
```

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
