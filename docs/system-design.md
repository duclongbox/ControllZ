# System Design — Signaling, Pairing & Data Layer

**Status: DRAFT v0.2** — based on the author's own whiteboard diagrams (pairing
flow + WebRTC signaling flow). Sections marked `[OPEN QUESTION]` are not yet
decided and need to be resolved and documented before/while implementing.
Sections marked `[RECOMMENDATION]` are proposals with reasoning attached —
validate them against real constraints, don't just accept them.

Related: /docs/system-design.md (overall system design), CLAUDE.md
(architecture invariants — read that first).

---

## 1. Pairing & Authentication Flow

Formalized from the "Pairing Flow" diagram.

1. **Desktop** starts up and sends `register` to the Signaling Server with a
   device identifier and credential: `{deviceId: "ABC123", deviceType: "desktop", credential}`.
2. **Signaling Server** authenticates the desktop against the durable store
   (see §4.1) and marks it present (see §4.2).
3. **Phone (browser)** sends `connect_request` to the Signaling Server:
   `{targetDeviceId: "ABC123"}`.
4. **Signaling Server** runs `verify_pairing(phoneDeviceId, targetDeviceId)`
   against the durable store:
   - If a valid, non-revoked pairing record exists → proceed to §2 (signaling).
   - **[was missing in the original diagram]** If no pairing record exists,
     or it's revoked → reply `connect_rejected {reason: "not_paired"}` and
     stop. The phone should surface a clear "not paired with this desktop"
     state, not a generic connection failure.
5. On successful verification, Signaling Server sends `paired_confirmed` to
   both devices and the WebRTC signaling flow (§2) begins.

### 1.1 First-time pairing (not yet in the diagram — needs to exist before step 1 above is possible)
A phone can only send `connect_request` for a desktop it's already paired
with. First-time pairing needs its own short flow:
1. Desktop generates a short-lived, single-use pairing code (e.g. 6 digits,
   ~5 min expiry) and displays it (or a QR code encoding it).
2. Phone submits the code to the Signaling Server.
3. Signaling Server validates the code, creates a **pairing record** in the
   durable store linking phoneDeviceId ↔ desktopDeviceId, and confirms both
   sides.

`[OPEN QUESTION]` Should the desktop's permanent identifier ("ABC123") ever
be shown/typed directly for reconnection, or should every reconnection after
the first pairing skip codes entirely and authenticate using the stored
pairing credential automatically? Recommendation: the latter — treat the
6-digit code as first-pairing-only, never a permanent public handle, to
avoid making desktops enumerable/guessable.

---

## 2. WebRTC Signaling Flow

Formalized from the "WebRTC Signalling" diagram (both halves — SDP exchange
and ICE/STUN/TURN — are one continuous flow, shown split for clarity in the
original).

### 2.1 SDP exchange
1. Desktop creates an SDP **offer** (media type, codec list, security
   fingerprint — this "Security Credential" is the DTLS fingerprint +
   ICE ufrag/pwd, generated automatically by the WebRTC stack, not something
   the app manages manually) and sends it to the Signaling Server.
2. Signaling Server forwards the offer to the Phone.
3. Phone creates an SDP **answer** (which of the offered codecs/media it
   accepts) and sends it back through the Signaling Server to the Desktop.
4. Desktop receives the answer and locks in the matching media
   configuration.

`[RECOMMENDATION]` Codec priority: **H.264 first**, VP9 as a fallback.
H.264 has the most consistent hardware decode support across iOS Safari and
Android Chrome, which matters more here than VP9's better compression,
since a decode failure on Safari would break the app outright for a
meaningful share of users. Validate current Safari WebRTC codec support
before finalizing — this is worth a fresh check rather than trusting
either of our training data, since browser codec support shifts over time.

### 2.2 ICE / NAT traversal
1. Both Desktop and Phone independently query the **STUN server** to learn
   their public-facing (server-reflexive) IP.
2. Both sides send their gathered ICE candidates (host IP, public IP, and a
   TURN relay address as fallback) to the Signaling Server, which forwards
   them to the other peer.
3. Once each side knows the other's candidates, they attempt direct
   connectivity checks ("talking directly") — trying host candidates first,
   then server-reflexive, then relay, per standard ICE priority. This is
   also what gives automatic same-network vs. different-network handling
   (see CLAUDE.md invariant) — no separate app-level logic needed.
