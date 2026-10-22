import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoStage } from '../src/viewer/VideoStage'
import type { VideoStageHandle } from '../src/viewer/VideoStage'

/* jsdom has no ResizeObserver, so the stage measures 0x0, contain-fit returns
 * no box and nothing inside the frame renders at all. Reporting a size is what
 * makes these assertions about the frame's contents mean anything. */
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

/* The stage is the one place a real frame can appear, so "does a <video> exist
 * and is the stream attached to it" is worth asserting: for a long time this
 * component rendered a CSS mockup, and nothing failed when it did. */

const TRACK = { width: 1670, height: 1080 }

describe('VideoStage', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    // jsdom implements no media pipeline, so `srcObject` silently discards
    // what it is given. A plain data slot lets the assignment be observed.
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      value: null,
      writable: true,
      configurable: true,
    })
  })

  it('renders the placeholder when there is no stream', () => {
    const { container } = render(<VideoStage trackSize={TRACK} />)
    expect(container.querySelector('video')).toBeNull()
  })

  it('renders a video element and attaches the stream', () => {
    const stream = { id: 'remote' } as unknown as MediaStream
    const { container } = render(<VideoStage trackSize={TRACK} stream={stream} />)

    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    // Autoplay on a phone only works muted and inline; without these iOS
    // Safari shows a play button over a black stage.
    expect(video).toHaveAttribute('autoplay')
    expect(video).toHaveAttribute('playsinline')
    expect((video as HTMLVideoElement).muted).toBe(true)
    expect((video as HTMLVideoElement).srcObject).toBe(stream)
  })

  it('keeps the stage itself present so chrome has something to sit on', () => {
    render(
      <VideoStage trackSize={TRACK}>
        {() => <span data-testid="overlay" />}
      </VideoStage>,
    )
    expect(screen.getByTestId('overlay')).toBeInTheDocument()
  })

  it("swallows the browser's right-click menu and middle-click autoscroll", () => {
    const { container } = render(<VideoStage trackSize={TRACK} />)
    const stage = container.firstElementChild as HTMLElement

    // fireEvent returns false when the default was prevented.
    expect(fireEvent.contextMenu(stage)).toBe(false)
    expect(fireEvent.mouseDown(stage, { button: 1 })).toBe(false)
    // A left press keeps its default, so focus and text selection elsewhere
    // behave as usual.
    expect(fireEvent.mouseDown(stage, { button: 0 })).toBe(true)
  })
})

describe('VideoStage wheel', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })

  it('takes the wheel from the browser and reports it in wire pixels', () => {
    const onWheel = vi.fn()
    const { container } = render(<VideoStage trackSize={TRACK} onWheel={onWheel} />)
    const stage = container.firstElementChild as HTMLElement

    // Line mode, as Firefox sends it: 3 lines is one notch, which is 100.
    const notPrevented = fireEvent.wheel(stage, { deltaY: 3, deltaMode: 1 })

    expect(notPrevented).toBe(false)
    expect(onWheel).toHaveBeenCalledTimes(1)
    expect(onWheel.mock.calls[0][0]).toMatchObject({ dx: 0, dy: 100 })
  })

  it('swallows a pinch or Ctrl+wheel rather than sending it as a scroll', () => {
    const onWheel = vi.fn()
    const { container } = render(<VideoStage trackSize={TRACK} onWheel={onWheel} />)
    const stage = container.firstElementChild as HTMLElement

    // Prevented all the same: otherwise the browser zooms the whole viewer.
    expect(fireEvent.wheel(stage, { deltaY: 10, ctrlKey: true })).toBe(false)
    expect(onWheel).not.toHaveBeenCalled()
  })

  it('leaves the wheel alone when nothing is listening, as behind a panel', () => {
    const { container } = render(<VideoStage trackSize={TRACK} />)
    const stage = container.firstElementChild as HTMLElement
    expect(fireEvent.wheel(stage, { deltaY: 100 })).toBe(true)
  })
})

