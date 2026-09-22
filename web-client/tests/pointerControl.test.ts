import { describe, expect, it } from 'vitest'
import { PointerControl } from '../src/viewer/pointerControl'
import type { StagePointerSample } from '../src/viewer/pointerControl'
import type { PointerIntent } from '../src/protocol/input'

/* Every rule in PointerControl is a judgement about what a touch means, and
 * each of them is a way the remote desktop can feel broken: a tap that clicks
 * in the wrong place, a double-tap that opens nothing, a drag that stops at the
 * letterbox bar. None of it needs a DOM, which is why the gesture rules live
 * outside the component. */

function sample(
  kind: StagePointerSample['kind'],
  nx: number,
  ny: number,
  at: number,
  inFrame = true,
): StagePointerSample {
  return { kind, frame: { nx, ny, inFrame }, at }
}

const kinds = (intents: PointerIntent[]) => intents.map((intent) => intent.kind)

describe('trackpad mode', () => {
  it('does not click on the way down, because a press may still become a slide', () => {
    const control = new PointerControl()
    expect(control.handle(sample('down', 0.2, 0.2, 0))).toEqual([])
  })

  it('pushes the cursor by the finger delta rather than jumping to the finger', () => {
    const control = new PointerControl()
    control.handle(sample('down', 0.2, 0.2, 0))

    const intents = control.handle(sample('move', 0.3, 0.25, 16))

    expect(kinds(intents)).toEqual(['move'])
    // Started at the centre, finger moved +0.1/+0.05.
    expect(control.getCursor().nx).toBeCloseTo(0.6)
    expect(control.getCursor().ny).toBeCloseTo(0.55)
  })

  it('turns a quick stationary press into a click at the cursor', () => {
    const control = new PointerControl()
    control.handle(sample('down', 0.2, 0.2, 0))
    const intents = control.handle(sample('up', 0.2, 0.2, 80))

    expect(kinds(intents)).toEqual(['down', 'up'])
    // At the cursor, NOT at the finger: in trackpad mode the finger is only
    // ever pushing the puck around.
    expect(intents[0].point).toEqual({ nx: 0.5, ny: 0.5 })
    expect(intents[0].buttons).toBe(1)
    expect(intents[1].buttons).toBe(0)
  })

  it('does not click after a slide', () => {
    const control = new PointerControl()
    control.handle(sample('down', 0.2, 0.2, 0))
    control.handle(sample('move', 0.6, 0.6, 16))

    expect(control.handle(sample('up', 0.6, 0.6, 120))).toEqual([])
  })

  it('does not click after a long hold', () => {
    const control = new PointerControl()
    control.handle(sample('down', 0.2, 0.2, 0))

    // Held still but held long. Not a tap, and the gesture that will eventually
    // claim this (long-press for a right click) is not built yet.
    expect(control.handle(sample('up', 0.2, 0.2, 900))).toEqual([])
  })

  it('counts a second quick tap as a double-click', () => {
    const control = new PointerControl()

    control.handle(sample('down', 0.2, 0.2, 0))
    const first = control.handle(sample('up', 0.2, 0.2, 60))
    control.handle(sample('down', 0.2, 0.2, 140))
    const second = control.handle(sample('up', 0.2, 0.2, 190))

    expect(first[0]).toMatchObject({ clickCount: 1 })
    // The whole reason clickCount exists: without it macOS sees two unrelated
    // single clicks and a double-tap opens nothing.
    expect(second[0]).toMatchObject({ clickCount: 2 })
    expect(second[1]).toMatchObject({ clickCount: 2 })
  })

  it('caps the chain at a triple click', () => {
    const control = new PointerControl()
    let last: PointerIntent[] = []

    for (let tap = 0; tap < 5; tap += 1) {
      control.handle(sample('down', 0.2, 0.2, tap * 100))
      last = control.handle(sample('up', 0.2, 0.2, tap * 100 + 40))
    }

    expect(last[0]).toMatchObject({ clickCount: 3 })
  })

  it('starts a new chain when the taps are far apart in time or space', () => {
    const control = new PointerControl()

    control.handle(sample('down', 0.2, 0.2, 0))
    control.handle(sample('up', 0.2, 0.2, 40))

    control.handle(sample('down', 0.2, 0.2, 5000))
    expect(control.handle(sample('up', 0.2, 0.2, 5040))[0]).toMatchObject({ clickCount: 1 })

    // Now a tap close in time but with the cursor moved well away between them.
    control.handle(sample('down', 0.2, 0.2, 5100))
    control.handle(sample('move', 0.9, 0.9, 5120))
    control.handle(sample('up', 0.9, 0.9, 5200))
    control.handle(sample('down', 0.9, 0.9, 5260))
    expect(control.handle(sample('up', 0.9, 0.9, 5300))[0]).toMatchObject({ clickCount: 1 })
  })

  it('keeps the cursor on the desktop when the finger keeps pushing', () => {
    const control = new PointerControl()
    control.handle(sample('down', 0.5, 0.5, 0))
    control.handle(sample('move', 3, 3, 16))

    expect(control.getCursor()).toEqual({ nx: 1, ny: 1 })
  })

  it('keeps reporting once the finger slides into a letterbox bar', () => {
    const control = new PointerControl()
    control.handle(sample('down', 0.1, 0.5, 0))

    // The bar is not a position on the desktop, but the cursor this finger is
    // pushing is nowhere near it — so the delta still counts.
    const intents = control.handle(sample('move', -0.2, 0.5, 16, false))
    expect(kinds(intents)).toEqual(['move'])
    expect(control.getCursor().nx).toBeCloseTo(0.2)
  })
})

