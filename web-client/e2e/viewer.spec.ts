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
const DESKTOP_ID = 'desktop-e2e'
const SESSION_ID = 'session-e2e'

declare global {
  interface Window {
    __pc: RTCPeerConnection
    __pending: RTCIceCandidateInit[]
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
        for (const track of stream.getTracks()) pc.addTrack(track, stream)

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
            deviceId: 'phone-e2e',
            credential: 'secret',
            deviceType: 'phone',
          })
          break

        case 'authenticate':
          reply({ type: 'authenticated', deviceId: 'phone-e2e', deviceType: 'phone' })
          break

        case 'pairCodeSubmit':
          if (message.code === PAIR_CODE) {
            reply({
              type: 'pairedConfirmed',
              pairingId: 'pairing-e2e',
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

test('pairs, answers the offer and plays the desktop stream', async ({ page, context }) => {
  const desktop = await createDesktopPeer(await context.newPage())
  await stubSignalling(page, desktop)

  await page.goto('/pair/code')
  await page.keyboard.type(PAIR_CODE, { delay: 50 })

  // pairedConfirmed names the desktop this phone may now reach.
  await expect(page).toHaveURL(new RegExp(`/session/${DESKTOP_ID}$`))

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

test('refuses a wrong pairing code instead of navigating', async ({ page, context }) => {
  const desktop = await createDesktopPeer(await context.newPage())
  await stubSignalling(page, desktop)

  await page.goto('/pair/code')
  await page.keyboard.type('000000', { delay: 50 })

  await expect(page.getByText('That code did not work')).toBeVisible()
  await expect(page).toHaveURL(/\/pair\/code$/)
})
