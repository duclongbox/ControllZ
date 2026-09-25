/* When a mouse may bring the viewer chrome back.
 *
 * A finger wakes the chrome on any touch, and that is right for a phone. It is
 * wrong for a mouse, which is never still: every hover would hold the bars up,
 * and the bars sit over the top and bottom strips of the picture — exactly
 * where the remote desktop keeps its menu bar, Dock and taskbar. A mouse could
 * then never reach them, because the bar, not the stage, would be under it.
 *
 * So a mouse asks deliberately: it rests on the top edge of the stage, the same
 * gesture that reveals a fullscreen browser's toolbar. Resting, not touching —
 * the top edge is also where the macOS menu bar is, and passing through it on
 * the way to a menu must not throw our bar over the one being reached for. */

import type { StagePointerSample } from './pointerControl'

/** How long a mouse must rest on the top edge before the chrome shows, ms. */
export const REVEAL_DWELL_MS = 800

/** Frame-space distance from the top that still counts as "on the edge". */
const TOP_EDGE = 0.002

/**
 * True while this sample holds a mouse on the reveal edge: at (or above) the
 * top of the frame, with nothing pressed. A drag up there is the user doing
 * something on the desktop, not asking for our chrome.
 */
export function atRevealEdge(sample: StagePointerSample): boolean {
  return (
    sample.pointerType === 'mouse' &&
    sample.kind === 'move' &&
    (sample.buttons ?? 0) === 0 &&
    sample.frame !== null &&
    sample.frame.ny <= TOP_EDGE
  )
}
