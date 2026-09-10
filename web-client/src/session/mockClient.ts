import type { NormalisedPoint } from '../lib/normalise'
import type { RejectReason } from '../protocol/types'
import type { SessionClient } from './client'
import type {
  ConnectStep,
  Device,
  QualityPriority,
  SessionState,
  SessionStats,
  Transport,
} from './types'
import { initialSessionState } from './types'
import { findDevice } from '../mock/devices'

/* A timer-driven stand-in for the real signalling + WebRTC client.
 *
 * It exists so the whole UI can be built, clicked through and tested before the
 * host app or the signalling server are ready. It fakes only what a user can
 * observe: the connecting ladder advancing, stats ticking at 1 Hz, quality
 * stepping down and recovering, a relayed connection, ICE restart.
 *
 * It fakes nothing about the protocol — no SDP, no candidates, no messages.
 * That is on purpose: anything invented here would be a second, wrong source of
 * truth alongside shared/schemas/. */

/** The rungs, in order. Labels are what the user reads; details name the wire event. */
const LADDER: ReadonlyArray<Pick<ConnectStep, 'id' | 'label' | 'detail'>> = [
  { id: 'signalling', label: 'Signalling connected', detail: 'WebSocket open' },
  { id: 'paired', label: 'Pairing verified', detail: 'pairedConfirmed' },
  { id: 'offer', label: 'Offer sent', detail: 'sdpOffer' },
  { id: 'answer', label: 'Answer received', detail: 'sdpAnswer' },
  { id: 'ice', label: 'Gathering candidates', detail: 'iceCandidate' },
  { id: 'media', label: 'Media flowing', detail: 'first frame decoded' },
]

const NOMINAL: SessionStats = {
  fps: 58.4,
  bitrateBps: 11_800_000,
  rttMs: 38,
  jitterMs: 4.1,
  lossFraction: 0.0002,
  freezeCount: 0,
  width: 1920,
  height: 1080,
  decodeMs: 2.7,
  candidatePair: 'host ⇄ host',
  keyframes: 3,
}

const DEGRADED: SessionStats = {
  fps: 58.1,
  bitrateBps: 4_300_000,
  rttMs: 96,
  jitterMs: 14.6,
  lossFraction: 0.021,
  freezeCount: 1,
  width: 1280,
  height: 720,
  decodeMs: 2.1,
  candidatePair: 'srflx ⇄ srflx',
  keyframes: 7,
}

const RELAYED: SessionStats = {
  ...DEGRADED,
  bitrateBps: 5_100_000,
  rttMs: 164,
  candidatePair: 'relay ⇄ srflx',
}

function steps(activeIndex: number): ConnectStep[] {
  return LADDER.map((step, i) => ({
    ...step,
    state: i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending',
  }))
}

/** Small deterministic-ish wobble so the readout looks live without thrashing. */
function jitter(base: number, amount: number): number {
  return base + (Math.random() - 0.5) * amount
}

function sampleStats(transport: Transport, degraded: boolean): SessionStats {
  const base = transport === 'relayed' ? RELAYED : degraded ? DEGRADED : NOMINAL
  return {
    ...base,
    fps: Number(jitter(base.fps, 1.6).toFixed(1)),
    bitrateBps: Math.round(jitter(base.bitrateBps, base.bitrateBps * 0.08)),
    rttMs: Math.round(jitter(base.rttMs, 6)),
    jitterMs: Number(Math.max(0.1, jitter(base.jitterMs, 1.4)).toFixed(1)),
    decodeMs: Number(Math.max(0.4, jitter(base.decodeMs, 0.6)).toFixed(1)),
  }
}

export interface MockClientOptions {
  /** Walk the connecting ladder on `connect()`. Off for the dev gallery. */
  autoAdvance?: boolean
  /** ms between ladder rungs. */
  stepMs?: number
  /** Force a refusal instead of connecting. */
  rejectWith?: RejectReason | null
  /** Seed the state — the dev gallery uses this to render a given moment. */
  initial?: Partial<SessionState>
  /** Emit a stats sample every second while streaming. */
  emitStats?: boolean
  /**
   * Ignore `connect()` and `end()` so a seeded state stays put. The dev gallery
   * uses this to render one specific moment of the session.
   */
  frozen?: boolean
}

