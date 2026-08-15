# Implementation Plan

**Status: PROPOSED — awaiting review before any code is written.**

Companion to /docs/system-design.md and CLAUDE.md. This doc does three
things: (1) states the scale/priority assumptions the plan is built on,
(2) validates the design decisions and open questions in system-design.md
against those assumptions, (3) breaks each milestone into scope,
deliverables, acceptance criteria, and explicitly deferred items.

---

## 1. Assumptions & priorities

- **Scale at launch:** ≤ 5,000 users/month, ~100 sessions/day. That is
  *tiny* by backend standards — roughly 1 signaling exchange every 15
  minutes on average. A single small signaling instance covers this with
  orders of magnitude to spare. Every infra decision below optimizes for
  **$0-when-idle** over scalability.
- **Priority order:** stream smoothness first, infra cost second. Where
  they tension, the resolution is: spend *engineering effort* on smoothness
  (encoder tuning, pacing, adaptive bitrate) rather than *money* on infra.
  Smoothness is almost entirely determined by the desktop-host encode path
  and the ABR loop — not by backend capacity — so this trade-off is cheap.
- **First desktop platform: macOS** (ScreenCaptureKit → VideoToolbox),
  since that's the dev machine. Windows (DXGI Desktop Duplication →
  NVENC/AMF/QSV) is structured for from day one (capture/encode behind an
  interface) but implemented later. **← assumption, confirm.**
- Phone targets: Android Chrome and iOS Safari, as PWA/browser.

---



## 3. Milestone plans

### Milestone 0 — Scaffolding *(current)*

**Goal:** every package exists, builds empty, and CI enforces it.

Deliverables:
- Repo layout per CLAUDE.md: `web-client/`, `signaling-server/`,
  `desktop-host/`, `shared/`, `docs/` (move the two existing docs in).
- `web-client/`: Vite + React + TS scaffold; `npm run lint/test/build`
  (ESLint, Vitest, tsc+vite). Playwright installed for later e2e.
- `signaling-server/`: Spring Boot 4.1 + Java 25 via Spring Initializr
  (websocket + actuator starters only for now); Maven wrapper;
  `./mvnw verify` runs lint (spotless) + tests.
- `desktop-host/`: CMake project (`LANGUAGES CXX OBJCXX` — ScreenCaptureKit
  and VideoToolbox are Objective-C), one `main.cpp` that prints a version;
  ctest with one trivial test; `libdatachannel` v0.24.5 added via
  FetchContent and *linked* — proving the build works is part of
  scaffolding, since it's the riskiest dependency.
- `shared/`: `schemas/` dir + README describing the codegen flow (codegen
  itself lands in M1 with the first schema).
- CI (GitHub Actions): one job per package running its lint/test/build;
  desktop-host builds on macOS runner.

Acceptance: fresh clone → all three packages build and pass CI. No
features. **Deferred:** everything else.

Step-by-step setup commands, target file tree, IntelliJ configuration, and
the done-check for this milestone: /docs/setup.md.

---

### Milestone 1 — Core video pipeline, end to end

**Goal:** real desktop screen, hardware-encoded, rendered in the phone
browser — same network and across networks (STUN only) — via a shared
room-code stub. This de-risks the entire product; if latency/smoothness
can't be hit here, nothing downstream matters.

