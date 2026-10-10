/* The browser's fullscreen state, as one toggle.
 *
 * `requestFullscreen` is a one-way door: the page can enter, and only the
 * browser's own gesture (Esc, the back swipe) or `exitFullscreen` leaves. The
 * viewer's button is a toggle, so it needs to know which side of the door it
 * is on — and the only trustworthy answer is `document.fullscreenElement`,
 * read live, because the user can leave by Esc without us ever being asked. */

import { useEffect, useState } from 'react'

export function isFullscreen(): boolean {
  // Truthiness, not `!== null`: an engine without the API (and jsdom) leaves
  // the property undefined, which must read as "not fullscreen".
  return typeof document !== 'undefined' && Boolean(document.fullscreenElement)
}

/** Enter when out, leave when in. Rejections (no gesture, unsupported) are swallowed. */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) {
      await document.exitFullscreen?.()
    } else {
      await document.documentElement.requestFullscreen?.()
    }
  } catch {
    // Refused: iPhone Safari has no element fullscreen at all, and every
    // browser refuses a request made without a user gesture. Nothing to do.
  }
}

/** Mirrors {@link isFullscreen}, re-rendering on every `fullscreenchange`. */
export function useFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(isFullscreen)

  useEffect(() => {
    const update = () => setFullscreen(isFullscreen())
    update()
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  return fullscreen
}
