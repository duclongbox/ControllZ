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

const WIRE_TYPE = { move: 'pointerMove', down: 'pointerDown', up: 'pointerUp' } as const

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

  if (intent.kind !== 'move') {
    message.button = intent.button
    message.clickCount = intent.clickCount
  }

  return JSON.stringify(message)
}
