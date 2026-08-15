# Project: [App Name] — Phone-to-Desktop Remote Control

## What this is
A P2P-first remote desktop control app. The phone (PWA/browser) receives a
WebRTC video stream of the desktop screen and sends touch input back over a
WebRTC DataChannel. The backend only brokers session setup (pairing,
discovery, SDP/ICE exchange) — video and input never touch our servers once
a session is established.

Full system design: see /docs/system-design.md.

## Repo layout & stack
- `web-client/`       — PWA phone client. **React + TypeScript**, Vite.
                         Receives the video track, renders it, captures
                         touch input.
- `signaling-server/` — **Java + Spring Boot**. WebSocket signaling,
                         pairing/identity, presence tracking.
- `desktop-host/`     — native capture/encode/WebRTC host app. **C++**.
                         Prefer `libdatachannel` over full `libwebrtc` for
                         the transport layer — we only need DTLS-SRTP media
                         + data channels and feed it already hardware-encoded
                         frames, so the much lighter build/dependency
                         footprint is worth it over Google's `libwebrtc`.
- `shared/`           — message schemas (JSON Schema or similar) that both
                         signaling-server and web-client generate types from.
                         Source of truth for the message catalog.
- `docs/`             — architecture and design docs.

## Milestone roadmap (build in this order)
0. **Scaffolding** (current milestone) — repo structure per the layout above,
   CI (lint/test/build per package), an empty-but-building skeleton for
   web-client, signaling-server, desktop-host, and shared. No features.
1. **Core video pipeline, end to end** — desktop captures the real screen,
   hardware-encodes it (GPU-resident), sends over WebRTC via libdatachannel,
   phone browser renders it. Signaling uses a bare shared room code — no
   real auth yet. This validates the hardest technical risk (capture →
   encode → packetize → decode latency and smoothness) before anything
   else is built.
2. **Input channel** — phone touch → unordered/unreliable DataChannel →
   desktop input injection, with coordinate mapping between the rendered
   video and the real screen.
3. **Real pairing/identity** — replace the room-code stub with the full
   pairing flow from the system design doc: device registration, first-time
   pairing codes, pairing records in Postgres, reconnect without codes.
4. **TURN fallback + adaptive bitrate** — managed TURN provider with
   short-lived credentials, plus the quality-control loop (bitrate/
   resolution ladder driven by RTCP feedback) that keeps the stream smooth
   on bad networks.
5. **PWA polish** — wake lock, fullscreen, install flow, reconnection
   handling.

Per-milestone scope, acceptance criteria, and deferred items:
see /docs/implementation-plan.md.
Local toolchain, repo structure, and per-package setup: /docs/setup.md.

Don't jump ahead of the current milestone without discussing it first — each
one is scoped deliberately to keep sessions reviewable.

## Conventions
- Trunk-based development: `main` is always deployable. PRs are squash-merged.
- Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`).
- Every package exposes equivalent lint, test, and build steps
  (`npm run lint/test/build` for web-client, Maven equivalents for
  signaling-server, CMake/ctest for desktop-host) — CI assumes these exist.

## Architecture invariants — do not break these
- The backend NEVER touches decoded/raw video or input bytes. Only encrypted
  WebRTC handshake metadata (SDP/ICE) and small control-plane messages pass
  through signaling-server.
- **Do not build separate "LAN mode" and "WAN mode" code paths.** Every
  session negotiates through the same signaling flow regardless of network.
  WebRTC ICE automatically prefers local host candidates over STUN/TURN when
  both peers are on the same network — that's what gives us the automatic
  same-network/different-network switch, for free, at the ICE layer. Only
  build a second path if a specific, measured problem shows up.
- Screen capture stays GPU-resident end to end in desktop-host — no CPU
  readback (glReadPixels-equivalent) anywhere in the capture → encode path.
- Input events travel over an *unordered, unreliable* DataChannel — never
  the default ordered/reliable channel, and never multiplexed with video.
- See /docs/system-design.md for the full message catalog and the reasoning
  behind each of these.

## When making changes
- If you change a message shape in `shared/`, update every consumer
  (`signaling-server/`, `web-client/`, and `desktop-host/` if applicable) in
  the same PR — a schema change that only lands on one side is a bug.
- Before implementing a milestone, write a short plan (what files change,
  what's explicitly deferred) and wait for it to be reviewed before coding.
- Write or update tests for any behavior you change before considering a
  task done. Run the affected package's tests yourself before handing back
  a "done" task.
- Don't add a new runtime dependency to `desktop-host/` without checking it
  supports the GPU-resident capture path (no library that forces a CPU copy).

## Useful commands
- `npm run dev` (in `web-client/`)       — local dev server
- `npm run test:e2e` (in `web-client/`)  — Playwright end-to-end tests
- `./mvnw spring-boot:run` (in `signaling-server/`) — run signaling server locally
- `cmake --build build` (in `desktop-host/`) — build the desktop host
