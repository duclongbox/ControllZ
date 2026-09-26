import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoStage } from '../src/viewer/VideoStage'

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