/* Game mode's mouse. Pointer Lock is requested from inside the press, the
 * one place a browser allows it, and the travel every mouse event carries is
 * reported in the frame's own units. jsdom has no Pointer Lock, so it is
 * stubbed per test. */
describe('VideoStage pointer lock', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })
  afterEach(() => {
    delete (Element.prototype as { requestPointerLock?: unknown }).requestPointerLock
    delete (Document.prototype as { exitPointerLock?: unknown }).exitPointerLock
  })

  function stubPointerLock() {
    const request = vi.fn()
    const exit = vi.fn()
    Element.prototype.requestPointerLock = request
    Document.prototype.exitPointerLock = exit
    return { request, exit }
  }

  it('asks for the lock on a mouse press, and only in game mode', () => {
    const { request } = stubPointerLock()
    const { container, rerender } = render(<VideoStage trackSize={TRACK} onPointer={() => {}} />)
    const stage = container.firstElementChild as HTMLElement

    fireEvent.pointerDown(stage, { pointerType: 'mouse', pointerId: 1, clientX: 400, clientY: 300 })
    expect(request).not.toHaveBeenCalled()
    fireEvent.pointerUp(stage, { pointerType: 'mouse', pointerId: 1, clientX: 400, clientY: 300 })

    rerender(<VideoStage trackSize={TRACK} onPointer={() => {}} pointerLock />)
    fireEvent.pointerDown(stage, { pointerType: 'mouse', pointerId: 1, clientX: 400, clientY: 300 })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('never asks for a finger: there is no cursor to lock', () => {
    const { request } = stubPointerLock()
    const { container } = render(<VideoStage trackSize={TRACK} onPointer={() => {}} pointerLock />)
    const stage = container.firstElementChild as HTMLElement
    fireEvent.pointerDown(stage, { pointerType: 'touch', pointerId: 1, clientX: 400, clientY: 300 })
    expect(request).not.toHaveBeenCalled()
  })

  it('reports the lock changing hands, and releases it when game mode ends', () => {
    const { exit } = stubPointerLock()
    const onPointerLockChange = vi.fn()
    const { container, rerender } = render(
      <VideoStage trackSize={TRACK} pointerLock onPointerLockChange={onPointerLockChange} />,
    )
    const stage = container.firstElementChild as HTMLElement

    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: stage })
    fireEvent(document, new Event('pointerlockchange'))
    expect(onPointerLockChange).toHaveBeenLastCalledWith(true)

    rerender(
      <VideoStage trackSize={TRACK} pointerLock={false} onPointerLockChange={onPointerLockChange} />,
    )
    expect(exit).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null })
    fireEvent(document, new Event('pointerlockchange'))
    expect(onPointerLockChange).toHaveBeenLastCalledWith(false)
  })

  it('reports mouse travel in frame fractions alongside the position', async () => {
    const onPointer = vi.fn()
    const { container } = render(<VideoStage trackSize={TRACK} onPointer={onPointer} />)
    const stage = container.firstElementChild as HTMLElement

    // The stage measures 800x600 and the track is 1670x1080, so the frame is
    // 800 wide and ~517 high. 80px of travel is a tenth of the frame.
    await waitFor(() => expect(container.querySelector('[class*="frame"]')).not.toBeNull())
    fireEvent.pointerMove(stage, {
      pointerType: 'mouse',
      clientX: 400,
      clientY: 300,
      buttons: 0,
      movementX: 80,
      movementY: 0,
    })

    expect(onPointer).toHaveBeenCalledTimes(1)
    const sample = onPointer.mock.calls[0][0]
    expect(sample.movement.dx).toBeCloseTo(0.1)
    expect(sample.movement.dy).toBe(0)
  })

  it('reports no travel for a finger', () => {
    const onPointer = vi.fn()
    const { container } = render(<VideoStage trackSize={TRACK} onPointer={onPointer} />)
    const stage = container.firstElementChild as HTMLElement
    fireEvent.pointerDown(stage, { pointerType: 'touch', pointerId: 1, clientX: 400, clientY: 300 })
    expect(onPointer.mock.calls[0][0].movement).toBeUndefined()
  })
})