4. If direct connectivity fails, both sides fall back to relaying media
   through the TURN server address exchanged in step 2.

`[OPEN QUESTION]` TURN provider not yet chosen. Options to evaluate: a
managed pay-per-GB provider (e.g. Twilio Network Traversal, Cloudflare
Calls, Metered) vs. self-hosted coturn on a cheap VPS. Recommendation:
start managed — TURN bandwidth is metered/elastic cost, and self-hosting
means provisioning for a peak load you can't yet estimate.

---

## 3. Signaling Server — Message Contract

WebSocket messages, one connection per device per session.

**Client → Server**
| Message | Fields | Notes |
|---|---|---|
| `register` | `deviceId, deviceType, credential` | Desktop on startup |
| `connect_request` | `targetDeviceId` | Phone initiating a session |
| `pair_code_submit` | `code` | First-time pairing only |
| `sdp_offer` | `sessionId, sdp` | |
| `sdp_answer` | `sessionId, sdp` | |
| `ice_candidate` | `sessionId, candidate` | |
| `heartbeat` | — | Refreshes presence TTL, see §4.2 |

**Server → Client**
| Message | Fields | Notes |
|---|---|---|
| `paired_confirmed` | `sessionId` | |
| `connect_rejected` | `reason` | e.g. `not_paired`, `desktop_offline` |
| `sdp_offer` / `sdp_answer` / `ice_candidate` | (relayed as-is) | |
| `peer_disconnected` | `sessionId` | |

`[OPEN QUESTION]`Exact JSON field naming/casing convention (camelCase vs.
snake_case) — pick one and generate shared types for web-client and
signaling-server from a single schema in `shared/` (per CLAUDE.md) so this
never silently drifts between Java and TypeScript.

---

## 4. Data Storage

Two different storage needs with very different access patterns — treating
them as one database would be a mistake either way (durability guarantees
are wasted on ephemeral data; ephemeral-store performance is wasted trying
to be a system of record).

### 4.1 Durable store — pairing & device identity → **PostgreSQL**

Low write volume (a pairing happens once per device relationship, not per
session), needs real durability and relational integrity. Plain managed
Postgres is the boring, correct choice here.

```
devices
  id              uuid pk
  device_type     enum('desktop','phone')
  credential_hash text
  display_name    text
  created_at      timestamptz

pairings
  id                 uuid pk
  desktop_device_id  uuid fk -> devices.id
  phone_device_id    uuid fk -> devices.id
  created_at         timestamptz
  revoked_at         timestamptz nullable
```

`[RECOMMENDATION]` Use a serverless Postgres provider (e.g. Neon) rather
than a fixed-size managed instance or self-hosted VPS, for this stage.
Neon's free tier (as of mid-2026) covers 100 compute-hours/month and 0.5 GB
storage per project with scale-to-zero when idle — this workload's write
volume is low enough that it will likely stay in or near the free tier
until you have real traction, and you pay for actual usage rather than a
fixed monthly box regardless of traffic. Spring Data JPA works against it
like any standard Postgres instance — no code changes needed if you later
migrate to a bigger provider.


### 4.2 Ephemeral store — presence & in-flight session state → **Redis**
NO need Redis to store the presence/session state at this scale (single instance).
Once Websocket open connections are tracked in memory, the ephemeral state is already present in the process. 
Redis +  Pub/Sub only becomes necessary when horizontal scaling is needed (multiple signaling instances).
### 4.3 Cost summary at this stage

| Store | Provider | Expected cost pre-traction | Why |
|---|---|---|---|
| Postgres (durable) | Neon | $0 (within free tier) | Scale-to-zero, low write volume |
| Redis (ephemeral) | Upstash | $0 (within free tier) | Pay-per-command, no idle cost |
| TURN relay | TBD managed provider | Usage-based, scales with concurrent relayed sessions | The one line item that grows with real usage — see §2.2 |

Both free-tier figures were checked against current provider pricing pages
as of mid-2026 — reverify before committing, since usage-based pricing
terms shift more often than fixed pricing does.

---



## 2. Design validation (against above constraints)

Verdict on each recommendation / open question, with trade-offs.

