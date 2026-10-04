/* Input wire vocabulary, hand-mirrored from shared/schemas/input/.
 *
 * Its own file, not part of protocol/types.ts, for the same reason it is its
 * own catalog in shared/: these messages never touch signaling-server. They go
 * phone → desktop on the WebRTC DataChannel and nowhere else.
 *
 * Same caveat as protocol/types.ts — until codegen is wired up, nothing but
 * review keeps this and the schemas in step. */

import type { NormalisedPoint } from '../lib/normalise'

export const POINTER_BUTTONS = ['left', 'right', 'middle'] as const
export type PointerButton = (typeof POINTER_BUTTONS)[number]

/**
 * Bitmask values, matching DOM `MouseEvent.buttons` — which is where they come
 * from — and `kMaskLeft`/`kMaskRight`/`kMaskMiddle` on the host, which is where
 * they go. One numbering end to end, so nothing translates.
 */
export const BUTTON_MASK: Record<PointerButton, number> = { left: 1, right: 2, middle: 4 }

/**
 * What the user did, in desktop terms rather than touch terms.
 *
 * The gesture layer produces these and the session client sends them. That
 * split is the point: deciding a double-tap is a double-click needs finger
 * timing and travel, which only the phone has, so the desktop is left as a
 * translator with nothing to infer.
 */
export type PointerIntent =
  | {
      kind: 'move'
      point: NormalisedPoint
      /** Buttons held after this event. */
      buttons: number
    }
  | {
      kind: 'down' | 'up'
      point: NormalisedPoint
      buttons: number
      button: PointerButton
      /** 1 single, 2 double, 3 triple. */
      clickCount: number
    }
  | {
      kind: 'scroll'
      point: NormalisedPoint
      buttons: number
      /**
       * CSS pixels, DOM WheelEvent signs (positive dy scrolls down), with a
       * wheel notch normalised to 100 — see {@link wheelDelta}. The only
       * delta on the wire: scrolling has no absolute state to send instead.
       */
      dx: number
      dy: number
    }

const WIRE_TYPE = {
  move: 'pointerMove',
  down: 'pointerDown',
  up: 'pointerUp',
  scroll: 'scroll',
} as const

/** One wheel notch, in the pixels the wire carries. Chrome and Edge report it
 * as 100 already; line-mode senders (Firefox) report 3 lines. */
export const WHEEL_NOTCH_PX = 100
const LINE_PX = WHEEL_NOTCH_PX / 3
const PAGE_PX = 800

/** A WheelEvent's delta in wire pixels, whatever `deltaMode` it came in. */
export function wheelDelta(event: {
  deltaX: number
  deltaY: number
  deltaMode: number
}): { dx: number; dy: number } {
  const scale = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? PAGE_PX : 1
  return { dx: event.deltaX * scale, dy: event.deltaY * scale }
}

/** The schema's bound, so a runaway accumulation never becomes a rejected message. */
const MAX_SCROLL = 10000

function clampScroll(value: number): number {
  return Math.max(-MAX_SCROLL, Math.min(MAX_SCROLL, Math.round(value * 100) / 100))
}

/**
 * Four decimal places: 1/10000 of a screen is a fifth of a pixel on a 1920-wide
 * desktop, so this is below what the user can point at, and it keeps a sample
 * around 80 bytes. The channel shares one DTLS transport with the video, and at
 * one sample per frame every byte here is a byte not carrying picture.
 */
function round(value: number): number {
  return Math.round(value * 1e4) / 1e4
}

export function encodePointerMessage(intent: PointerIntent, seq: number, at: number): string {
  const message: Record<string, unknown> = {
    type: WIRE_TYPE[intent.kind],
    seq,
    t: at,
    nx: round(intent.point.nx),
    ny: round(intent.point.ny),
    buttons: intent.buttons,
  }

  if (intent.kind === 'down' || intent.kind === 'up') {
    message.button = intent.button
    message.clickCount = intent.clickCount
  } else if (intent.kind === 'scroll') {
    message.dx = clampScroll(intent.dx)
    message.dy = clampScroll(intent.dy)
  }

  return JSON.stringify(message)
}

/**
 * One physical key going down or up, for the `keys` channel — ordered and
 * reliable, unlike everything above (shared/schemas/input/key.schema.json).
 *
 * `code` is `KeyboardEvent.code`, a position. The desktop's own layout decides
 * the character, so this never carries one.
 */
export interface KeyIntent {
  kind: 'down' | 'up'
  code: string
  /** An autorepeat from the sender's OS. Only meaningful on `down`. */
  repeat: boolean
}

export function encodeKeyMessage(intent: KeyIntent, at: number): string {
  const message: Record<string, unknown> = {
    type: intent.kind === 'down' ? 'keyDown' : 'keyUp',
    code: intent.code,
    t: at,
  }
  if (intent.kind === 'down' && intent.repeat) message.repeat = true
  return JSON.stringify(message)
}

/**
 * The desktop's OS, from the one desktop → phone message on an input channel
 * (shared/schemas/input/hostInfo.schema.json). `mac` is the Command family;
 * the other two are the Control family. Null until the host has said.
 */
export const HOST_PLATFORMS = ['windows', 'mac', 'linux'] as const
export type HostPlatform = (typeof HOST_PLATFORMS)[number]

/**
 * The host's `hostInfo` hello, or null for anything else. Anything else
 * includes garbage: the peer is untrusted, so an unknown platform is ignored
 * rather than guessed at — the phone then translates nothing, which is what
 * it did before the message existed.
 */
export function parseHostInfo(data: unknown): HostPlatform | null {
  if (typeof data !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const message = parsed as Record<string, unknown>
  if (message.type !== 'hostInfo') return null
  return (HOST_PLATFORMS as readonly unknown[]).includes(message.platform)
    ? (message.platform as HostPlatform)
    : null
}