export function createMockClient(options: MockClientOptions = {}): SessionClient {
  const {
    autoAdvance = true,
    stepMs = 520,
    rejectWith = null,
    initial,
    emitStats = true,
    frozen = false,
  } = options

  let state: SessionState = { ...initialSessionState(), ...initial }
  const listeners = new Set<(s: SessionState) => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let statsTimer: ReturnType<typeof setInterval> | undefined
  let disposed = false

  function emit() {
    for (const listener of listeners) listener(state)
  }

  function patch(next: Partial<SessionState>) {
    if (disposed) return
    state = { ...state, ...next }
    emit()
  }

  function later(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      timers.delete(id)
      if (!disposed) fn()
    }, ms)
    timers.add(id)
  }

  function clearTimers() {
    for (const id of timers) clearTimeout(id)
    timers.clear()
  }

  function startStats() {
    if (!emitStats || statsTimer !== undefined) return
    const tick = () =>
      patch({ stats: sampleStats(state.transport, state.quality === 'degraded') })
    tick()
    statsTimer = setInterval(tick, 1000)
  }

  function stopStats() {
    if (statsTimer !== undefined) clearInterval(statsTimer)
    statsTimer = undefined
  }

  function goLive() {
    patch({
      phase: 'streaming',
      steps: LADDER.map((s) => ({ ...s, state: 'done' })),
      startedAt: Date.now(),
    })
    startStats()
  }

  function walkLadder(index: number) {
    if (index >= LADDER.length) {
      goLive()
      return
    }
    // Phase tracks which rung is lit, so Connecting can label the wait honestly.
    const phase = index <= 1 ? 'authorising' : index <= 3 ? 'negotiating' : 'gathering'
    patch({ phase, steps: steps(index) })
    later(() => walkLadder(index + 1), stepMs)
  }

  // A client seeded straight into a live phase (the dev gallery) still needs a
  // stats feed — otherwise the overlay and the RTT readout render empty.
  if (state.phase === 'streaming') startStats()

  return {
    getState() {
      return state
    },

    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },

    connect(deviceId) {
      if (frozen) return
      clearTimers()
      stopStats()
      const device: Device | null = findDevice(deviceId)

      if (rejectWith) {
        patch({ phase: 'authorising', steps: steps(0), device })
        later(() => patch({ phase: 'rejected', rejectReason: rejectWith }), stepMs)
        return
      }

      // An offline device is refused, and the refusal names why. Tapping an
      // offline row still navigates — see docs/ui-spec.md §1.7.
      if (device && device.presence === 'offline') {
        patch({ phase: 'authorising', steps: steps(0), device })
        later(() => patch({ phase: 'rejected', rejectReason: 'desktopOffline' }), stepMs)
        return
      }

      patch({
        ...initialSessionState(),
        device,
        transport: device?.transport ?? 'direct',
        activeDisplayId: device?.displays[0]?.id ?? null,
        phase: 'authorising',
        steps: steps(0),
      })

      if (autoAdvance) later(() => walkLadder(1), stepMs)
    },

    end() {
      if (frozen) return
      clearTimers()
      stopStats()
      patch({ phase: 'ended' })
    },

    setQualityPriority(priority: QualityPriority) {
      patch({ qualityPriority: priority })
    },

    setDisplay(displayId: string) {
      // Switching renegotiates and forces an IDR, so the real client will drop a
      // frame here. Nothing to fake beyond the selection itself.
      patch({ activeDisplayId: displayId })
    },

    sendPointer(_kind: 'move' | 'down' | 'up', _point: NormalisedPoint) {
      // M2. Nothing to send at M0 — the desktop host does not exist yet.
    },

    sendKey(_kind: 'down' | 'up', _code: string, _modifiers: readonly string[]) {
      // M2, as above.
    },

    restartIce() {
      if (state.phase !== 'streaming') return
      clearTimers()
      stopStats()
      // The stage keeps the last decoded frame throughout — that is the point.
      patch({ phase: 'reconnecting' })
      later(() => {
        patch({ phase: 'streaming', quality: 'nominal' })
        startStats()
      }, 2200)
    },

    dispose() {
      disposed = true
      clearTimers()
      stopStats()
      listeners.clear()
    },
  }
}