### 2.1 Codec: H.264-first, VP9 fallback (§2.1) — **agree**
H.264 is the only codec with near-universal *hardware* decode on iOS
Safari and Android Chrome, and hardware *encode* everywhere on desktop
(VideoToolbox/NVENC/QSV/AMF). VP9's compression advantage doesn't help a
screen-share stream that must be encoded in <5 ms per frame on the GPU.
Constraints to lock in at implementation time:

- Offer **H.264 Constrained Baseline, packetization-mode=1** — the profile
  Safari reliably answers with hardware decode.
- Encoder settings for smoothness: real-time mode, **no B-frames** (frame
  reordering adds a frame of latency each), CBR-ish rate control with a
  hard data-rate cap, long GOP + **IDR on demand** (answer RTCP PLI with a
  keyframe instead of sending periodic keyframes that cause bitrate spikes).
- Re-verify Safari's current WebRTC codec matrix when M1 starts (per the
  doc's own note) — a 10-minute check, not a design risk.

### 2.2 TURN: managed provider (§2.2) — **agree; defer choice to M4**
At ~100 sessions/day with a typical 10–20 % relay rate, TURN traffic is a
few sessions/day — single-digit dollars/month at any managed provider's
per-GB rate. Self-hosting coturn (~$5/mo VPS + ops burden + you provision
for peaks) is strictly worse at this scale. Shortlist when M4 starts:
Cloudflare (cheapest per-GB last checked) vs. Metered vs. Twilio — verify
current pricing then; it shifts. Issue **short-lived HMAC credentials**
from the signaling server (standard coturn/`turn REST API` scheme, all
managed providers support it) — never ship static TURN credentials to the
browser.

### 2.3 Durable store: serverless Postgres / Neon (§4.1) — **agree**
Boring and correct. Pairing writes happen once per device relationship;
this stays in the free tier indefinitely at your scale. Scale-to-zero cold
starts (~hundreds of ms) only affect the *first* signaling exchange after
idle, never the media path. Spring Data JPA, standard schema from §4.1.



### 2.5 Desktop ID exposure (§1.1) — **agree with the doc's recommendation**
The 6-digit code is **first-pairing-only**, never a permanent handle.
Reconnection authenticates with the stored per-device credential
automatically. Desktops must not be enumerable: `connect_request` for an
unknown/unpaired device returns the same `not_paired` rejection as a
revoked pairing (don't leak which deviceIds exist).

### 2.6 Message naming + shared schema (§3) — **decide now: camelCase, JSON Schema in `shared/`**
- **camelCase** field names — native to both TypeScript and Java/Jackson,
  so neither side needs remapping annotations.
- Envelope: `{ "type": "sdpOffer", ... }` — one JSON Schema per message in
  `shared/schemas/`, plus a catalog file listing all message types.
- Codegen: `json-schema-to-typescript` for web-client,
  `jsonschema2pojo` (Maven plugin) for signaling-server; desktop-host
  hand-writes its (small) subset against the same schemas and CI validates
  sample payloads against them.

### 2.7 libdatachannel over libwebrtc (CLAUDE.md) — **agree, with one flagged cost**
The build-footprint win is real. The cost nobody should discover late:
**libdatachannel has no built-in congestion control / bandwidth estimation**
(no GCC/TWCC send-side estimator like libwebrtc). Since we feed it
already-encoded frames, the M4 adaptive-bitrate loop is **ours to build**:
read RTCP Receiver Reports (loss/jitter) via libdatachannel, add
client-side `getStats()` feedback over the control DataChannel, drive the
encoder's bitrate/resolution ladder from that. This is accepted —
smoothness depends more on encoder tuning than on a fancy estimator, and
a screen stream has one sender and one receiver, the simplest possible
congestion scenario. But M1 must already wire up the RTCP plumbing
(`RtcpReceivingSession`, NACK responder, PLI → IDR) so M4 has feedback to
consume.

### 2.8 Signaling server hosting (not in the doc — needed for M1)
Needs a persistent process (WebSockets), so FaaS/serverless functions are
out. At this traffic: one small always-on container/VM — Fly.io/Railway/
Render hobby tier or a ~$5 VPS all work;  Budget ceiling for the whole backend pre-traction:
**~$5–10/month** (signaling host + $0 Neon + $0 Redis-we-don't-have +
near-$0 TURN until M4).

---