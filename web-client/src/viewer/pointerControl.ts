/* Touch gestures → pointer intents.
 *
 * THE PHONE OWNS THE CURSOR. Both modes send absolute normalised positions, so
 * every packet stays self-contained and the host accumulates nothing — the same
 * reason coordinates are normalised in the first place (docs/ui-spec.md §4).
 * Trackpad mode accumulates finger deltas into a cursor *here*, where the state
 * is safe, rather than sending deltas the host would have to add up across a
 * channel that loses and reorders them.
 *
 * The cost of that choice, worth writing down: the desktop's real cursor can be
 * moved by the person sitting at it, and this one will not know. Cursor
 * feedback from the host is deferred.
 *
 * Pure and framework-free on purpose. Every rule below is a judgement call
 * about what a touch means, and they are all testable without a DOM. */

import { clamp01, clampPoint } from '../lib/normalise'
import type { FramePoint, NormalisedPoint } from '../lib/normalise'
import { BUTTON_MASK } from '../protocol/input'
import type { PointerButton, PointerIntent } from '../protocol/input'
import type { PointerMode } from '../session/types'

/** One pointer event from the stage, already mapped into frame space. */
export interface StagePointerSample {
  kind: 'down' | 'move' | 'up' | 'cancel'
  /** Null until a frame has decoded — there is nothing to map against yet. */
  frame: FramePoint | null
  /** `event.timeStamp`, ms. */
  at: number
  /** `event.pointerType`. Absent is read as touch, which is what the gestures were built for. */
  pointerType?: string
  /**
   * `event.buttons` — the full mask held after this event. Only the mouse path
   * reads it; a finger has no buttons to report.
   */
  buttons?: number
}

/** One wheel event from the stage, delta already in wire pixels. */
export interface StageWheelSample {
  /** Null until a frame has decoded. */
  frame: FramePoint | null
  dx: number
  dy: number
}

export interface PointerControlOptions {
  /** Cursor travel per unit of finger travel, trackpad mode only. */
  sensitivity?: number
  /** Longest gap between taps that still counts as one chain, ms. */
  chainWindowMs?: number
  /** Furthest two taps of one chain may be apart, in frame fractions. */
  chainSlop?: number
  /** Finger travel past this ends a tap and makes it a slide instead. */
  tapSlop?: number
  /** A press held longer than this is not a tap. */
  tapMaxMs?: number
  /** Longest gap between mouse clicks that still counts as one chain, ms. */
  mouseChainWindowMs?: number
  /** Furthest two mouse clicks of one chain may be apart, in frame fractions. */
  mouseChainSlop?: number
}

const DEFAULTS = {
  sensitivity: 1,
  // 300ms rather than the ~500ms a desktop double-click allows: a deliberate
  // double-tap on glass is faster than a double-click on a mouse, and a longer
  // window makes two intentional single taps merge into one double.
  chainWindowMs: 300,
  // ~3% of the frame. Generous next to a mouse's few pixels, because a finger
  // does not land twice in the same place.
  chainSlop: 0.03,
  // ~1% of the frame, about 8px on a landscape phone: under the width of a
  // fingertip's wobble, over the jitter of holding still.
  tapSlop: 0.012,
  tapMaxMs: 350,
  // A mouse is the device the desktop's own double-click timing was designed
  // for, so it gets the desktop's numbers: ~500ms (the Windows and macOS
  // default) and a few pixels of slop rather than a fingertip's worth.
  mouseChainWindowMs: 500,
  mouseChainSlop: 0.004,
}

const BUTTON_ORDER: readonly PointerButton[] = ['left', 'right', 'middle']

interface Gesture {
  startedAt: number
  /** Last frame-space position seen, for trackpad deltas. */
  lastFrame: FramePoint
  travel: number
  /** True once a button went down for this gesture (direct mode). */
  pressed: boolean
  clickCount: number
  /** A down in a letterbox bar: not a desktop interaction, ignore the rest. */
  ignored: boolean
}

