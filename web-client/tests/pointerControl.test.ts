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

/** A mouse sample: `buttons` is the DOM mask held after the event. */
function mouse(
  kind: StagePointerSample['kind'],
  nx: number,
  ny: number,
  at: number,
  buttons: number,
  inFrame = true,
): StagePointerSample {
  return { kind, frame: { nx, ny, inFrame }, at, pointerType: 'mouse', buttons }
}

describe('mouse passthrough', () => {
  it('moves the desktop cursor on hover, with nothing pressed', () => {
    const control = new PointerControl()
    const intents = control.handle(mouse('move', 0.3, 0.7, 0, 0))

    expect(intents).toEqual([{ kind: 'move', point: { nx: 0.3, ny: 0.7 }, buttons: 0 }])
    expect(control.getCursor()).toEqual({ nx: 0.3, ny: 0.7 })
  })

  it('presses on the way down, at the mouse, even in trackpad mode', () => {
    const control = new PointerControl()
    const intents = control.handle(mouse('down', 0.3, 0.7, 0, 1))

    expect(intents).toEqual([
      { kind: 'down', point: { nx: 0.3, ny: 0.7 }, buttons: 1, button: 'left', clickCount: 1 },
    ])
  })

  it('still clicks after a slow press, which tap detection used to swallow', () => {
    const control = new PointerControl()
    control.handle(mouse('down', 0.3, 0.3, 0, 1))
    const intents = control.handle(mouse('up', 0.3, 0.3, 900, 0))

    expect(kinds(intents)).toEqual(['up'])
    expect(intents[0]).toMatchObject({ button: 'left', buttons: 0 })
  })

  it('still clicks after the mouse wobbles, and drags while held', () => {
    const control = new PointerControl()
    control.handle(mouse('down', 0.3, 0.3, 0, 1))
    const drag = control.handle(mouse('move', 0.35, 0.32, 16, 1))
    const release = control.handle(mouse('up', 0.35, 0.32, 40, 0))

    expect(drag).toEqual([{ kind: 'move', point: { nx: 0.35, ny: 0.32 }, buttons: 1 }])
    expect(kinds(release)).toEqual(['up'])
  })

  it('sends right and middle buttons as themselves', () => {
    const control = new PointerControl()

    expect(control.handle(mouse('down', 0.5, 0.5, 0, 2))[0]).toMatchObject({
      kind: 'down',
      button: 'right',
      buttons: 2,
    })
    expect(control.handle(mouse('up', 0.5, 0.5, 30, 0))[0]).toMatchObject({
      kind: 'up',
      button: 'right',
    })
    expect(control.handle(mouse('down', 0.5, 0.5, 60, 4))[0]).toMatchObject({
      kind: 'down',
      button: 'middle',
      buttons: 4,
    })
  })

  it('reads a chord from the mask, since the second button arrives as a move', () => {
    const control = new PointerControl()
    control.handle(mouse('down', 0.5, 0.5, 0, 1))

    // Browsers fire pointerdown for the first button only.
    const chord = control.handle(mouse('move', 0.5, 0.5, 20, 3))
    expect(chord).toEqual([
      { kind: 'down', point: { nx: 0.5, ny: 0.5 }, buttons: 3, button: 'right', clickCount: 1 },
    ])

    const releaseLeft = control.handle(mouse('move', 0.5, 0.5, 40, 2))
    expect(releaseLeft).toMatchObject([{ kind: 'up', button: 'left', buttons: 2 }])
  })

  it('releases before pressing when one sample swaps buttons', () => {
    const control = new PointerControl()
    control.handle(mouse('down', 0.5, 0.5, 0, 1))

    const intents = control.handle(mouse('move', 0.5, 0.5, 20, 2))
    expect(intents.map((i) => [i.kind, i.buttons])).toEqual([
      ['up', 0],
      ['down', 2],
    ])
  })

  it('counts a double-click with desktop timing, carried on both down and up', () => {
    const control = new PointerControl()
    control.handle(mouse('down', 0.4, 0.4, 0, 1))
    control.handle(mouse('up', 0.4, 0.4, 80, 0))
    // 420ms after the first press: too slow for a double-tap, fine for a mouse.
    const down = control.handle(mouse('down', 0.4, 0.4, 420, 1))
    const up = control.handle(mouse('up', 0.4, 0.4, 500, 0))

    expect(down[0]).toMatchObject({ clickCount: 2 })
    expect(up[0]).toMatchObject({ clickCount: 2 })
  })

  it('does not chain clicks of different buttons', () => {
    const control = new PointerControl()
    control.handle(mouse('down', 0.4, 0.4, 0, 1))
    control.handle(mouse('up', 0.4, 0.4, 50, 0))

    expect(control.handle(mouse('down', 0.4, 0.4, 100, 2))[0]).toMatchObject({ clickCount: 1 })
  })

  it('pins hover that overshoots the frame to the edge, where the Dock and taskbar are', () => {
    const control = new PointerControl()
    // A flick past the bottom of the picture: the last sample is in the bar.
    expect(control.handle(mouse('move', 0.5, 1.08, 0, 0, false))).toEqual([
      { kind: 'move', point: { nx: 0.5, ny: 1 }, buttons: 0 },
    ])
    expect(control.handle(mouse('move', -0.1, -0.2, 16, 0, false))).toEqual([
      { kind: 'move', point: { nx: 0, ny: 0 }, buttons: 0 },
    ])
  })

  it('ignores a press that began on a bar, including when it drags onto the frame', () => {
    const control = new PointerControl()
    // Moves the cursor to the edge like any hover, but presses nothing.
    expect(control.handle(mouse('down', -0.1, 0.5, 0, 1, false))).toEqual([
      { kind: 'move', point: { nx: 0, ny: 0.5 }, buttons: 0 },
    ])

    // Still held, now over the desktop: a move, not a late press.
    expect(control.handle(mouse('move', 0.2, 0.5, 16, 1))).toEqual([
      { kind: 'move', point: { nx: 0.2, ny: 0.5 }, buttons: 0 },
    ])
    expect(control.handle(mouse('up', 0.2, 0.5, 30, 0))).toEqual([
      { kind: 'move', point: { nx: 0.2, ny: 0.5 }, buttons: 0 },
    ])
  })

  it('pins a drag that leaves the frame to the edge', () => {
    const control = new PointerControl()
    control.handle(mouse('down', 0.9, 0.5, 0, 1))

    expect(control.handle(mouse('move', 1.2, 0.5, 16, 1, false))).toEqual([
      { kind: 'move', point: { nx: 1, ny: 0.5 }, buttons: 1 },
    ])
  })

  it('releases everything held on pointercancel', () => {
    const control = new PointerControl()
    control.handle(mouse('down', 0.5, 0.5, 0, 1))
    control.handle(mouse('move', 0.5, 0.5, 10, 5))

    const intents = control.handle(mouse('cancel', 0.5, 0.5, 20, 5))
    expect(intents.map((i) => ('button' in i ? `${i.kind}:${i.button}` : i.kind))).toEqual([
      'up:left',
      'up:middle',
    ])
    expect(control.getButtons()).toBe(0)
  })

  it('ignores the touch pointer mode', () => {
    const control = new PointerControl()
    control.setMode('direct')
    expect(kinds(control.handle(mouse('move', 0.5, 0.5, 0, 0)))).toEqual(['move'])
  })
})

