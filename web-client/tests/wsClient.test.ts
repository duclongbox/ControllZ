import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWsClient } from '../src/session/wsClient'

/* The seam these tests hold: the phone never offers, it answers. Everything
 * here is the message order the Java handler actually enforces — register or
 * authenticate first, connectRequest only when paired, sdpAnswer only after an
 * offer arrives. */

type Json = Record<string, unknown>

/* Real UUIDs, because the server types every id as a java.util.UUID: a fixture
 * like 'desktop-1' fails Jackson before the handler runs, so a test using one
 * would be asserting on a message the server never accepts. */
const DESKTOP_ID = '550db02e-2a9c-4a39-a45e-0ecd1b0418ec'
const PHONE_ID = 'c1f2a3b4-5d6e-4f70-8a91-b2c3d4e5f607'
const SESSION_ID = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a'
const PAIRING_ID = '3b7a1e42-8c05-4d19-9f63-2a0e8d5c7b41'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly OPEN = 1

  readyState = 0
  sent: Json[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  url: string

  // A parameter property would be erased syntax, which tsconfig.app.json bans.
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as Json)
  }

  close() {
    this.readyState = 3
    this.onclose?.()
  }

  // -- test controls --
  accept() {
    this.readyState = 1
    this.onopen?.()
  }

  deliver(message: Json) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  get types(): string[] {
    return this.sent.map((message) => String(message.type))
  }
}

class FakePeerConnection {
  static current: FakePeerConnection | null = null