describe('direct mode', () => {
  function direct() {
    const control = new PointerControl()
    control.setMode('direct')
    return control
  }

  it('presses where the finger landed', () => {
    const control = direct()
    const intents = control.handle(sample('down', 0.25, 0.75, 0))

    expect(intents).toEqual([
      { kind: 'down', point: { nx: 0.25, ny: 0.75 }, buttons: 1, button: 'left', clickCount: 1 },
    ])
    expect(control.getButtons()).toBe(1)
  })

  it('drags with the button held, then releases', () => {
    const control = direct()
    control.handle(sample('down', 0.25, 0.25, 0))

    const moved = control.handle(sample('move', 0.4, 0.4, 16))
    expect(moved).toEqual([{ kind: 'move', point: { nx: 0.4, ny: 0.4 }, buttons: 1 }])

    const released = control.handle(sample('up', 0.4, 0.4, 40))
    expect(released[0]).toMatchObject({ kind: 'up', buttons: 0 })
    expect(control.getButtons()).toBe(0)
  })

  it('ignores a whole gesture that began on a letterbox bar', () => {
    const control = direct()

    expect(control.handle(sample('down', -0.3, 0.5, 0, false))).toEqual([])
    // The moves and the release that follow belong to that same dead gesture.
    expect(control.handle(sample('move', 0.4, 0.5, 16))).toEqual([])
    expect(control.handle(sample('up', 0.4, 0.5, 40))).toEqual([])
    expect(control.getButtons()).toBe(0)
  })

  it('pins a drag that wanders into a bar to the edge instead of freezing', () => {
    const control = direct()
    control.handle(sample('down', 0.5, 0.5, 0))

    // Dropping this would stall the drag mid-gesture; clamping is how you reach
    // a menu bar at the very top of the remote screen.
    const intents = control.handle(sample('move', -0.4, 0.5, 16, false))
    expect(intents).toEqual([{ kind: 'move', point: { nx: 0, ny: 0.5 }, buttons: 1 }])
  })

  it('does not move the cursor without a finger down', () => {
    const control = direct()
    // A mouse crossing the stage in a desktop browser. There is no hover on a
    // phone, and honouring it would drag the remote cursor around on approach.
    expect(control.handle(sample('move', 0.4, 0.4, 0))).toEqual([])
  })

  it('counts a double tap', () => {
    const control = direct()

    control.handle(sample('down', 0.5, 0.5, 0))
    control.handle(sample('up', 0.5, 0.5, 40))
    const second = control.handle(sample('down', 0.51, 0.5, 120))

    expect(second[0]).toMatchObject({ clickCount: 2 })
  })

  it('releases on pointercancel, because no up is coming', () => {
    const control = direct()
    control.handle(sample('down', 0.5, 0.5, 0))

    const intents = control.handle(sample('cancel', 0.5, 0.5, 40))
    expect(kinds(intents)).toEqual(['up'])
    expect(control.getButtons()).toBe(0)
  })
})

describe('abandoning a gesture', () => {
  it('releases a held button when the mode changes under it', () => {
    const control = new PointerControl()
    control.setMode('direct')
    control.handle(sample('down', 0.5, 0.5, 0))

    // The trackpad gesture that follows will never send the up for this press.
    const intents = control.setMode('trackpad')
    expect(kinds(intents)).toEqual(['up'])
    expect(control.getButtons()).toBe(0)
  })

  it('releases a held button on teardown', () => {
    const control = new PointerControl()
    control.setMode('direct')
    control.handle(sample('down', 0.5, 0.5, 0))

    expect(kinds(control.abandon())).toEqual(['up'])
    // Idempotent: the session can end twice over without sending a stray up.
    expect(control.abandon()).toEqual([])
  })

  it('has nothing to release when no button is held', () => {
    const control = new PointerControl()
    control.handle(sample('down', 0.5, 0.5, 0))
    expect(control.abandon()).toEqual([])
  })
})

describe('before the first frame decodes', () => {
  it('drops samples that have nothing to map against', () => {
    const control = new PointerControl()
    expect(control.handle({ kind: 'down', frame: null, at: 0 })).toEqual([])
    expect(control.handle({ kind: 'move', frame: null, at: 16 })).toEqual([])
  })
})