describe('scrolling', () => {
  it('scrolls at the pointer, carrying the held buttons', () => {
    const control = new PointerControl()
    control.handle(mouse('down', 0.5, 0.5, 0, 1))

    expect(control.handleWheel({ frame: { nx: 0.4, ny: 0.6, inFrame: true }, dx: 0, dy: 100 })).toEqual([
      { kind: 'scroll', point: { nx: 0.4, ny: 0.6 }, buttons: 1, dx: 0, dy: 100 },
    ])
    expect(control.getCursor()).toEqual({ nx: 0.4, ny: 0.6 })
  })

  it('moves the cursor to the wheel even in touch trackpad mode', () => {
    // Whatever the desktop scrolls is whatever is under its cursor.
    const control = new PointerControl()
    const [intent] = control.handleWheel({ frame: { nx: 0.1, ny: 0.2, inFrame: true }, dx: 30, dy: 0 })
    expect(intent.point).toEqual({ nx: 0.1, ny: 0.2 })
  })

  it('pins a scroll over a letterbox bar to the edge', () => {
    const control = new PointerControl()
    const [intent] = control.handleWheel({ frame: { nx: 1.1, ny: 0.5, inFrame: false }, dx: 0, dy: -100 })
    expect(intent.point).toEqual({ nx: 1, ny: 0.5 })
  })

  it('sends nothing for an empty delta or before a frame decodes', () => {
    const control = new PointerControl()
    expect(control.handleWheel({ frame: { nx: 0.5, ny: 0.5, inFrame: true }, dx: 0, dy: 0 })).toEqual([])
    expect(control.handleWheel({ frame: null, dx: 0, dy: 100 })).toEqual([])
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

  it('releases every held mouse button on teardown, not only left', () => {
    const control = new PointerControl()
    control.handle(mouse('down', 0.5, 0.5, 0, 2))
    control.handle(mouse('move', 0.5, 0.5, 10, 6))

    const intents = control.abandon()
    expect(intents).toMatchObject([
      { kind: 'up', button: 'right', buttons: 4 },
      { kind: 'up', button: 'middle', buttons: 0 },
    ])
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