function distance(a: NormalisedPoint, b: NormalisedPoint): number {
  return Math.hypot(a.nx - b.nx, a.ny - b.ny)
}

export class PointerControl {
  private readonly options: Required<PointerControlOptions>
  private mode: PointerMode = 'trackpad'
  private cursor: NormalisedPoint = { nx: 0.5, ny: 0.5 }
  private buttons = 0
  private gesture: Gesture | null = null
  private lastTap: { at: number; point: NormalisedPoint; count: number } | null = null
  /** Mouse only: buttons pressed on a letterbox bar, ignored until released. */
  private ignoredButtons = 0
  /** Mouse only: the click count each held button went down with, for its `up`. */
  private readonly mouseClickCounts: Record<PointerButton, number> = {
    left: 1,
    right: 1,
    middle: 1,
  }
  private lastMouseClick: {
    at: number
    point: NormalisedPoint
    count: number
    button: PointerButton
  } | null = null

  constructor(options: PointerControlOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  /** Where the phone believes the pointer is. Drives the cursor puck. */
  getCursor(): NormalisedPoint {
    return this.cursor
  }

  getButtons(): number {
    return this.buttons
  }

  /**
   * Switching modes mid-gesture abandons it, so anything held has to be let go
   * — otherwise the desktop keeps a button down that no later gesture will
   * release.
   */
  setMode(mode: PointerMode): PointerIntent[] {
    if (mode === this.mode) return []
    this.mode = mode
    return this.abandon()
  }

  /** Release everything. For unmount, session end, or losing the channel. */
  abandon(): PointerIntent[] {
    this.gesture = null
    this.ignoredButtons = 0
    // Every held button, not just left: a mouse can be holding right or middle,
    // and each one stranded is a desktop stuck mid-drag.
    return this.transitionTo(0, this.cursor, false)
  }

  handle(sample: StagePointerSample): PointerIntent[] {
    if (!sample.frame) return []
    // A mouse ignores the pointer mode. Trackpad and direct are two answers to
    // "what does a finger mean"; a mouse already says what it means, and
    // running it through tap detection is what made slow clicks vanish.
    if (sample.pointerType === 'mouse') return this.handleMouse(sample)
    return this.mode === 'direct' ? this.handleDirect(sample) : this.handleTrackpad(sample)
  }

  /**
   * A wheel or touchpad scroll, at the pointer. Scroll only comes from a mouse
   * or touchpad, which has a real position, so the cursor goes there whatever
   * the touch mode — the desktop scrolls whatever is under its cursor, and
   * that has to be what is under the user's.
   */
  handleWheel(sample: StageWheelSample): PointerIntent[] {
    if (!sample.frame || (sample.dx === 0 && sample.dy === 0)) return []
    this.cursor = clampPoint(sample.frame)
    return [
      { kind: 'scroll', point: this.cursor, buttons: this.buttons, dx: sample.dx, dy: sample.dy },
    ]
  }

  // -- mouse: passed straight through ---------------------------------------

  private handleMouse(sample: StagePointerSample): PointerIntent[] {
    const frame = sample.frame as FramePoint
    // `cancel` has no trustworthy mask — the browser took the pointer away —
    // so it is read as "nothing held", which is the only safe place to leave
    // the desktop.
    const reported = sample.kind === 'cancel' ? 0 : (sample.buttons ?? 0)

    // Released buttons stop being ignored whatever else happens.
    this.ignoredButtons &= reported
    if (!frame.inFrame) {
      // A press on a bar is not a desktop click, same as a tap there in
      // direct mode. Remember it so the drag it starts is not mistaken for a
      // press the moment it crosses onto the frame.
      this.ignoredButtons |= reported & ~this.buttons
    }
    const desired = reported & ~this.ignoredButtons

    // Clamped, not dropped, when off the frame — hovering or dragging alike.
    // The desktop's edges are where the Dock, the menu bar and the taskbar
    // live, and a mouse flicked past the bottom of the picture has to leave
    // the cursor on the last row, not a few pixels short where its final
    // in-frame sample happened to land.
    const point = clampPoint(frame)
    this.cursor = point

    if (desired === this.buttons) {
      return [{ kind: 'move', point, buttons: this.buttons }]
    }
    // The mask, not the event kind, decides what changed. A browser fires
    // `pointerdown` only for the first button of a chord; pressing right while
    // left is held arrives as a `pointermove` with a new mask.
    return this.transitionTo(desired, point, true, sample.at)
  }

  /**
   * Down/up intents that take the held mask from `this.buttons` to `desired`,
   * one button at a time so each intent's mask is exactly the state after it.
   * Releases go first: when a sample both drops one button and adds another,
   * the desktop never sees a moment with both held.
   */
  private transitionTo(
    desired: number,
    point: NormalisedPoint,
    countClicks: boolean,
    at = 0,
  ): PointerIntent[] {
    const intents: PointerIntent[] = []
    for (const button of BUTTON_ORDER) {
      const bit = BUTTON_MASK[button]
      if ((this.buttons & bit) === 0 || (desired & bit) !== 0) continue
      this.buttons &= ~bit
      intents.push({
        kind: 'up',
        point,
        buttons: this.buttons,
        button,
        clickCount: this.mouseClickCounts[button],
      })
      this.mouseClickCounts[button] = 1
    }
    for (const button of BUTTON_ORDER) {
      const bit = BUTTON_MASK[button]
      if ((this.buttons & bit) !== 0 || (desired & bit) === 0) continue
      this.buttons |= bit
      const clickCount = countClicks ? this.mouseChainCount(at, point, button) : 1
      this.mouseClickCounts[button] = clickCount
      intents.push({ kind: 'down', point, buttons: this.buttons, button, clickCount })
    }
    return intents
  }

  /** The mouse version of {@link chainCount}: desktop timing, per button. */
  private mouseChainCount(at: number, point: NormalisedPoint, button: PointerButton): number {
    const previous = this.lastMouseClick
    const count =
      previous &&
      previous.button === button &&
      at - previous.at <= this.options.mouseChainWindowMs &&
      distance(point, previous.point) <= this.options.mouseChainSlop
        ? Math.min(3, previous.count + 1)
        : 1
    this.lastMouseClick = { at, point, count, button }
    return count
  }

  // -- direct: the finger *is* the pointer ----------------------------------

  private handleDirect(sample: StagePointerSample): PointerIntent[] {
    const frame = sample.frame as FramePoint

    switch (sample.kind) {
      case 'down': {
        if (!frame.inFrame) {
          // A tap on a letterbox bar. Not a position on the desktop, and
          // clamping it would slide the touch onto the nearest edge — so the
          // whole gesture is ignored, including the moves that follow.
          this.gesture = this.begin(sample, frame, true)
          return []
        }
        this.cursor = clampPoint(frame)
        const clickCount = this.chainCount(sample.at, this.cursor)
        this.gesture = { ...this.begin(sample, frame, false), pressed: true, clickCount }
        this.buttons |= BUTTON_MASK.left
        return [
          {
            kind: 'down',
            point: this.cursor,
            buttons: this.buttons,
            button: 'left',
            clickCount,
          },
        ]
      }

      case 'move': {
        if (!this.gesture || this.gesture.ignored || !this.gesture.pressed) {
          // No hover on a touchscreen: without a finger down there is no
          // position to report, and a mouse moving over the stage in a desktop
          // browser should not drag the remote cursor around either.
          return []
        }
        // Clamped, not dropped: this gesture began on the frame, and a drag
        // that wanders into a bar should pin to the edge rather than freeze
        // mid-drag — which is how you reach a macOS menu bar.
        this.cursor = clampPoint(frame)
        return [{ kind: 'move', point: this.cursor, buttons: this.buttons }]
      }

      case 'up':
      case 'cancel': {
        const gesture = this.gesture
        this.gesture = null
        if (!gesture || !gesture.pressed) return []

        if (frame.inFrame) this.cursor = clampPoint(frame)
        this.buttons &= ~BUTTON_MASK.left
        // `cancel` releases too. The OS took the gesture away (a system edge
        // swipe, a call arriving); no `up` is coming, and a button left down is
        // the worst state to strand the desktop in.
        this.lastTap = { at: sample.at, point: this.cursor, count: gesture.clickCount }
        return [
          {
            kind: 'up',
            point: this.cursor,
            buttons: this.buttons,
            button: 'left',
            clickCount: gesture.clickCount,
          },
        ]
      }
    }
  }

  // -- trackpad: the finger pushes the pointer ------------------------------

  private handleTrackpad(sample: StagePointerSample): PointerIntent[] {
    const frame = sample.frame as FramePoint

    switch (sample.kind) {
      case 'down':
        // Deliberately silent. Whether this press is a click is not knowable
        // until the finger lifts: press-then-slide is a cursor move, and
        // clicking on the way down would fire it at the wrong place.
        this.gesture = this.begin(sample, frame, false)
        return []

      case 'move': {
        const gesture = this.gesture
        if (!gesture) return []

        const dx = (frame.nx - gesture.lastFrame.nx) * this.options.sensitivity
        const dy = (frame.ny - gesture.lastFrame.ny) * this.options.sensitivity
        gesture.lastFrame = frame
        gesture.travel += Math.hypot(dx, dy)

        this.cursor = { nx: clamp01(this.cursor.nx + dx), ny: clamp01(this.cursor.ny + dy) }
        return [{ kind: 'move', point: this.cursor, buttons: this.buttons }]
      }

      case 'up': {
        const gesture = this.gesture
        this.gesture = null
        if (!gesture) return []

        const held = sample.at - gesture.startedAt
        if (gesture.travel > this.options.tapSlop || held > this.options.tapMaxMs) {
          // A slide, or a long hold. The cursor already moved; there is no
          // click to report.
          return []
        }

        const clickCount = this.chainCount(sample.at, this.cursor)
        this.lastTap = { at: sample.at, point: this.cursor, count: clickCount }
        // Down and up together, at the cursor rather than at the finger. The
        // host sees an ordinary click; the tap only ever existed here.
        return [
          {
            kind: 'down',
            point: this.cursor,
            buttons: this.buttons | BUTTON_MASK.left,
            button: 'left',
            clickCount,
          },
          {
            kind: 'up',
            point: this.cursor,
            buttons: this.buttons,
            button: 'left',
            clickCount,
          },
        ]
      }

      case 'cancel':
        this.gesture = null
        return this.buttons === 0 ? [] : this.abandon()
    }
  }

  // -- shared ---------------------------------------------------------------

  private begin(sample: StagePointerSample, frame: FramePoint, ignored: boolean): Gesture {
    return {
      startedAt: sample.at,
      lastFrame: frame,
      travel: 0,
      pressed: false,
      clickCount: 1,
      ignored,
    }
  }

  /**
   * How many clicks deep this tap is. macOS needs the count on the event
   * itself — two independent clicks at the same spot are two single clicks to
   * every app that asks, so without this a double-tap opens nothing.
   */
  private chainCount(at: number, point: NormalisedPoint): number {
    const previous = this.lastTap
    if (
      previous &&
      at - previous.at <= this.options.chainWindowMs &&
      distance(point, previous.point) <= this.options.chainSlop
    ) {
      // Triple is as far as it goes: nothing on a desktop reads a quadruple
      // click, and a stray fourth tap should start a new chain, not overflow.
      return Math.min(3, previous.count + 1)
    }
    return 1
  }
}
