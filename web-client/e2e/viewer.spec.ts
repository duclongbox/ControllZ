import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/* The viewer answering a real WebRTC offer and rendering the track.
 *
 * Both peers are real: a second page plays the desktop, offering Chrome's fake
 * camera (the launch flags in playwright.config.ts), and the app answers it.
 * Only signalling is stubbed — `routeWebSocket` intercepts the socket inside
 * the browser, so this needs no signalling server, no desktop-host and no
 * Screen Recording grant, which is what lets it run in CI.
 *
 * What it is really guarding: for a long time this app rendered a CSS mockup of
 * a desktop, and every screen looked correct while no frame existed anywhere. */

const PAIR_CODE = '123456'
/* Real UUIDs, not readable fixtures. The server types every id as a
 * java.util.UUID, and wsClient refuses a target it can see the server could
 * never parse — so `desktop-e2e` never reached connectRequest at all, and this
 * suite silently stopped exercising the session. */
const DESKTOP_ID = '550db02e-2a9c-4a39-a45e-0ecd1b0418ec'
const PHONE_ID = 'c1f2a3b4-5d6e-4f70-8a91-b2c3d4e5f607'
const SESSION_ID = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a'
const PAIRING_ID = '3b7a1e42-8c05-4d19-9f63-2a0e8d5c7b41'

declare global {
  interface Window {
    __pc: RTCPeerConnection
    __pending: RTCIceCandidateInit[]
    __input: string[]
  }
}

/** The offerer, standing in for desktop-host. */
async function createDesktopPeer(page: Page) {
  // Not about:blank: getUserMedia needs a secure context, and an opaque origin
  // has no navigator.mediaDevices at all. A blank page served on the app's own
  // origin is secure (localhost), and loading no app code keeps this peer from
  // opening a signalling socket of its own.
  await page.route('**/e2e-desktop-peer', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>desktop</title>' }),
  )
  await page.goto('/e2e-desktop-peer')

  return {
    /** Offers video, with gathering already finished so no trickle is needed. */
    async offer(): Promise<string> {
      return page.evaluate(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        const pc = new RTCPeerConnection()
        window.__pc = pc
        window.__input = []
        for (const track of stream.getTracks()) pc.addTrack(track, stream)

        // Exactly what desktop-host does, and in the same order: the channel
        // has to exist before the offer is created, or the SCTP m-line is not
        // in it and the phone has nothing to receive. Unordered with no
        // retransmits is the invariant (CLAUDE.md).
        const input = pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 })
        input.onmessage = (event: MessageEvent) => {
          window.__input.push(String(event.data))
        }

        await pc.setLocalDescription(await pc.createOffer())
        if (pc.iceGatheringState !== 'complete') {
          await new Promise<void>((resolve) => {
            pc.addEventListener('icegatheringstatechange', () => {
              if (pc.iceGatheringState === 'complete') resolve()
            })
          })
        }
        return pc.localDescription?.sdp ?? ''
      })
    },

    async acceptAnswer(sdp: string) {
      await page.evaluate(async (answer) => {
        await window.__pc.setRemoteDescription({ type: 'answer', sdp: answer })
        for (const init of window.__pending ?? []) await window.__pc.addIceCandidate(init)
        window.__pending = []
      }, sdp)
    },

    async addCandidate(candidate: string, sdpMid: string | null) {
      await page.evaluate(
        async (init) => {
          const candidateInit = { candidate: init.candidate, sdpMid: init.sdpMid ?? undefined }
          // The viewer trickles candidates as it gathers them, which is often
          // before its answer has been applied here. addIceCandidate throws in
          // that window, and a dropped candidate can leave ICE with nothing to
          // check against — so hold them until the answer lands.
          if (!window.__pc.remoteDescription) {
            window.__pending = [...(window.__pending ?? []), candidateInit]
            return
          }
          await window.__pc.addIceCandidate(candidateInit)
        },
        { candidate, sdpMid },
      )
    },

    /** Input messages the phone has sent us so far. */
    inputMessages(): Promise<Array<Record<string, unknown>>> {
      return page.evaluate(() =>
        (window.__input ?? []).map((raw) => JSON.parse(raw) as Record<string, unknown>),
      )
    },

    /** "absent" until the offer is built: polling must retry, not throw. */
    connectionState(): Promise<string> {
      return page.evaluate(() => window.__pc?.connectionState ?? 'absent')
    },
  }
}

