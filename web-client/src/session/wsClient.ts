import type { NormalisedPoint } from '../lib/normalise'
import type { RejectReason } from '../protocol/types'
import type { SessionClient } from './client'
import type { ConnectStep, QualityPriority, SessionState, SessionStats } from './types'
import { initialSessionState } from './types'

/* The real session client: one WebSocket to the signalling server, one
 * RTCPeerConnection to the desktop.
 *
 * The desktop is always the offerer (see sessionStarted.role in
 * shared/schemas/), so this side never creates an offer. It asks to connect,
 * waits for the offer, answers it, and renders whatever track arrives.
 *
 * Identity lives in localStorage: the credential from `registered` is a bearer
 * secret, and losing it means re-pairing, so it is written once and reused for
 * every later visit. */

/** Matches the mock's rungs so Connecting renders identically either way. */
const LADDER: ReadonlyArray<Pick<ConnectStep, 'id' | 'label' | 'detail'>> = [
  { id: 'signalling', label: 'Signalling connected', detail: 'WebSocket open' },
  { id: 'paired', label: 'Pairing verified', detail: 'pairedConfirmed' },
  { id: 'offer', label: 'Offer received', detail: 'sdpOffer' },
  { id: 'answer', label: 'Answer sent', detail: 'sdpAnswer' },
  { id: 'ice', label: 'Gathering candidates', detail: 'iceCandidate' },
  { id: 'media', label: 'Media flowing', detail: 'first frame decoded' },
]

const DEVICE_ID_KEY = 'remotehost.deviceId'
const CREDENTIAL_KEY = 'remotehost.credential'
const HANDSHAKE_TIMEOUT_MS = 10_000

export interface WsClientOptions {
  /** Signalling endpoint. Defaults to `/ws` on the page's own origin, which is
   *  what the Vite proxy serves — same origin means the phone needs no second
   *  certificate. */
  url?: string
  displayName?: string
  iceServers?: RTCIceServer[]
}

export interface PairedDevice {
  deviceId: string
  displayName: string
}

/** Adds the pairing half of the protocol, which the session seam has no place for. */
export interface WsSessionClient extends SessionClient {
  /** Redeems a six-digit code from the desktop. Resolves with the paired desktop. */
  pairWithCode(code: string): Promise<PairedDevice>
}

function defaultUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost:8080/ws'
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // Private mode, or storage disabled: treat as a first run.
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Non-fatal: this session works, the next one re-registers.
  }
}

/* Every device id on the wire is a java.util.UUID on the server
 * (SignalingMessage.ConnectRequest). Anything else fails Jackson before the
 * handler ever runs: the server answers `malformedMessage` and the viewer then
 * waits for a `sessionStarted` that can never arrive. Refusing it here turns a
 * silent hang into the rejection it already is. */
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isDeviceId(value: string): boolean {
  return DEVICE_ID_PATTERN.test(value)
}

function steps(activeIndex: number): ConnectStep[] {
  return LADDER.map((step, i) => ({
    ...step,
    state: i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending',
  }))
}

/**
 * Just the field the readout needs. `RTCIceCandidateStats` is not declared in
 * every TypeScript DOM lib, and the stats object is duck-typed anyway.
 */
interface CandidateStats {
  candidateType?: string
}

interface Waiter {
  resolve: (message: Record<string, unknown>) => void
  reject: (error: Error) => void
  match: (message: Record<string, unknown>) => boolean
  timer: ReturnType<typeof setTimeout>
}

