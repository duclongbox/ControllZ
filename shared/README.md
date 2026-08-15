# shared/ — message schema source of truth

Every message that crosses a process boundary is defined here once, and both
sides generate their types from it. A schema change that lands on only one side
is a bug (CLAUDE.md), so CI regenerates and fails on any diff.

## Conventions

- **camelCase** field names — native to both TypeScript and Java/Jackson, so
  neither side needs remapping annotations.
- **Envelope**: every message is `{ "type": "<messageType>", ... }`. The `type`
  field is the discriminator.
- One JSON Schema file per message in `schemas/`, plus `catalog.json` listing
  every message type in use.
- One example payload per message in `samples/`, which CI validates against the
  schemas. This is how `desktop-host` drift gets caught (see below).

## Codegen flow

| Consumer | Tool | Output | Committed? |
|---|---|---|---|
| `web-client` | `json-schema-to-typescript` | `web-client/src/generated/messages.ts` | **yes** — CI regenerates and fails on diff |
| `signaling-server` | `jsonschema2pojo` (Maven plugin) | `target/generated-sources/` | no — Maven regenerates every build, so a diff check would be meaningless |
| `desktop-host` | hand-written | `include/desktophost/messages.h` | yes — the C++ subset is small; CI validates `samples/` against the schemas so hand-written drift still fails the build |

```bash
cd shared && npm install
npm run validate     # samples/ against schemas/
npm run generate     # regenerate web-client types
```

## Message sets by milestone

**M1 (current)** — room-code stub, deliberately *not* the full catalog from
`docs/system-design.md` §3. Room codes are replaced by real pairing in M3.

| Type | Direction | Purpose |
|---|---|---|
| `joinRoom` | client → server | `{roomCode, role}` — claim the desktop or phone slot |
| `roomJoined` | server → client | `{roomCode, role, peerPresent}` — join accepted |
| `peerJoined` | server → client | the other role arrived; the desktop starts its offer here |
| `sdpOffer` | both, relayed | `{sdp}` |
| `sdpAnswer` | both, relayed | `{sdp}` |
| `iceCandidate` | both, relayed | `{candidate, sdpMid, sdpMLineIndex}` |
| `peerDisconnected` | server → client | the other peer's socket closed |
| `error` | server → client | `{code, message}` |

`peerJoined` and `roomJoined.peerPresent` are additions to the message list in
`docs/implementation-plan.md` §3/M1: the desktop is the offerer, so it needs to
know when the phone arrives, and `peerPresent` covers the race where the desktop
is the one that joins second.

**M3** replaces this set with the full §3 catalog (`register`, `connectRequest`,
`pairCodeSubmit`, `pairedConfirmed`, `connectRejected`, …).
