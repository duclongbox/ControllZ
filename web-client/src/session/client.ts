import type { PointerIntent } from '../protocol/input'
import type { QualityPriority, SessionState } from './types'

/**
 * THE SEAM.
 *
 * Every screen talks to a session through this interface and nothing else. The
 * mock driver in `mockClient.ts` implements it with timers today; M1 adds a
 * `wsClient.ts` that implements the same interface over a real WebSocket and
 * `RTCPeerConnection`, and swaps one line in `SessionProvider`. No screen
 * changes when that happens.
 *
 * Deliberately narrow: no message types leak through, no `RTCPeerConnection`,
 * no socket. A screen can only do the handful of things a user can do.
 */
export interface SessionClient {
  /** Current state, synchronously. Safe to call before any subscription. */
  getState(): SessionState

  /**
   * Subscribe to state changes. Returns an unsubscribe function. The callback
   * fires immediately with the current state so a subscriber never renders a
   * frame behind.
   */
  subscribe(listener: (state: SessionState) => void): () => void

  /** Ask to connect to a paired desktop. Drives phase → authorising. */
  connect(deviceId: string): void

  /** Hang up. Drives phase → ended. */
  end(): void

  /** M4: change what the encoder ladder optimises for. */
  setQualityPriority(priority: QualityPriority): void

  /** M2: switch captured display. Renegotiates and forces a keyframe. */
  setDisplay(displayId: string): void

  /**
   * One pointer intent, in desktop terms: a cursor position, or a click with
   * the count already decided.
   *
   * An intent rather than a raw touch, because the translation belongs on the
   * phone — `PointerControl` owns the gesture rules and the virtual cursor, and
   * the desktop is left with nothing to infer. Positions are normalised 0…1 and
   * already inside the frame; dead-zone touches never get this far.
   */
  sendPointer(intent: PointerIntent): void

  /** M2: a physical key, never a character — layouts differ per OS. */
  sendKey(kind: 'down' | 'up', code: string, modifiers: readonly string[]): void

  /** M5: network changed under us; restart ICE without tearing down the stage. */
  restartIce(): void

  /** Release timers and sockets. */
  dispose(): void
}