  connectionState: RTCPeerConnectionState = 'new'
  remote: { type: string; sdp: string } | null = null
  local: { type: string; sdp?: string } | null = null
  closed = false

  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null
  ontrack: ((event: { streams: MediaStream[]; track: MediaStreamTrack }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor() {
    FakePeerConnection.current = this
  }

  async setRemoteDescription(description: { type: string; sdp: string }) {
    this.remote = description
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'v=0 answer' }
  }

  async setLocalDescription(description: { type: string; sdp?: string }) {
    this.local = description
  }

  async addIceCandidate() {}

  async getStats() {
    return new Map()
  }

  close() {
    this.closed = true
  }

  restartIce() {}

  // -- test controls --
  emitTrack(stream: MediaStream) {
    this.ontrack?.({ streams: [stream], track: {} as MediaStreamTrack })
  }

  transitionTo(next: RTCPeerConnectionState) {
    this.connectionState = next
    this.onconnectionstatechange?.()
  }
}

function install() {
  FakeWebSocket.instances = []
  FakePeerConnection.current = null
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
  localStorage.clear()
}

const socket = () => FakeWebSocket.instances[0]

describe('wsClient identity', () => {
  beforeEach(install)

  it('registers as a phone on a first run and keeps the credential', async () => {
    const client = createWsClient({ url: 'ws://test/ws' })
    const pairing = client.pairWithCode('418902')

    socket().accept()
    expect(socket().sent[0]).toMatchObject({ type: 'register', deviceType: 'phone' })

    socket().deliver({ type: 'registered', deviceId: PHONE_ID, credential: 'secret' })
    await vi.waitFor(() => expect(socket().types).toContain('pairCodeSubmit'))
    expect(socket().sent[1]).toMatchObject({ type: 'pairCodeSubmit', code: '418902' })

    socket().deliver({
      type: 'pairedConfirmed',
      pairingId: PAIRING_ID,
      peerDeviceId: DESKTOP_ID,
      peerDisplayName: 'Studio Mac',
    })

    await expect(pairing).resolves.toEqual({ deviceId: DESKTOP_ID, displayName: 'Studio Mac' })
    // The credential is the only proof of identity; losing it means re-pairing.
    expect(localStorage.getItem('remotehost.deviceId')).toBe(PHONE_ID)
    expect(localStorage.getItem('remotehost.credential')).toBe('secret')
    client.dispose()
  })

  it('authenticates with the stored identity instead of registering again', async () => {
    localStorage.setItem('remotehost.deviceId', PHONE_ID)
    localStorage.setItem('remotehost.credential', 'secret')

    const client = createWsClient({ url: 'ws://test/ws' })
    client.connect(DESKTOP_ID)
    socket().accept()

    expect(socket().sent[0]).toMatchObject({
      type: 'authenticate',
      deviceId: PHONE_ID,
      credential: 'secret',
    })
    client.dispose()
  })

  it('surfaces a refused pairing code instead of hanging', async () => {
    const client = createWsClient({ url: 'ws://test/ws' })
    const pairing = client.pairWithCode('000000')

    socket().accept()
    socket().deliver({ type: 'registered', deviceId: PHONE_ID, credential: 'secret' })
    await vi.waitFor(() => expect(socket().types).toContain('pairCodeSubmit'))

    socket().deliver({ type: 'error', code: 'invalidPairCode', message: 'Pairing code is invalid' })
    await expect(pairing).rejects.toThrow(/invalid/i)
    client.dispose()
  })
})

describe('wsClient session', () => {
  beforeEach(install)

  async function connected() {
    const client = createWsClient({ url: 'ws://test/ws' })
    localStorage.setItem('remotehost.deviceId', PHONE_ID)
    localStorage.setItem('remotehost.credential', 'secret')

    client.connect(DESKTOP_ID)
    socket().accept()
    socket().deliver({ type: 'authenticated', deviceId: PHONE_ID })
    await vi.waitFor(() => expect(socket().types).toContain('connectRequest'))
    return client
  }

  it('refuses a device id the server could never parse', async () => {
    // The bug this guards: a mock fixture id ('dev_studio_mac') reached
    // connectRequest, the server failed to deserialise it as a UUID and replied
    // `malformedMessage`, and the viewer sat on "Connecting" forever waiting for
    // a sessionStarted that was never coming.
    const client = createWsClient({ url: 'ws://test/ws' })
    localStorage.setItem('remotehost.deviceId', PHONE_ID)
    localStorage.setItem('remotehost.credential', 'secret')

    client.connect('dev_studio_mac')

    expect(client.getState().phase).toBe('rejected')
    expect(client.getState().rejectReason).toBe('notPaired')
    // Nothing reached the wire — not even the socket that would carry it.
    expect(FakeWebSocket.instances).toHaveLength(0)
    client.dispose()
  })

  it('asks the server to connect to the chosen desktop', async () => {
    const client = await connected()
    expect(socket().sent.at(-1)).toMatchObject({
      type: 'connectRequest',
      targetDeviceId: DESKTOP_ID,
    })
    client.dispose()
  })

  it('opens one session when the viewer effect runs twice', async () => {
    // React StrictMode mounts, cleans up and mounts again in development. Two
    // connectRequests make the server refuse the second as `alreadyInSession`,
    // which strands the viewer on a rejection screen while the desktop streams.
    const client = createWsClient({ url: 'ws://test/ws' })
    localStorage.setItem('remotehost.deviceId', PHONE_ID)
    localStorage.setItem('remotehost.credential', 'secret')

    client.connect(DESKTOP_ID)
    client.end()
    client.connect(DESKTOP_ID)

    socket().accept()
    socket().deliver({ type: 'authenticated', deviceId: PHONE_ID })
    await vi.waitFor(() => expect(socket().types).toContain('connectRequest'))

    expect(socket().types.filter((type) => type === 'connectRequest')).toHaveLength(1)
    client.dispose()
  })

  it('answers the desktop offer and renders the track it receives', async () => {
    const client = await connected()

    socket().deliver({ type: 'sessionStarted', sessionId: SESSION_ID, peerDeviceId: DESKTOP_ID })
    await vi.waitFor(() => expect(FakePeerConnection.current).not.toBeNull())

    socket().deliver({ type: 'sdpOffer', sessionId: SESSION_ID, sdp: 'v=0 offer' })
    await vi.waitFor(() => expect(socket().types).toContain('sdpAnswer'))

    const peer = FakePeerConnection.current!
    expect(peer.remote).toMatchObject({ type: 'offer', sdp: 'v=0 offer' })
    expect(socket().sent.at(-1)).toMatchObject({ type: 'sdpAnswer', sessionId: SESSION_ID })

    // The point of the whole exercise: a track arrives and reaches the state
    // the viewer renders from.
    const stream = { id: 'remote' } as unknown as MediaStream
    peer.emitTrack(stream)
    expect(client.getState().stream).toBe(stream)

    peer.transitionTo('connected')
    expect(client.getState().phase).toBe('streaming')
    expect(client.getState().startedAt).not.toBeNull()
    client.dispose()
  })

  it('trickles its own candidates back with the session id', async () => {
    const client = await connected()
    socket().deliver({ type: 'sessionStarted', sessionId: SESSION_ID, peerDeviceId: DESKTOP_ID })
    await vi.waitFor(() => expect(FakePeerConnection.current).not.toBeNull())

    FakePeerConnection.current!.onicecandidate?.({
      candidate: {
        candidate: 'candidate:1 1 udp 2122260223 192.168.2.24 50000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      } as RTCIceCandidate,
    })

    expect(socket().sent.at(-1)).toMatchObject({
      type: 'iceCandidate',
      sessionId: SESSION_ID,
      sdpMid: '0',
    })
    client.dispose()
  })
})
