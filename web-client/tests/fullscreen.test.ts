import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isFullscreen, toggleFullscreen, useFullscreen } from '../src/viewer/fullscreen'

/* The button is a toggle, but the browser keeps the state: the user leaves
 * fullscreen with Esc or a swipe and the page is told after the fact. So the
 * toggle has to read `document.fullscreenElement` live, not remember. */

function setFullscreenElement(element: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', {
    value: element,
    configurable: true,
  })
}

afterEach(() => {
  setFullscreenElement(null)
  vi.restoreAllMocks()
})

describe('toggleFullscreen', () => {
  it('enters when the document is not fullscreen', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    const exit = vi.fn().mockResolvedValue(undefined)
    document.documentElement.requestFullscreen = request
    document.exitFullscreen = exit

    await toggleFullscreen()
    expect(request).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()
  })

  it('exits when it is, however it got there', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    const exit = vi.fn().mockResolvedValue(undefined)
    document.documentElement.requestFullscreen = request
    document.exitFullscreen = exit
    setFullscreenElement(document.documentElement)

    await toggleFullscreen()
    expect(exit).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
  })

  it('swallows a refusal, which is what iPhone Safari gives', async () => {
    document.documentElement.requestFullscreen = vi.fn().mockRejectedValue(new TypeError())
    await expect(toggleFullscreen()).resolves.toBeUndefined()
  })
})

describe('useFullscreen', () => {
  it('follows fullscreenchange, including an exit the page never asked for', () => {
    const { result } = renderHook(() => useFullscreen())
    expect(result.current).toBe(false)
    expect(isFullscreen()).toBe(false)

    act(() => {
      setFullscreenElement(document.documentElement)
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(result.current).toBe(true)

    act(() => {
      setFullscreenElement(null)
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(result.current).toBe(false)
  })
})
