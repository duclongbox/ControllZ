import { createMockClient } from '../src/session/mockClient'
import type { SessionState } from '../src/session/types'

/* The mock driver is throwaway — M1 replaces it — but the state machine it
 * drives is not, and every screen branches on these phases. */

function collect(client: ReturnType<typeof createMockClient>) {
  const seen: SessionState[] = []
  const stop = client.subscribe((s) => seen.push(s))
  return { seen, stop }
}

describe('mockClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts idle and emits current state on subscribe', () => {
    const client = createMockClient()
    const { seen } = collect(client)
    expect(seen).toHaveLength(1)
    expect(seen[0].phase).toBe('idle')
    client.dispose()
  })

  it('walks the ladder to streaming', () => {
    const client = createMockClient({ stepMs: 10 })
    client.connect('dev_studio_mac')
    expect(client.getState().phase).toBe('authorising')

    vi.advanceTimersByTime(200)

    const state = client.getState()
    expect(state.phase).toBe('streaming')
    expect(state.device?.name).toBe('Studio Mac')
    expect(state.startedAt).not.toBeNull()
    expect(state.steps.every((s) => s.state === 'done')).toBe(true)
    client.dispose()
  })

  it('emits a stats sample every second while streaming', () => {
    const client = createMockClient({ stepMs: 10 })
    client.connect('dev_studio_mac')
    vi.advanceTimersByTime(200)
    expect(client.getState().stats).not.toBeNull()

    const first = client.getState().stats!.rttMs
    vi.advanceTimersByTime(3000)
    // Still reporting, still within a plausible band for a direct link.
    expect(client.getState().stats!.rttMs).toBeGreaterThan(0)
    expect(typeof first).toBe('number')
    client.dispose()
  })

  it('refuses an offline device with desktopOffline', () => {
    const client = createMockClient({ stepMs: 10 })
    client.connect('dev_living_room')
    vi.advanceTimersByTime(50)

    const state = client.getState()
    expect(state.phase).toBe('rejected')
    expect(state.rejectReason).toBe('desktopOffline')
    client.dispose()
  })

  it('carries the device transport through to the session', () => {
    const client = createMockClient({ stepMs: 10 })
    client.connect('dev_work_pc')
    vi.advanceTimersByTime(200)
    expect(client.getState().transport).toBe('relayed')
    client.dispose()
  })

  it('surfaces a forced rejection reason', () => {
    const client = createMockClient({ stepMs: 10, rejectWith: 'alreadyInSession' })
    client.connect('dev_studio_mac')
    vi.advanceTimersByTime(50)
    expect(client.getState().rejectReason).toBe('alreadyInSession')
    client.dispose()
  })

  it('keeps the session alive through an ICE restart', () => {
    const client = createMockClient({ stepMs: 10 })
    client.connect('dev_studio_mac')
    vi.advanceTimersByTime(200)

    client.restartIce()
    // Reconnecting is inside the session — the stage keeps its last frame.
    expect(client.getState().phase).toBe('reconnecting')

    vi.advanceTimersByTime(2500)
    expect(client.getState().phase).toBe('streaming')
    client.dispose()
  })

  it('ends cleanly and stops emitting', () => {
    const client = createMockClient({ stepMs: 10 })
    client.connect('dev_studio_mac')
    vi.advanceTimersByTime(200)

    const { seen } = collect(client)
    const before = seen.length
    client.end()
    expect(client.getState().phase).toBe('ended')

    vi.advanceTimersByTime(5000)
    // No stats ticks after ending.
    expect(seen.length).toBe(before + 1)
    client.dispose()
  })

  it('ignores connect and end when frozen, for the dev gallery', () => {
    const client = createMockClient({
      frozen: true,
      initial: { phase: 'streaming', transport: 'relayed' },
    })
    client.connect('dev_studio_mac')
    client.end()
    expect(client.getState().phase).toBe('streaming')
    expect(client.getState().transport).toBe('relayed')
    client.dispose()
  })

  it('stops notifying after dispose', () => {
    const client = createMockClient({ stepMs: 10 })
    const { seen } = collect(client)
    client.dispose()
    const after = seen.length
    client.connect('dev_studio_mac')
    vi.advanceTimersByTime(500)
    expect(seen.length).toBe(after)
  })
})
