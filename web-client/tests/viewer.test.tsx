import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Viewer } from '../src/screens/Viewer'
import { DEVICES } from '../src/mock/devices'
import { createMockClient } from '../src/session/mockClient'
import { SessionProvider } from '../src/session/SessionProvider'
import type { SessionClient } from '../src/session/client'
import type { SessionState, SessionStats } from '../src/session/types'
import { resetPrefsForTest } from '../src/store/prefs'

/* The live viewer's overlays and the stage underneath them.
 *
 * The stats card, the pointer-mode control and the modifier bar are things
 * you use *while* working the desktop; for a while opening any of them cut
 * the stage's pointer input, so "show stats" meant "lose the mouse". The side
 * panels are the opposite — they cover the frame and own the gesture. */

const STATS: SessionStats = {
  fps: 60,
  bitrateBps: 8_000_000,
  rttMs: 12,
  jitterMs: 1.2,
  lossFraction: 0,
  freezeCount: 0,
  width: 1920,
  height: 1080,
  decodeMs: 2.1,
  candidatePair: 'host ⇄ host',
  keyframes: 1,
}

/* jsdom lays nothing out: without a size the stage has no frame, and without a
 * rect every pointer maps to nowhere — so neither the frame nor the input path
 * would exist to test. */
class FakeResizeObserver {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe() {
    this.callback(
      [{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}

function renderViewer(overrides: Partial<SessionState> = {}) {
  const device = DEVICES[0]
  const client = createMockClient({
    frozen: true,
    emitStats: false,
    initial: {
      phase: 'streaming',
      device,
      activeDisplayId: device.displays[0].id,
      startedAt: Date.now() - 1000,
      steps: [],
      stats: STATS,
      ...overrides,
    },
  })
  const sendPointer = vi.spyOn(client, 'sendPointer')
  const sendKey = vi.spyOn(client, 'sendKey')
  const router = createMemoryRouter([{ path: '/session/:deviceId', element: <Viewer /> }], {
    initialEntries: [`/session/${device.id}`],
  })
  const view = render(
    <SessionProvider client={client as SessionClient}>
      <RouterProvider router={router} />
    </SessionProvider>,
  )
  const stage = view.container.querySelector('video, [class*="frame"]')!.parentElement!
    .closest('[class*="stage"]') as HTMLElement
  return { ...view, client, sendPointer, sendKey, stage }
}

/** A mouse hovering the middle of the stage: always a `move` for the desktop. */
function hoverStage(stage: HTMLElement) {
  fireEvent.pointerMove(stage, { pointerType: 'mouse', clientX: 400, clientY: 300, buttons: 0 })
}

function setFullscreenElement(element: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { value: element, configurable: true })
}

beforeEach(() => {
  localStorage.clear()
  resetPrefsForTest()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  setFullscreenElement(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Viewer overlays', () => {
  it('keeps the mouse working on the desktop while the stats card is up', async () => {
    const { stage, sendPointer } = renderViewer()
    await userEvent.click(screen.getByRole('button', { name: 'Connection stats' }))
    expect(screen.getByLabelText('Connection stats', { selector: 'div' })).toBeInTheDocument()

    hoverStage(stage)
    expect(sendPointer).toHaveBeenCalledWith(expect.objectContaining({ kind: 'move' }))
  })

  it('keeps it working under the modifier bar and the pointer-mode control too', async () => {
    const { stage, sendPointer } = renderViewer()
    await userEvent.click(screen.getByRole('button', { name: 'Keyboard' }))
    hoverStage(stage)
    expect(sendPointer).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Pointer mode' }))
    hoverStage(stage)
    expect(sendPointer).toHaveBeenCalledTimes(2)
  })

  it('suspends the stage under a side panel, which covers the frame', async () => {
    const { stage, sendPointer } = renderViewer()
    await userEvent.click(screen.getByRole('button', { name: 'Quality' }))
    expect(screen.getByRole('complementary', { name: 'Quality' })).toBeInTheDocument()

    hoverStage(stage)
    expect(sendPointer).not.toHaveBeenCalled()
  })

  it('leaves the bar usable with the modifier bar open: the keyboard toggle still closes it', async () => {
    renderViewer()
    const keyboard = screen.getByRole('button', { name: 'Keyboard' })
    await userEvent.click(keyboard)
    expect(screen.getByRole('button', { name: 'esc' })).toBeInTheDocument()
    await userEvent.click(keyboard)
    expect(screen.queryByRole('button', { name: 'esc' })).not.toBeInTheDocument()
  })
})

describe('Viewer fullscreen', () => {
  it('toggles: the same button leaves fullscreen once the document is in it', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    const exit = vi.fn().mockResolvedValue(undefined)
    document.documentElement.requestFullscreen = request
    document.exitFullscreen = exit
    renderViewer()

    await userEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    expect(request).toHaveBeenCalledOnce()

    act(() => {
      setFullscreenElement(document.documentElement)
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    await userEvent.click(screen.getByRole('button', { name: 'Exit full screen' }))
    expect(exit).toHaveBeenCalledOnce()
  })

  it('does not forward the Esc that leaves fullscreen, but sends one otherwise', () => {
    const { sendKey } = renderViewer()
    setFullscreenElement(document.documentElement)
    fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' })
    fireEvent.keyUp(window, { code: 'Escape', key: 'Escape' })
    expect(sendKey).not.toHaveBeenCalled()

    setFullscreenElement(null)
    fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' })
    expect(sendKey).toHaveBeenCalledWith(expect.objectContaining({ kind: 'down', code: 'Escape' }))
  })
})
