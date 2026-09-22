# UI Spec

**Status: DRAFT v0.1** — companion to /docs/system-design.md and
/docs/implementation-plan.md. This doc is the text half of the design; the
visual half is the design canvas and the Figma component library linked
below. Where they disagree, this doc wins, because it is the one CI can
read.

- Design canvas (45 artboards — every screen, flow and handoff board):
  https://claude.ai/code/artifact/379ff0ea-5f71-4d8d-a74a-16e571956613
- Figma component library (tokens, styles, 11 component sets, 30 icons):
  https://www.figma.com/design/KtcM4fKAz4SiO0g409cZCA

---

## 1. Design invariants

These are UI-layer counterparts to the architecture invariants in
CLAUDE.md. Breaking one is a bug, not a style disagreement.

1. **The stage fills; the video contains.** The stage is
   `position:absolute; inset:0` on `--color-bg-stage` (`#000000`), and the
   `<video>` inside it is `object-fit: contain` — never `cover`. Cropping
   would hide a menu bar or a dock, which on a remote desktop is a
   correctness failure, not a cosmetic one.
2. **Chrome never occupies layout.** Both viewer bars are overlays on a
   gradient scrim, auto-hidden after 3 s without touch. Chrome appearing
   or disappearing must never resize, reflow or letterbox the video.
3. **Safe-area insets pad overlays only.** `env(safe-area-inset-*)` is
   applied to the chrome containers. It never touches the stage — a notch
   must not move the video, because the video is not in the flow.
4. **Nothing interactive is below 44×44.** Viewer controls are 52 so a
   bar that only appears sometimes is still hittable at speed.
5. **Colour is reserved for connection state.** One accent
   (`--color-bg-accent`) carries all interaction. Every other hue in the
   palette means live / connecting / degraded / relayed / offline / error
   and nothing else.
6. **Numbers are tabular.** Anything that refreshes on a timer renders in
   JetBrains Mono, so no digit shifts sideways while it is being read.
7. **No spinner without a name.** Every waiting state says what it is
   waiting on and offers the one action that makes sense there. See
   `Connecting` and `DesktopOffline`.
8. **Dark only, for now.** Token *names* are mode-ready; only the values
   are single-mode. (The Figma Starter plan permits one variable mode per
   collection — adding light later means adding values, not renaming.)

---

## 2. Screen index

`M` is the milestone the screen first ships in. Routes are the intended
`web-client` router paths; `host ·` rows are desktop-host windows.