/** The signalling server, reduced to the exchange the viewer drives. */
async function stubSignalling(page: Page, desktop: Awaited<ReturnType<typeof createDesktopPeer>>) {
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage(async (raw) => {
      const message = JSON.parse(String(raw)) as Record<string, unknown>
      const reply = (payload: Record<string, unknown>) => ws.send(JSON.stringify(payload))

      switch (message.type) {
        case 'register':
          reply({
            type: 'registered',
            deviceId: PHONE_ID,
            credential: 'secret',
            deviceType: 'phone',
          })
          break

        case 'authenticate':
          reply({ type: 'authenticated', deviceId: PHONE_ID, deviceType: 'phone' })
          break

        case 'pairCodeSubmit':
          if (message.code === PAIR_CODE) {
            reply({
              type: 'pairedConfirmed',
              pairingId: PAIRING_ID,
              peerDeviceId: DESKTOP_ID,
              peerDisplayName: 'Studio Mac',
            })
          } else {
            reply({
              type: 'error',
              code: 'invalidPairCode',
              message: 'Pairing code is invalid or expired',
            })
          }
          break

        case 'connectRequest':
          reply({
            type: 'sessionStarted',
            sessionId: SESSION_ID,
            peerDeviceId: DESKTOP_ID,
            role: 'phone',
          })
          // The desktop is the offerer, exactly as sessionStarted.role says.
          reply({ type: 'sdpOffer', sessionId: SESSION_ID, sdp: await desktop.offer() })
          break

        case 'sdpAnswer':
          await desktop.acceptAnswer(String(message.sdp))
          break

        case 'iceCandidate':
          await desktop.addCandidate(
            String(message.candidate),
            message.sdpMid == null ? null : String(message.sdpMid),
          )
          break

        default:
          break
      }
    })
  })
}

/**
 * Pairs, then starts the session.
 *
 * Redeeming a code lands on the success screen rather than jumping straight
 * into the viewer: that screen is what writes the pairing into this phone's
 * device list and lets the computer be named, so the hand-off goes through it.
 */
async function pairAndEnterSession(page: Page) {
  await page.goto('/pair/code')
  await page.keyboard.type(PAIR_CODE, { delay: 50 })
  await expect(page).toHaveURL(/\/pair\/done$/)
  await expect(page.getByText('Paired')).toBeVisible()

  // pairedConfirmed names the desktop this phone may now reach.
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page).toHaveURL(new RegExp(`/session/${DESKTOP_ID}$`))
}

test('pairs, answers the offer and plays the desktop stream', async ({ page, context }) => {
  const desktop = await createDesktopPeer(await context.newPage())
  await stubSignalling(page, desktop)

  await pairAndEnterSession(page)

  // Check the peers actually met first: failing here says "ICE never
  // completed", where a missing <video> alone would not say why.
  await expect.poll(() => desktop.connectionState(), { timeout: 20_000 }).toBe('connected')

  const video = page.locator('video')
  await expect(video).toBeVisible({ timeout: 20_000 })

  // A decoded frame, not merely an attached track.
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0)

  // And it keeps playing: currentTime advancing is the difference between one
  // frame arriving and a live stream.
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0)

  expect(await desktop.connectionState()).toBe('connected')
  await expect(page.getByText('Live')).toBeVisible()
})

/* The other half of the session: input going back the other way, over the
 * channel the desktop opened inside the same negotiation. Nothing here is
 * stubbed but signalling — a real DataChannel over real ICE, which is the only
 * place the m-line ordering and the gesture rules are exercised together. */
test('sends a tap back to the desktop as a click', async ({ page, context }) => {
  const desktop = await createDesktopPeer(await context.newPage())
  await stubSignalling(page, desktop)

  await pairAndEnterSession(page)
  await expect.poll(() => desktop.connectionState(), { timeout: 20_000 }).toBe('connected')

  const video = page.locator('video')
  await expect(video).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0)

  // A tap in the middle of the stage. Trackpad mode is the default, so this is
  // a click at the virtual cursor rather than at the finger — and it is the
  // release, not the press, that decides a stationary press was a tap at all.
  const box = await page.locator('video').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.up()

  await expect.poll(() => desktop.inputMessages(), { timeout: 10_000 }).toHaveLength(2)

  const messages = await desktop.inputMessages()
  expect(messages[0]).toMatchObject({ type: 'pointerDown', button: 'left', clickCount: 1 })
  expect(messages[1]).toMatchObject({ type: 'pointerUp', button: 'left', clickCount: 1 })
  // Normalised, so the desktop resolution never has to cross the wire.
  expect(messages[0].nx as number).toBeGreaterThanOrEqual(0)
  expect(messages[0].nx as number).toBeLessThanOrEqual(1)
  // One monotonic sequence stream over both messages.
  expect(messages[1].seq as number).toBeGreaterThan(messages[0].seq as number)
})

test('refuses a wrong pairing code instead of navigating', async ({ page, context }) => {
  const desktop = await createDesktopPeer(await context.newPage())
  await stubSignalling(page, desktop)

  await page.goto('/pair/code')
  await page.keyboard.type('000000', { delay: 50 })

  await expect(page.getByText('That code did not work')).toBeVisible()
  await expect(page).toHaveURL(/\/pair\/code$/)
})