/* Sound. The element always starts muted — that is the autoplay deal on a
 * phone — and is unmuted afterwards, with the browser's refusal turned into
 * something the viewer can show and a gesture can fix. */
describe('VideoStage sound', () => {
  const stream = { id: 'remote' } as unknown as MediaStream
  let play: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      value: null,
      writable: true,
      configurable: true,
    })
    // jsdom's play() is "not implemented"; the stage needs a real promise.
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('stays muted while sound is off, and never reports a block', async () => {
    const onAudioBlocked = vi.fn()
    const { container } = render(
      <VideoStage trackSize={TRACK} stream={stream} muted onAudioBlocked={onAudioBlocked} />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    await act(async () => {})
    expect(video.muted).toBe(true)
    expect(onAudioBlocked).not.toHaveBeenCalled()
  })

  it('unmutes once the stream is attached when the browser allows it', async () => {
    const onAudioBlocked = vi.fn()
    const { container } = render(
      <VideoStage trackSize={TRACK} stream={stream} muted={false} onAudioBlocked={onAudioBlocked} />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    await waitFor(() => expect(video.muted).toBe(false))
    expect(play).toHaveBeenCalled()
    // Allowed means nothing to report: the viewer only hears about trouble.
    expect(onAudioBlocked).not.toHaveBeenCalled()
  })

  it('falls back to muted and says so when unmuted playback is refused', async () => {
    play.mockRejectedValue(new DOMException('gesture required', 'NotAllowedError'))
    const onAudioBlocked = vi.fn()
    const { container } = render(
      <VideoStage trackSize={TRACK} stream={stream} muted={false} onAudioBlocked={onAudioBlocked} />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    await waitFor(() => expect(onAudioBlocked).toHaveBeenCalledWith(true))
    // Muted again, and play() asked for a second time so the picture keeps
    // moving — WebKit pauses a muted-autoplay video that is unmuted outside
    // a gesture.
    expect(video.muted).toBe(true)
    expect(play.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('uses the next touch on the stage, a gesture, to unmute', async () => {
    play.mockRejectedValue(new DOMException('gesture required', 'NotAllowedError'))
    const onAudioBlocked = vi.fn()
    const { container } = render(
      <VideoStage trackSize={TRACK} stream={stream} muted={false} onAudioBlocked={onAudioBlocked} />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    await waitFor(() => expect(onAudioBlocked).toHaveBeenCalledWith(true))

    // The tap is the gesture the browser wanted.
    play.mockResolvedValue(undefined)
    const stage = container.firstElementChild as HTMLElement
    fireEvent.pointerDown(stage, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 })
    await waitFor(() => expect(onAudioBlocked).toHaveBeenLastCalledWith(false))
    expect(video.muted).toBe(false)
  })

  it('exposes unmute() for a prompt to call from its own click', async () => {
    play.mockRejectedValue(new DOMException('gesture required', 'NotAllowedError'))
    const onAudioBlocked = vi.fn()
    const handle = createRef<VideoStageHandle>()
    const { container } = render(
      <VideoStage
        ref={handle}
        trackSize={TRACK}
        stream={stream}
        muted={false}
        onAudioBlocked={onAudioBlocked}
      />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    await waitFor(() => expect(onAudioBlocked).toHaveBeenCalledWith(true))

    play.mockResolvedValue(undefined)
    let ok = false
    await act(async () => {
      ok = await handle.current!.unmute()
    })
    expect(ok).toBe(true)
    expect(video.muted).toBe(false)
    expect(onAudioBlocked).toHaveBeenLastCalledWith(false)
  })

  it('re-mutes when sound is switched off mid-session', async () => {
    const { container, rerender } = render(
      <VideoStage trackSize={TRACK} stream={stream} muted={false} />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    await waitFor(() => expect(video.muted).toBe(false))
    rerender(<VideoStage trackSize={TRACK} stream={stream} muted />)
    await act(async () => {})
    expect(video.muted).toBe(true)
  })
})