| Screen | Route | M | Sends | Receives / renders |
|---|---|---|---|---|
| `Home` | `/` | M3 | — | resolver, not a screen: device list, else `/welcome` on a phone, `/landing` on a desktop |
| `Welcome` | `/welcome` | M3 | — | first run only, zero pairings |
| `PairScan` | `/pair/scan` | M3 | — | camera decode is unbuilt; the screen says so and points at `/pair/code` |
| `PairCode` | `/pair/code` | M3 | `pairCodeSubmit` | auto-submits on 6th digit |
| `PairVerifying` | `/pair/code` | M3 | — | awaiting `pairedConfirmed` \| `error` |
| `PairError` | `/pair/code` | M3 | `pairCodeSubmit` | `error` · `codeExpired` \| `codeInvalid` \| `rateLimited` |
| `PairSuccess` | `/pair/done` | M3 | — | `pairedConfirmed`; writes the pairing to `store/devices` and names it |
| `Devices` | `/` | M3 | `authenticate` | `authenticated` + presence per device |
| `DevicesEmpty` | `/` | M3 | `authenticate` | `authenticated`, zero pairings |
| `DeviceDetail` | `/device/:id` | M3 | — | local record + live presence |
| `Connecting` | `/session/:id` | M1 | `connectRequest` | `sessionStarted`, `sdpOffer`, `iceCandidate` |
| `Main` (viewer) | `/session/:id` | M1 | `sdpAnswer`, `iceCandidate` | RTP video track; chrome visible |
| `ViewerIdle` | `/session/:id` | M1 | — | chrome auto-hidden after 3 s |
| `ViewerStats` | `/session/:id` | M1 | — | `RTCPeerConnection.getStats()` at 1 Hz |
| `ViewerInputTrackpad` | `/session/:id` | M2 | `pointerMove/Down/Up` | unordered DataChannel, coalesced per rAF — **built** |
| `ViewerKeyboard` | `/session/:id` | M2 | `keyDown`, `keyUp` | physical `code` + modifier state |
| `ViewerMonitors` | `/session/:id` | M2 | `setDisplay` | renegotiates, forces an IDR |
| `ViewerQuality` | `/session/:id` | M4 | `setQualityPriority` | ladder position echoed back |
| `ViewerRelayed` | `/session/:id` | M4 | — | candidate pair type `=== "relay"` |
| `ViewerReconnecting` | `/session/:id` | M5 | `iceRestart` | holds the last decoded frame |
| `SessionEnded` | `/session/:id` | M1 | `endSession` | `peerDisconnected` + session summary — a phase of the viewer, not a URL of its own |
| `ConnectRejected` | `/session/:id` | M3 | `connectRequest` | `connectRejected` · `notPaired` |
| `ConnectRejected` | `/session/:id` | M3 | `connectRequest` | `connectRejected` · `desktopOffline` |
| `ConnectRejected` | `/session/:id` | M3 | `connectRequest` | `connectRejected` · `alreadyInSession` |
| `Settings` | `/settings` | M5 | — | `store/prefs`, plus links to the prose pages |
| `Landing` | `/landing` | — | — | marketing page; lazy-loaded, linked from `Welcome` and `Settings` |
| `Install` | `/install` | — | — | desktop build steps, macOS permissions, add-to-home-screen |
| `Privacy` | `/privacy` | — | — | what is stored locally and what the server sees |
| `Security` | `/security` | — | — | media encryption, pairing, credential, revocation |
| `NotFound` | `*` | — | — | a real 404, not a redirect to `/` |
| `OfflineNoNetwork` | any | M5 | — | `navigator.onLine === false` |
| `InstallPrompt` | any | M5 | — | `beforeinstallprompt` |
| `RotateHint` | `/session/:id` | M5 | — | portrait + session active |
| `HostPermissionsMac` | host · setup | M1 | — | TCC grant state, polled |
| `HostPermissionsWin` | host · setup | M1 | — | no grants required |
| `HostReady` | host · main | M1 | `register`, `heartbeat` | `registered` |
| `HostPairingCode` | host · pair | M3 | `pairCodeRequest` | `pairCodeIssued`, `pairedConfirmed` |
| `HostSessionActive` | host · session | M1 | `sdpOffer`, `iceCandidate` | RTCP receiver reports |
| `HostDevices` | host · phones | M3 | `revokePairing` | pairing list |
| `HostSettings` | host · settings | M1 | — | local config |
| `HostTray` | host · menu bar | M1 | — | live session summary |

**M1 subset** (build only these): `Connecting`, `Main`, `ViewerIdle`,
`ViewerStats`, `SessionEnded`, plus the four host screens tagged M1. The
`JoinRoom` room-code stub that once stood at `/join` is gone — pairing by
code reaches the same place.

Message names above are the literal `type` strings in
`shared/schemas/catalog.json`, except `joinRoom`/`roomJoined` (the M1
stub set, per implementation-plan.md §3 M1) and `setDisplay`,
`setQualityPriority`, `iceRestart`, `revokePairing`, which do **not yet
exist** and must be added to the catalog when their milestone starts.

### 2.1 Artboards are not components

Several artboards are states of one screen. The implementation collapses them:

| Artboards | Component |
|---|---|
| the nine `Viewer*` boards | `screens/Viewer.tsx` + overlay state |
| `PairCode`, `PairVerifying`, `PairError` | `screens/PairCode.tsx` + status |
| `Devices`, `DevicesEmpty` | `screens/Devices.tsx` |
| `NotPaired`, `DesktopOffline`, `alreadyInSession` | `screens/ConnectRejected.tsx` keyed by reason |
| `InstallPrompt`, `RotateHint`, `OfflineNoNetwork` | `app/AppShell.tsx` overlays, not routes |
| `Privacy`, `Security`, `Install`, `NotFound` | `screens/DocPage.tsx` frame + per-page content |

The overlays are conditions, not destinations: losing the network mid-session
must not push a history entry the user then has to press Back through.

---

## 3. Client session state machine

```
idle ──tap device──▶ authorising ──sessionStarted──▶ negotiating ──ICE ok──▶ streaming
                          │
                          ├── connectRejected(notPaired)      ──▶ NotPaired
                          └── connectRejected(desktopOffline)  ──▶ DesktopOffline ──auto──▶ retry watch

streaming ──RTCP loss ↑──▶ degraded ──loss clears──▶ streaming
streaming ──no direct path──▶ relayed (capped)
streaming ──network change / lock──▶ reconnecting ──ok──▶ streaming
                                          └──30 s timeout──▶ ended
```