**shared/** — minimal M1 message set (room-code stub, *not* the §3
catalog yet): `joinRoom {roomCode, role}`, `roomJoined`, `sdpOffer`,
`sdpAnswer`, `iceCandidate`, `peerDisconnected`, `error`. First codegen
wiring (TS + Java) lands here.

**signaling-server/** — dumb WebSocket relay:
- `/ws` endpoint; in-memory room registry (`Map<roomCode, {desktop,
  phone}>`); relays SDP/ICE verbatim between the two occupants; notifies
  on peer disconnect. No database, no auth, no Redis (per §2.4 above).
- Tests: room join/relay/disconnect via Spring's WebSocket test client.

**desktop-host/** — the hard part; structure as four modules behind
interfaces (capture, encode, transport, signaling):
- Capture: **ScreenCaptureKit**, frames stay as `CVPixelBuffer`/IOSurface
  (GPU-resident — invariant).
- Encode: **VideoToolbox** H.264 session fed the IOSurface directly:
  real-time mode, AllowFrameReordering=false, CBR-ish with data-rate
  limit, long GOP, forced-IDR API exposed.
- Transport: libdatachannel peer connection; H.264 RTP packetization
  (`H264RtpPacketizer`, packetization-mode=1), `RtcpReceivingSession` +
  NACK responder, **PLI → forced IDR** (this is what makes recovery from
  loss look like a brief blur instead of a multi-second freeze).
- Signaling client: WebSocket to the server, drives offer creation.
- Config: room code via CLI flag. Tests: unit-test the module seams
  (e.g. encoder produces valid Annex-B/AVCC, packetizer output), not the
  GPU pipeline itself.

**web-client/** — minimal viewer page: enter room code → join → recvonly
transceiver → `<video>` (muted+playsinline for autoplay). Plus a **stats
overlay** from `getStats()` — fps, bitrate, jitter, freeze count — because
"smooth" must be measured, not eyeballed, and M4's ABR will reuse this
plumbing. Playwright e2e against a fake/looped media source.

**Acceptance criteria:**
- Phone renders the live desktop screen at 1080p ≥ 30 fps sustained.
- Same-LAN glass-to-glass latency ≤ ~150 ms (measure: on-screen
  millisecond clock filmed next to the phone).
- Works phone-on-LTE ↔ desktop-on-home-WiFi via STUN (no TURN yet —
  symmetric-NAT failures are *expected* and out of scope until M4).
- Kill/restart either peer → other side surfaces disconnected state.

**Deferred:** input (M2), any auth (M3), TURN + ABR (M4), reconnect
polish (M5), Windows capture backend.

**Risks (watch these, they're the milestone's point):**
1. VideoToolbox → RTP integration (Annex-B vs AVCC parameter-set
   handling) — first thing to spike.
2. Safari answering with H.264 profile the encoder didn't offer —
   test Safari early, not last.
3. Large keyframes bursting the pacer → latency spikes — cap IDR size via
   data-rate limits; verify with the stats overlay.

---

### Milestone 2 — Input channel

**Goal:** touch the phone screen, cursor moves/clicks on the desktop.

- `shared/`: input schema — `pointerMove/Down/Up`, `scroll`, later
  `key`. **Normalized coordinates (0–1)** relative to the video frame, so
  desktop resolution changes don't break mapping. Include a client
  timestamp + monotonic sequence number (receiver drops stale moves —
  required since the channel reorders).
- `web-client/`: capture pointer events on the video element, map to
  normalized coords (account for letterboxing), send on a DataChannel
  opened with `{ordered: false, maxRetransmits: 0}` — the invariant.
  Coalesce moves to one message per animation frame.
- `desktop-host/`: receive on the unordered channel, drop
  out-of-sequence moves, inject via CGEvent (macOS Accessibility
  permission flow documented). Clicks/ups are must-arrive semantics at
  app level: fine over an unreliable channel in practice, but state-sync
  (periodic absolute cursor state) papers over a lost `pointerUp`.
- Acceptance: tap accuracy within a few px at any window size;
  drag feels continuous; input adds no measurable video regression.
- Deferred: keyboard, multi-touch gestures, clipboard.

---

### Milestone 3 — Real pairing & identity

**Goal:** replace room codes with §1's flow. This is the milestone where
the durable store appears.

- Neon Postgres + Spring Data JPA; schema from §4.1 (`devices`,
  `pairings`) via Flyway migrations.
- Full §3 message catalog in `shared/` (with the §2.6 naming decision),
  replacing the M1 stub set: `register`, `connectRequest`,
  `pairCodeSubmit`, `pairedConfirmed`, `connectRejected`, …
- First-time pairing: desktop generates 6-digit single-use code, ~5 min
  expiry (in-memory, not Postgres — it's ephemeral), shown as text + QR;
  phone submits; server creates the pairing record and issues the phone a
  stored credential for silent reconnect (code never reused — §2.5).
- Device credentials: random secret at first run, stored hashed
  server-side (`credential_hash`); desktop keeps it in the OS keychain,
  phone in IndexedDB/localStorage.
- Rejections: uniform `notPaired` for unknown/unpaired/revoked (§2.5);
  `desktopOffline` from the in-memory presence registry.
- Presence: in-memory registry per §2.4, WebSocket ping/pong liveness.
- Acceptance: fresh phone pairs via code once, reconnects silently
  thereafter; unpaired phone gets a clean "not paired" screen; revoking a
  pairing row blocks reconnect. Tests around `verify_pairing` edge cases
  (revoked, unknown, wrong credential).
- Deferred: pairing-management UI (list/revoke from desktop — stub CLI is
  enough), multi-desktop account grouping, rate-limiting polish (do add
  basic per-IP attempt limits on `pairCodeSubmit` — 6-digit codes are
  guessable without it).

---

### Milestone 4 — TURN fallback + adaptive bitrate

**Goal:** sessions succeed on hostile networks and stay smooth on bad
ones. This is the smoothness milestone.

- TURN: pick managed provider (§2.2 shortlist, verify pricing then);
  signaling server issues short-lived HMAC credentials in the session
  setup response; both peers add the TURN server to their ICE config.
  No LAN/WAN forks — ICE keeps choosing (invariant).
- ABR loop (in desktop-host, per §2.7): inputs = RTCP RR loss/jitter/RTT
  + client `getStats()` summary sent ~1/s over the control DataChannel.
  Control = ladder over encoder bitrate first (cheap, no keyframe), then
  resolution/framerate steps (requires IDR). Start simple: additive
  increase, multiplicative decrease on loss; hold-down timers to prevent
  oscillation. Prefer **degrading resolution before framerate** for a
  remote-desktop feel (motion smoothness over text sharpness during
  interaction; revisit after real use).
- Acceptance: session connects with both peers behind symmetric NAT
  (force relay with `iceTransportPolicy: "relay"` in a test build);
  throttled network (Network Link Conditioner) degrades resolution
  gracefully with no multi-second freezes, and recovers upward.
- Deferred: simulcast/SVC, FEC, per-region TURN selection.

---

### Milestone 5 — PWA polish

**Goal:** it feels like an app, and survives real-world interruptions.

- Manifest + service worker (app-shell caching only — never cache
  signaling), install prompt, fullscreen + landscape orientation,
  **Screen Wake Lock** (re-acquire on visibilitychange), reconnection
  state machine: WebSocket drop → auto-resignal → ICE restart, with
  clear connecting/reconnecting/offline UI states.
- Acceptance: phone lock/unlock mid-session recovers automatically;
  WiFi→LTE switch mid-session recovers via ICE restart; installed PWA
  passes Lighthouse installability checks.

---

## 4. Cross-cutting notes

- **Testing per CLAUDE.md:** every milestone lands with the affected
  package's tests updated and run; e2e (Playwright) grows from M1's
  viewer test into the paired-session flow by M3.
- **Schema discipline:** any `shared/` change updates all consumers in
  the same PR (CLAUDE.md invariant) — CI should regenerate types and fail
  on diff.
- **Measurement first:** the M1 stats overlay is a deliverable, not a
  nice-to-have — every later smoothness claim (M2 input latency, M4 ABR)
  is judged with it.

## 5. Decisions needing your confirmation

1. macOS as the first desktop-host platform (§1 assumption).
2. Skip Redis/Upstash entirely until horizontal scaling (§2.4) — this
   contradicts system-design.md §4.2's provider recommendation, deliberately.
3. camelCase + JSON Schema codegen toolchain (§2.6).
4. TURN provider shortlist deferred to M4 start (§2.2).
