# shared/ — message schema source of truth

Every message that crosses a process boundary is defined here once, and both
sides generate their types from it. A schema change that lands on only one side
is a bug (CLAUDE.md).

## Conventions

- **camelCase** field names — native to both TypeScript and Java/Jackson, so
  neither side needs remapping annotations.
- **Envelope**: every message is `{ "type": "<messageType>", ... }`. The `type`
  field is the discriminator and is the only field every message shares.
- **Ids** are canonical UUID strings; **timestamps** are ISO-8601 UTC strings
  (`2026-01-01T00:05:00Z`), never epoch numbers.
- One JSON Schema file per message in `schemas/`, plus `schemas/catalog.json`
  listing every message type, its direction, and what it requires of the
  connection.
- Optional fields are typed `["string", "null"]` rather than merely omitted from
  `required`: the server serializes records field-by-field and emits an explicit
  `null` for an absent value, so `{"displayName": null}` is on the wire in
  practice and a client-side type that forbids it will reject valid traffic.

## Message catalog

Mirrors the sealed `SignalingMessage` hierarchy in
`signaling-server/src/main/java/com/remotehost/signaling/message/`. The
`error` codes are `ErrorCode` in the same package.

**Client → server**

| Type | Fields | Requires |
|---|---|---|
| `register` | `deviceType, displayName?` | unauthenticated connection |
| `authenticate` | `deviceId, credential` | unauthenticated connection |
| `pairCodeRequest` | — | authenticated desktop |
| `pairCodeSubmit` | `code` | authenticated phone |
| `connectRequest` | `targetDeviceId` | authenticated phone |
| `endSession` | `sessionId` | a participant in that session |
| `heartbeat` | — | authenticated device |

**Server → client**

| Type | Fields | Notes |
|---|---|---|
| `registered` | `deviceId, credential, deviceType` | the only time `credential` is ever sent |
| `authenticated` | `deviceId, deviceType` | |
| `pairCodeIssued` | `code, expiresAt` | six digits, 5-minute TTL, single use |
| `pairedConfirmed` | `pairingId, peerDeviceId, peerDisplayName` | sent to both sides |
| `connectRejected` | `reason` | `notPaired` \| `desktopOffline` \| `alreadyInSession` |
| `sessionStarted` | `sessionId, peerDeviceId, role` | sent to the desktop first — it is the offerer |
| `peerDisconnected` | `sessionId` | |
| `heartbeatAck` | `serverTime` | |
| `error` | `code, message` | protocol faults only; branch on `code` |

**Relayed verbatim between peers** — the server never parses these
(CLAUDE.md invariant): `sdpOffer` and `sdpAnswer` (`sessionId, sdp`),
`iceCandidate` (`sessionId, candidate, sdpMid?, sdpMLineIndex?`).
`echo` (`payload?`) travels both ways and is a connectivity probe only.

### Two kinds of refusal

`error` is a protocol fault — unparseable, unsupported, unauthenticated.
`connectRejected` is a well-formed request that is legitimately refused. They
are separate messages so a client can treat "you have a bug" and "that desktop
is offline" differently.

### What the error codes deliberately do not tell you

`notPaired` covers unknown device, never-paired device and revoked pairing
alike, and `invalidCredential` covers unknown device and wrong secret alike.
That is not laziness — distinguishing them would turn either message into an
oracle for enumerating which deviceIds exist (system-design.md §2.5). Clients
must not try to infer the difference.

## REST API

`signaling-server` also exposes a small REST surface for things that do not
belong in a socket conversation (enrollment from tooling, listing pairings,
revoking one). It shares this catalog's `{code, message}` error shape but adds
two codes not in `errorCode.schema.json`, since they are HTTP-level and never
appear in a WebSocket `error`: `notFound` and `internalError`.

## Codegen flow — **not wired up yet**

The intended flow, per system-design.md §2.6:

| Consumer | Tool | Output |
|---|---|---|
| `web-client` | `json-schema-to-typescript` | `web-client/src/generated/messages.ts`, committed; CI regenerates and fails on diff |
| `signaling-server` | `jsonschema2pojo` (Maven plugin) | `target/generated-sources/`, not committed |
| `desktop-host` | hand-written | `include/desktophost/messages.h`, committed; CI validates `samples/` against the schemas so drift still fails the build |

None of it exists today. There is no `shared/package.json`, no `samples/`, no
validator, and no `shared` job in `.github/workflows/ci.yml`;
`web-client`'s `npm run generate` script points at
`shared/scripts/generate-ts.mjs`, which is not in the repo. **Until that is
built, these schemas are documentation that a human keeps in sync by hand** —
the CLAUDE.md rule that a schema change updates every consumer in the same PR is
the only thing enforcing the contract, and nothing will fail the build if you
forget.
