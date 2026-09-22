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

class FakeDataChannel {
  label: string
  readyState: RTCDataChannelState = 'open'
  sent: string[] = []
  onclose: (() => void) | null = null

  constructor(label: string) {
    this.label = label
  }

  send(data: string) {
    if (this.readyState !== 'open') throw new Error('channel is closed')
    this.sent.push(data)
  }

  close() {
    this.readyState = 'closed'
    this.onclose?.()
  }

  get messages(): Array<Record<string, unknown>> {
    return this.sent.map((data) => JSON.parse(data) as Record<string, unknown>)
  }
}

class FakePeerConnection {
  static current: FakePeerConnection | null = null

  connectionState: RTCPeerConnectionState = 'new'
  remote: { type: string; sdp: string } | null = null
  local: { type: string; sdp?: string } | null = null
  closed = false

  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null
  onicecandidateerror: ((event: RTCPeerConnectionIceErrorEvent) => void) | null = null
  ontrack: ((event: { streams: MediaStream[]; track: MediaStreamTrack }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ondatachannel: ((event: { channel: RTCDataChannel }) => void) | null = null

  /// Kept so a test can assert which ICE servers the client chose.
  config: RTCConfiguration | undefined

  /// Remote candidates this connection actually accepted, in order.
  candidates: RTCIceCandidateInit[] = []

  constructor(config?: RTCConfiguration) {
    this.config = config
    FakePeerConnection.current = this
  }

  /// The client gates candidates on this, exactly as the browser exposes it.
  get remoteDescription() {
    return this.remote
  }

  async setRemoteDescription(description: { type: string; sdp: string }) {
    // Deferred by a microtask on purpose. The browser does not publish
    // `remoteDescription` synchronously either, and a fake that did would hide
    // the exact race this client exists to survive: a candidate delivered in
    // the same event-loop turn as the offer, while the description is still
    // being applied.
    await Promise.resolve()
    this.remote = description
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'v=0 answer' }
  }

  async setLocalDescription(description: { type: string; sdp?: string }) {
    this.local = description
  }

  async addIceCandidate(init: RTCIceCandidateInit) {
    // What the browser actually does: a candidate offered before the remote
    // description is in place is rejected, not queued. The client is what has
    // to hold it, so the fake refuses it here rather than being forgiving.
    if (!this.remote) {
      throw new DOMException('remote description is not set', 'InvalidStateError')
    }
    this.candidates.push(init)
  }

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

  /// The desktop is the offerer, so the channel arrives from over there.
  offerDataChannel(label = 'input'): FakeDataChannel {
    const channel = new FakeDataChannel(label)
    this.ondatachannel?.({ channel: channel as unknown as RTCDataChannel })
    return channel
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

  /* The bug this guards, seen on a home network with both devices on the same
   * wifi: the desktop sends its offer and its host candidate microseconds
   * apart, they arrive in one event-loop turn, and the candidate reached
   * addIceCandidate while setRemoteDescription was still in flight. The
   * browser rejected it, the rejection was swallowed, and the phone never
   * learned the one address it could actually reach — leaving only pairs
   * that need NAT hairpinning, so ICE failed with a full candidate list on
   * both sides. */
  it('holds candidates that arrive before the offer is applied', async () => {
    const client = await connected()
    socket().deliver({ type: 'sessionStarted', sessionId: SESSION_ID, peerDeviceId: DESKTOP_ID })
    await vi.waitFor(() => expect(FakePeerConnection.current).not.toBeNull())
    const peer = FakePeerConnection.current!

    // Both in the same turn, offer first, exactly as the socket delivers them.
    socket().deliver({ type: 'sdpOffer', sessionId: SESSION_ID, sdp: 'v=0 offer' })
    socket().deliver({
      type: 'iceCandidate',
      sessionId: SESSION_ID,
      candidate: 'candidate:1 1 UDP 2114977791 192.168.2.24 52345 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    })

    await vi.waitFor(() => expect(socket().types).toContain('sdpAnswer'))
    await vi.waitFor(() => expect(peer.candidates).toHaveLength(1))
    expect(peer.candidates[0]).toMatchObject({
      candidate: 'candidate:1 1 UDP 2114977791 192.168.2.24 52345 typ host',
      sdpMid: '0',
    })
    client.dispose()
  })

  it('replays held candidates in arrival order and keeps taking later ones', async () => {
    const client = await connected()
    socket().deliver({ type: 'sessionStarted', sessionId: SESSION_ID, peerDeviceId: DESKTOP_ID })
    await vi.waitFor(() => expect(FakePeerConnection.current).not.toBeNull())
    const peer = FakePeerConnection.current!

    const line = (address: string, port: number, type: string) =>
      `candidate:1 1 UDP 2114977791 ${address} ${port} typ ${type}`

    socket().deliver({ type: 'sdpOffer', sessionId: SESSION_ID, sdp: 'v=0 offer' })
    socket().deliver({
      type: 'iceCandidate',
      sessionId: SESSION_ID,
      candidate: line('192.168.2.24', 52345, 'host'),
      sdpMid: '0',
      sdpMLineIndex: 0,
    })
    socket().deliver({
      type: 'iceCandidate',
      sessionId: SESSION_ID,
      candidate: line('142.117.24.68', 63819, 'srflx'),
      sdpMid: '0',
      sdpMLineIndex: 0,
    })

    await vi.waitFor(() => expect(peer.candidates).toHaveLength(2))

    // A candidate arriving after the description is in goes straight through.
    socket().deliver({
      type: 'iceCandidate',
      sessionId: SESSION_ID,
      candidate: line('142.117.24.68', 63820, 'srflx'),
      sdpMid: '0',
      sdpMLineIndex: 0,
    })
    await vi.waitFor(() => expect(peer.candidates).toHaveLength(3))

    expect(peer.candidates.map((init) => init.candidate)).toEqual([
      line('192.168.2.24', 52345, 'host'),
      line('142.117.24.68', 63819, 'srflx'),
      line('142.117.24.68', 63820, 'srflx'),
    ])
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

  /* The port is part of the contract, not an incidental. Restrictive networks
   * routinely permit 3478 and drop everything else, so a STUN server on a
   * nonstandard port works at the desk it was written at and fails on a café
   * hotspot — which is exactly how :19302 got here in the first place. */
  it('defaults to STUN on port 3478 across independent vendors', async () => {
    const client = await connected()
    socket().deliver({ type: 'sessionStarted', sessionId: SESSION_ID, peerDeviceId: DESKTOP_ID })
    await vi.waitFor(() => expect(FakePeerConnection.current).not.toBeNull())

    const urls = (FakePeerConnection.current!.config?.iceServers ?? []).map((server) =>
      String(server.urls),
    )

    expect(urls.length).toBeGreaterThanOrEqual(3)
    for (const url of urls) {
      expect(url).toMatch(/:3478$/)
    }
    // Distinct hosts, so one provider's outage cannot stop gathering.
    const hosts = urls.map((url) => url.split(':')[1])
    expect(new Set(hosts).size).toBe(hosts.length)

    client.dispose()
  })

  /* An unreachable STUN server otherwise looks identical to a peer that never
   * answered: gathering yields no reflexive candidate and the session dies
   * ~30s later as a generic failure, naming nothing. */
  it('names the server when ICE gathering fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = await connected()
    socket().deliver({ type: 'sessionStarted', sessionId: SESSION_ID, peerDeviceId: DESKTOP_ID })
    await vi.waitFor(() => expect(FakePeerConnection.current).not.toBeNull())

    FakePeerConnection.current!.onicecandidateerror?.({
      url: 'stun:stun.l.google.com:19302',
      errorCode: 701,
      errorText: 'STUN binding request timed out',
    } as RTCPeerConnectionIceErrorEvent)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stun:stun.l.google.com:19302'))
    warn.mockRestore()
    client.dispose()
  })
})

/* The input channel. Everything here is about the two constraints the
 * DataChannel imposes on the sender: the phone never creates it, and it must
 * not flood a transport it shares with the video. */

describe('wsClient input channel', () => {
  beforeEach(install)

  async function streaming() {
    const client = createWsClient({ url: 'ws://test/ws' })
    localStorage.setItem('remotehost.deviceId', PHONE_ID)
    localStorage.setItem('remotehost.credential', 'secret')

    client.connect(DESKTOP_ID)
    socket().accept()
    socket().deliver({ type: 'authenticated', deviceId: PHONE_ID })
    await vi.waitFor(() => expect(socket().types).toContain('connectRequest'))
    socket().deliver({ type: 'sessionStarted', sessionId: SESSION_ID, peerDeviceId: DESKTOP_ID })
    await vi.waitFor(() => expect(FakePeerConnection.current).not.toBeNull())

    const peer = FakePeerConnection.current!
    peer.transitionTo('connected')
    return { client, peer }
  }

  const click = (nx: number, ny: number, clickCount = 1) =>
    [
      { kind: 'down' as const, point: { nx, ny }, buttons: 1, button: 'left' as const, clickCount },
      { kind: 'up' as const, point: { nx, ny }, buttons: 0, button: 'left' as const, clickCount },
    ]

  it('sends a click on the channel the desktop opened', async () => {
    const { client, peer } = await streaming()
    const channel = peer.offerDataChannel()

    for (const intent of click(0.6183, 0.4402, 2)) client.sendPointer(intent)

    expect(channel.messages).toHaveLength(2)
    expect(channel.messages[0]).toEqual({
      type: 'pointerDown',
      seq: 1,
      t: expect.any(Number),
      nx: 0.6183,
      ny: 0.4402,
      buttons: 1,
      button: 'left',
      clickCount: 2,
    })
    // One monotonic stream across every pointer message, which is what lets the
    // host drop a move that was reordered behind a press.
    expect(channel.messages[1]).toMatchObject({ type: 'pointerUp', seq: 2, clickCount: 2 })
    client.dispose()
  })

  it('never opens the channel itself', async () => {
    // An answerer cannot add an m-line the offer did not carry, so calling
    // createDataChannel() here would either do nothing or force a second
    // negotiation. The desktop offers it; this side waits.
    const { client, peer } = await streaming()
    expect('createDataChannel' in peer).toBe(false)
    expect(peer.ondatachannel).not.toBeNull()
    client.dispose()
  })

  it('ignores a channel it did not ask for', async () => {
    const { client, peer } = await streaming()
    const stray = peer.offerDataChannel('clipboard')
    const input = peer.offerDataChannel('input')

    client.sendPointer(click(0.5, 0.5)[0])

    expect(stray.readyState).toBe('closed')
    expect(input.messages).toHaveLength(1)
    client.dispose()
  })

  it('coalesces moves to one per frame and sends the newest position', async () => {
    const { client, peer } = await streaming()
    const channel = peer.offerDataChannel()

    for (const nx of [0.1, 0.2, 0.3, 0.4]) {
      client.sendPointer({ kind: 'move', point: { nx, ny: 0.5 }, buttons: 0 })
    }

    // Nothing yet: a 120 Hz touchmove stream describes positions the finger has
    // already left, and only the newest one is ever the right answer.
    expect(channel.sent).toHaveLength(0)

    await vi.waitFor(() => expect(channel.sent).toHaveLength(1))
    expect(channel.messages[0]).toMatchObject({ type: 'pointerMove', nx: 0.4 })
    client.dispose()
  })

  it('sends a click immediately, and drops the move it supersedes', async () => {
    const { client, peer } = await streaming()
    const channel = peer.offerDataChannel()

    client.sendPointer({ kind: 'move', point: { nx: 0.1, ny: 0.1 }, buttons: 0 })
    client.sendPointer(click(0.9, 0.9)[0])

    // A click waiting a frame for a move that carries no information the click
    // does not already carry would be latency for nothing.
    expect(channel.messages).toHaveLength(1)
    expect(channel.messages[0]).toMatchObject({ type: 'pointerDown', nx: 0.9 })

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(channel.messages).toHaveLength(1)
    client.dispose()
  })

  it('drops input silently when there is no channel', async () => {
    // --no-input on the desktop leaves the SCTP m-line out of the offer, so no
    // channel ever arrives. The UI still reports a cursor; it just goes nowhere.
    const { client } = await streaming()
    expect(() => client.sendPointer(click(0.5, 0.5)[0])).not.toThrow()
    client.dispose()
  })

  it('stops sending once the channel closes', async () => {
    const { client, peer } = await streaming()
    const channel = peer.offerDataChannel()
    channel.close()

    expect(() => client.sendPointer(click(0.5, 0.5)[0])).not.toThrow()
    expect(channel.sent).toHaveLength(0)
    client.dispose()
  })
})
