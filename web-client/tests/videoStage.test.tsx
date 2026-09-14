import { render, screen } from '@testing-library/react'
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
})
