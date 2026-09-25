import { describe, expect, it } from 'vitest'
import { atRevealEdge } from '../src/viewer/chromeReveal'
import type { StagePointerSample } from '../src/viewer/pointerControl'

/* The chrome sits over the strips of the picture where the remote desktop
 * keeps its Dock, menu bar and taskbar. If a passing mouse could summon it,
 * those would be unreachable — so only a deliberate rest on the top edge may. */

function at(
  ny: number,
  overrides: Partial<StagePointerSample> = {},
): StagePointerSample {
  return {
    kind: 'move',
    frame: { nx: 0.5, ny, inFrame: ny >= 0 },
    at: 0,
    pointerType: 'mouse',
    buttons: 0,
    ...overrides,
  }
}

describe('atRevealEdge', () => {
  it('holds for a mouse hovering on the top edge', () => {
    expect(atRevealEdge(at(0))).toBe(true)
  })

  it('holds above the frame, in a letterbox bar', () => {
    expect(atRevealEdge(at(-0.05))).toBe(true)
  })

  it('does not hold anywhere else, including the bottom edge where the Dock is', () => {
    expect(atRevealEdge(at(0.02))).toBe(false)
    expect(atRevealEdge(at(1))).toBe(false)
  })

  it('does not hold during a drag, which is the user working the desktop', () => {
    expect(atRevealEdge(at(0, { buttons: 1 }))).toBe(false)
  })

  it('does not hold for a finger, which wakes the chrome on any touch anyway', () => {
    expect(atRevealEdge(at(0, { pointerType: 'touch' }))).toBe(false)
  })

  it('does not hold before a frame has decoded', () => {
    expect(atRevealEdge(at(0, { frame: null }))).toBe(false)
  })
})