`degraded`, `relayed` and `reconnecting` are all **inside** the session —
the last decoded frame stays on screen throughout. Only `ended` tears the
stage down.

---

## 4. Letterbox & coordinate mapping (M2)

The video is contain-fit, so the rendered frame rarely fills the
viewport. A touch in the bars is not a touch on the desktop.

```ts
// web-client — pointer event → normalised coordinates
export function toNormalised(ev: PointerEvent, video: HTMLVideoElement) {
  const r = video.getBoundingClientRect();
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;                    // no frame decoded yet

  const scale = Math.min(r.width / vw, r.height / vh);
  const w = vw * scale, h = vh * scale;
  const ox = (r.width - w) / 2;                   // pillarbox
  const oy = (r.height - h) / 2;                  // letterbox

  const nx = (ev.clientX - r.left - ox) / w;
  const ny = (ev.clientY - r.top - oy) / h;

  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;   // dead zone
  return { nx, ny };
}
```

On the wire:

```json
{ "type": "pointerMove", "seq": 40118, "t": 1757030412, "nx": 0.6183, "ny": 0.4402 }
```

On the host, at injection time — against the display's **bounds in the OS's
global coordinate space**, not the captured frame's pixel dimensions:

```cpp
const CGRect b = CGDisplayBounds(displayId);   // points, global origin
const double x = b.origin.x + msg.nx * b.size.width;
const double y = b.origin.y + msg.ny * b.size.height;
```

The distinction is not pedantry. `CGEvent` takes points in a space whose origin
is the top-left of the *main* display, so a second monitor has a non-zero — and
possibly negative — origin. Mapping against the frame's pixels instead puts
every click on the wrong monitor the moment display 2 is the captured one, and
misplaces them on a Retina display even with one screen attached. The bounds are
re-read per event rather than cached, so changing resolution mid-session
re-anchors the next event instead of scaling it against a display that no longer
exists. Implemented in `desktop-host/src/input/pointer_mapping.cpp`.

**Why normalised, not pixels.** The input channel is unordered and
unreliable, so a resolution change and an in-flight coordinate can cross.
Sending `0…1` makes every packet self-contained — there is no shared
mutable state between the two ends to fall out of sync. The phone never
learns the desktop resolution, so the user changing it mid-session costs
nothing.

---

## 5. Components

Each row exists in the Figma file with these exact variant axes, so Code
Connect maps without renaming.

| Figma | React | Variants | Props |
|---|---|---|---|
| `Button` | `<Button/>` | 12 | `variant: 'primary'\|'secondary'\|'ghost'\|'danger'`, `state`, `label`, `hasIcon?`, `icon?` |
| `IconButton` | `<IconButton/>` | 9 | `style: 'ghost'\|'filled'\|'danger'`, `state`, `icon`, `label` (aria-label, required) |
| `StatusPill` | `<StatusPill/>` | 6 | `status: 'live'\|'connecting'\|'degraded'\|'relayed'\|'offline'\|'error'`, `label` |
| `StatChip` | `<StatChip/>` | 4 | `tone: 'neutral'\|'good'\|'warn'\|'bad'`, `caption`, `value` |
| `CodeInput` | `<CodeInput/>` | 4 | `state`, `value`, `onComplete(code)` |
| `Field` | `<Field/>` | 4 | `state`, `value`, `placeholder?`, `onChange` |
| `DeviceRow` | `<DeviceRow/>` | 2 | `presence: 'online'\|'offline'`, `name`, `meta`, `onPress` |
| `Banner` | `<Banner/>` | 4 | `tone: 'info'\|'warn'\|'error'\|'success'`, `title`, `body`, `action?` |
| `Toggle` | `<Toggle/>` | 2 | `on`, `onChange`, `disabled?` |
| `Segment` | `<Segment/>` | 2 | `selected`, `label` — compose 2–3 in a track |
| `ModifierKey` | `<ModifierKey/>` | 2 | `state`, `label`, `code: KeyboardEvent['code']` |
| `Icon/*` | `<Icon name=…/>` | 30 | `name`, `size?: 16\|20\|24`; colour inherits |

Composed in screens rather than as component sets: `VideoStage`,
`ViewerTopBar`, `ViewerBottomBar`, `StatsOverlay`, `SidePanel`,
`CursorPuck`.

---

## 6. Tokens

Every Figma variable carries its `var()` name as code syntax, so Dev Mode
emits the left-hand column of `web-client/src/styles/tokens.css`.