export function createWsClient(options: WsClientOptions = {}): WsSessionClient {
  const url = options.url ?? defaultUrl()
  const iceServers = options.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }]

  let state: SessionState = initialSessionState()
  const listeners = new Set<(s: SessionState) => void>()

  let socket: WebSocket | null = null
  let ready: Promise<void> | null = null
  let pc: RTCPeerConnection | null = null
  let sessionId: string | null = null
  // Bumped by every connect() and end(). A connect whose generation is stale by
  // the time the socket is ready must not send its request: React StrictMode
  // mounts the viewer, cleans it up and mounts it again, and two connectRequests
  // means the server opens one session and refuses the other as
  // `alreadyInSession` — leaving the desktop streaming to a rejected viewer.
  let attempt = 0
  let statsTimer: ReturnType<typeof setInterval> | undefined
  let previousStats: { bytes: number; frames: number; decodeMs: number; at: number } | null = null
  let disposed = false

  const waiters = new Set<Waiter>()

  function emit() {
    for (const listener of listeners) listener(state)
  }

  function patch(next: Partial<SessionState>) {
    if (disposed) return
    state = { ...state, ...next }
    emit()
  }

  function send(message: Record<string, unknown>) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  /** Resolves with the first message matching `match`, or rejects on timeout. */
  function expect(
    match: (message: Record<string, unknown>) => boolean,
    timeoutMs = HANDSHAKE_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        match,
        timer: setTimeout(() => {
          waiters.delete(waiter)
          reject(new Error('the signalling server did not answer in time'))
        }, timeoutMs),
      }
      waiters.add(waiter)
    })
  }

  function settleWaiters(message: Record<string, unknown>) {
    for (const waiter of [...waiters]) {
      if (!waiter.match(message)) continue
      clearTimeout(waiter.timer)
      waiters.delete(waiter)
      waiter.resolve(message)
    }
  }

  function failWaiters(error: Error) {
    for (const waiter of [...waiters]) {
      clearTimeout(waiter.timer)
      waiters.delete(waiter)
      waiter.reject(error)
    }
  }

  /** Opens the socket and proves identity, registering on a first run. */
  function ensureConnected(): Promise<void> {
    if (ready) return ready

    ready = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      socket = ws

      const timer = setTimeout(() => reject(new Error(`no answer from ${url}`)), HANDSHAKE_TIMEOUT_MS)

      ws.onopen = () => {
        patch({ steps: steps(1) })
        const deviceId = readStorage(DEVICE_ID_KEY)
        const credential = readStorage(CREDENTIAL_KEY)
        if (deviceId && credential) {
          send({ type: 'authenticate', deviceId, credential })
        } else {
          send({
            type: 'register',
            deviceType: 'phone',
            displayName: options.displayName ?? 'Phone',
          })
        }
      }

      ws.onmessage = (event) => {
        let message: Record<string, unknown>
        try {
          message = JSON.parse(String(event.data))
        } catch {
          return
        }

        if (message.type === 'registered') {
          writeStorage(DEVICE_ID_KEY, String(message.deviceId))
          writeStorage(CREDENTIAL_KEY, String(message.credential))
          clearTimeout(timer)
          resolve()
        } else if (message.type === 'authenticated') {
          clearTimeout(timer)
          resolve()
        } else if (message.type === 'error' && message.code === 'invalidCredential') {
          // The server forgot this device (or it was revoked). Re-register
          // rather than leaving the app permanently unable to connect.
          writeStorage(DEVICE_ID_KEY, '')
          writeStorage(CREDENTIAL_KEY, '')
          clearTimeout(timer)
          reject(new Error('this phone is no longer enrolled — pair again'))
        }

        handleMessage(message)
      }

      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error(`cannot reach the signalling server at ${url}`))
      }

      ws.onclose = () => {
        socket = null
        ready = null
        failWaiters(new Error('signalling connection closed'))
        if (state.phase === 'streaming' || state.phase === 'reconnecting') {
          patch({ phase: 'ended' })
        }
      }
    })

    ready.catch(() => {
      ready = null
    })
    return ready
  }

  function handleMessage(message: Record<string, unknown>) {
    settleWaiters(message)

    switch (message.type) {
      case 'sessionStarted':
        sessionId = String(message.sessionId)
        patch({ phase: 'negotiating', steps: steps(2) })
        void openPeerConnection()
        break

      case 'sdpOffer':
        void acceptOffer(String(message.sdp))
        break

      case 'iceCandidate':
        void pc?.addIceCandidate({
          candidate: String(message.candidate),
          sdpMid: message.sdpMid == null ? undefined : String(message.sdpMid),
          sdpMLineIndex:
            message.sdpMLineIndex == null ? undefined : Number(message.sdpMLineIndex),
        })
        break

      case 'connectRejected':
        patch({ phase: 'rejected', rejectReason: message.reason as RejectReason })
        break

      case 'peerDisconnected':
        teardownPeer()
        patch({ phase: 'ended' })
        break

      default:
        break
    }
  }

  async function openPeerConnection() {
    teardownPeer()
    const connection = new RTCPeerConnection({ iceServers })
    pc = connection

    connection.onicecandidate = (event) => {
      if (!event.candidate || !sessionId) return
      send({
        type: 'iceCandidate',
        sessionId,
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      })
    }

    // The whole point of the exercise: the desktop's video track arrives here.
    connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      patch({ stream, steps: steps(5) })
    }

    connection.onconnectionstatechange = () => {
      switch (connection.connectionState) {
        case 'connected':
          patch({ phase: 'streaming', startedAt: Date.now(), steps: steps(6) })
          startStats()
          break
        case 'failed':
          patch({ phase: 'rejected', rejectReason: 'desktopOffline' })
          break
        case 'disconnected':
          patch({ phase: 'reconnecting' })
          break
        case 'closed':
          stopStats()
          break
        default:
          break
      }
    }
  }

  async function acceptOffer(sdp: string) {
    if (!pc || !sessionId) return
    await pc.setRemoteDescription({ type: 'offer', sdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    patch({ phase: 'gathering', steps: steps(4) })
    send({ type: 'sdpAnswer', sessionId, sdp: answer.sdp })
  }

  function teardownPeer() {
    stopStats()
    previousStats = null
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      pc.close()
      pc = null
    }
  }

  function startStats() {
    if (statsTimer !== undefined) return
    statsTimer = setInterval(() => void sampleStats(), 1000)
  }

  function stopStats() {
    if (statsTimer !== undefined) clearInterval(statsTimer)
    statsTimer = undefined
  }

  /** One getStats() pass, reduced to the readout the overlay renders. */
  async function sampleStats() {
    if (!pc) return
    const report = await pc.getStats()

    let inbound: RTCInboundRtpStreamStats | undefined
    let pair: RTCIceCandidatePairStats | undefined
    const candidates = new Map<string, CandidateStats>()

    report.forEach((entry) => {
      if (entry.type === 'inbound-rtp' && (entry as RTCInboundRtpStreamStats).kind === 'video') {
        inbound = entry as RTCInboundRtpStreamStats
      } else if (entry.type === 'candidate-pair' && (entry as RTCIceCandidatePairStats).nominated) {
        pair = entry as RTCIceCandidatePairStats
      } else if (entry.type === 'local-candidate' || entry.type === 'remote-candidate') {
        candidates.set(entry.id, entry as CandidateStats)
      }
    })
    if (!inbound) return

    const now = Date.now()
    const bytes = inbound.bytesReceived ?? 0
    const frames = inbound.framesDecoded ?? 0
    const decodeMs = (inbound.totalDecodeTime ?? 0) * 1000
    const previous = previousStats
    previousStats = { bytes, frames, decodeMs, at: now }

    const elapsed = previous ? (now - previous.at) / 1000 : 0
    const framesDelta = previous ? frames - previous.frames : 0

    const localType = pair ? candidates.get(pair.localCandidateId ?? '')?.candidateType : undefined
    const remoteType = pair
      ? candidates.get(pair.remoteCandidateId ?? '')?.candidateType
      : undefined
    const relayed = localType === 'relay' || remoteType === 'relay'

    const packets = inbound.packetsReceived ?? 0
    const lost = inbound.packetsLost ?? 0

    const stats: SessionStats = {
      fps: elapsed > 0 ? Number((framesDelta / elapsed).toFixed(1)) : 0,
      bitrateBps: elapsed > 0 && previous ? Math.round(((bytes - previous.bytes) * 8) / elapsed) : 0,
      rttMs: pair?.currentRoundTripTime ? Math.round(pair.currentRoundTripTime * 1000) : 0,
      jitterMs: Number(((inbound.jitter ?? 0) * 1000).toFixed(1)),
      lossFraction: packets + lost > 0 ? lost / (packets + lost) : 0,
      freezeCount: inbound.freezeCount ?? 0,
      width: inbound.frameWidth ?? 0,
      height: inbound.frameHeight ?? 0,
      decodeMs:
        previous && framesDelta > 0
          ? Number(((decodeMs - previous.decodeMs) / framesDelta).toFixed(1))
          : 0,
      candidatePair: `${localType ?? '?'} ⇄ ${remoteType ?? '?'}`,
      keyframes: inbound.keyFramesDecoded ?? 0,
    }

    patch({ stats, transport: relayed ? 'relayed' : 'direct' })
  }

  return {
    getState() {
      return state
    },

    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },

    async pairWithCode(code: string): Promise<PairedDevice> {
      await ensureConnected()
      const confirmed = expect((m) => m.type === 'pairedConfirmed')
      const refused = expect((m) => m.type === 'error')
      send({ type: 'pairCodeSubmit', code })

      const message = await Promise.race([confirmed, refused])
      if (message.type === 'error') {
        throw new Error(String(message.message ?? 'pairing failed'))
      }
      return {
        deviceId: String(message.peerDeviceId),
        displayName: String(message.peerDisplayName ?? 'Desktop'),
      }
    },

    connect(deviceId: string) {
      const generation = ++attempt
      if (!isDeviceId(deviceId)) {
        // A mock fixture id, or a hand-edited /session/:deviceId URL. `notPaired`
        // is the honest reading: an id the server cannot even parse is not one
        // this phone holds a pairing for.
        patch({ ...initialSessionState(), phase: 'rejected', rejectReason: 'notPaired' })
        return
      }
      patch({ ...initialSessionState(), phase: 'authorising', steps: steps(0) })
      void ensureConnected()
        .then(() => {
          if (generation !== attempt) return // superseded while connecting
          patch({ steps: steps(1) })
          send({ type: 'connectRequest', targetDeviceId: deviceId })
        })
        .catch(() => {
          if (generation !== attempt) return
          patch({ phase: 'rejected', rejectReason: 'desktopOffline' })
        })
    },

    end() {
      attempt += 1
      if (sessionId) send({ type: 'endSession', sessionId })
      teardownPeer()
      sessionId = null
      patch({ phase: 'ended', stream: null })
    },

    setQualityPriority(priority: QualityPriority) {
      // M4: there is no message for this yet, so record the intent only.
      patch({ qualityPriority: priority })
    },

    setDisplay(displayId: string) {
      patch({ activeDisplayId: displayId })
    },

    sendPointer(_kind: 'move' | 'down' | 'up', _point: NormalisedPoint) {
      // M2: the input DataChannel does not exist yet.
    },

    sendKey(_kind: 'down' | 'up', _code: string, _modifiers: readonly string[]) {
      // M2, as above.
    },

    restartIce() {
      pc?.restartIce()
    },

    dispose() {
      disposed = true
      failWaiters(new Error('client disposed'))
      teardownPeer()
      socket?.close()
      socket = null
      ready = null
      listeners.clear()
    },
  }
}