```css
:root {
  /* surface */
  --color-bg-stage: #000000;   /* behind the video, always */
  --color-bg-base: #0B0C0E;
  --color-bg-surface: #141619;
  --color-bg-raised: #1C1F24;
  --color-bg-inset: #262A31;
  --color-bg-accent: #4C7DFF;
  --color-bg-danger: #F5484A;

  /* text */
  --color-text-primary: #F2F4F7;
  --color-text-secondary: #9AA2AD;
  --color-text-tertiary: #737B87;
  --color-text-disabled: #4E555F;
  --color-text-on-accent: #FFFFFF;

  /* border */
  --color-border-subtle: #262A31;
  --color-border-default: #363B44;
  --color-border-strong: #4E555F;

  /* connection status — the only semantic colour */
  --color-status-live: #2FCC8B;
  --color-status-connecting: #4C7DFF;
  --color-status-degraded: #F5A524;
  --color-status-relayed: #B285F5;
  --color-status-offline: #4E555F;
  --color-status-error: #F5484A;

  /* spacing */
  --space-2xs: 2px;  --space-xs: 4px;   --space-sm: 8px;
  --space-md: 12px;  --space-base: 16px; --space-lg: 24px;
  --space-xl: 32px;  --space-2xl: 48px;  --space-3xl: 64px;

  /* radius */
  --radius-sm: 6px;  --radius-md: 10px; --radius-lg: 14px;
  --radius-xl: 20px; --radius-full: 999px;

  /* size */
  --size-touch-min: 44px;  --size-control-md: 44px;
  --size-control-lg: 52px; --size-icon-md: 20px; --size-icon-lg: 24px;

  /* type */
  --type-size-2xs: 11px; --type-size-xs: 12px;  --type-size-sm: 13px;
  --type-size-base: 15px; --type-size-md: 17px; --type-size-lg: 20px;
  --type-size-xl: 26px;  --type-size-2xl: 34px; --type-size-3xl: 44px;
}
```

Type: **Inter** for interface (400/500/600), **JetBrains Mono** for stats,
codes and device IDs. Text styles in Figma are named by role
(`Display/L`, `Body/M`, `Label/S`, `Mono/Stat`, `Mono/Code`, …) so the
family is a one-line change if it is ever revisited.

---

## 7. Local state

Everything the phone remembers, and the only places a screen may write it.
None of it is sent anywhere: `store/` is this device's own memory.

| Key | Owner | What |
|---|---|---|
| `remotehost.deviceId` | `session/wsClient.ts` | this phone's id, from `registered` |
| `remotehost.credential` | `session/wsClient.ts` | bearer secret for reconnecting |
| `remotehost.devices` | `store/devices.ts` | paired computers and the names given to them |
| `remotehost.prefs` | `store/prefs.ts` | wake lock, stats overlay, haptics, chrome delay, pointer mode |
| `remotehost.installDismissed` | `app/AppShell.tsx` | the install sheet was answered once |

Two rules hold for all of them. Every read is wrapped — private mode throws
rather than returning null — and a malformed value falls back per field, so
hand-edited storage degrades to defaults instead of a blank screen. And
`presence` is never stored: whether a desktop is awake is the server's
answer, and a remembered "online" would be a lie by the next launch.

The PWA shell — `public/manifest.webmanifest`, `public/sw.js` and the icons
generated by `scripts/gen-icons.mjs` — exists for the same screens: the
service worker is network-first, and is there so `beforeinstallprompt` can
fire at all and so an offline launch reaches `OfflineNoNetwork` rather than
the browser's own error page.

---

## 8. Open questions

1. `setDisplay`, `setQualityPriority`, `iceRestart` and `revokePairing`
   are designed but absent from `shared/schemas/catalog.json`. Add them in
   the milestone that first needs them (M2, M4, M5, M3 respectively).
   `web-client/src/protocol/types.ts` hand-mirrors the vocabulary that *does*
   exist; it is deleted when codegen lands. The pointer messages are **not**
   among these: they are data-plane, live in `shared/schemas/input/`, and are
   mirrored by `web-client/src/protocol/input.ts` — the signaling server never
   sees one.
2. Multi-monitor is designed as a one-at-a-time switcher (`ViewerMonitors`,
   `HostSettings`), matching the recommendation in implementation-plan.md
   §2.9. Confirm before M2 builds the coordinate mapping against it.
3. `PairError` shows a per-device attempt counter ("2 attempts left").
   The server-side rate-limit shape on `pairCodeSubmit` is not yet
   specified — the copy assumes attempts-then-cooldown, not a sliding
   window.
4. Light mode is unbuilt. It needs a paid Figma plan for a second
   variable mode; the token names already accommodate it.
