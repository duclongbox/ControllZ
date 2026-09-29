/* Browser keyboard events → key intents for the desktop.
 *
 * Keys cross the wire as POSITIONS (`KeyboardEvent.code`), never characters:
 * the desktop maps the position to its own key and its own layout decides what
 * it types, exactly like a keyboard plugged into it. That is what keeps two
 * machines with different layouts correct without either knowing the other's.
 *
 * What is left for this side is undoing the browser's lies. Each OS reports
 * some keys in a way that, forwarded as-is, leaves the desktop with a key
 * stuck down, typed twice, or pressed that nobody pressed:
 *
 *   - Mac: keyup is never delivered for a key pressed while Command is held.
 *   - Mac: CapsLock reports keydown when the lock turns on and keyup when it
 *     turns off, not press and release.
 *   - Windows: AltGr arrives as a fake ControlLeft followed by AltRight.
 *   - Everywhere: a key held while the window loses focus never gets a keyup.
 *
 * Pure and framework-free, like PointerControl, so each rule is testable
 * without a DOM. The desktop sees only real presses and releases. */

import type { KeyIntent } from '../protocol/input'

export type ClientPlatform = 'mac' | 'windows' | 'other'

/** One keyboard event from the page. */
export interface KeySample {
  type: 'keydown' | 'keyup'
  code: string
  repeat: boolean
  /** `event.timeStamp`, ms. Pairs a phantom Control with its AltGr. */
  at: number
}

const MODIFIERS = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
])

export function isModifier(code: string): boolean {
  return MODIFIERS.has(code)
}

/**
 * How long a Windows ControlLeft keydown is held back to see whether AltRight
 * follows. Windows sends the pair back to back (same timestamp in practice),
 * so this only ever delays a genuine Ctrl press, and only until the next key —
 * which flushes it at once.
 */
export const ALTGR_WINDOW_MS = 10

export function detectPlatform(nav: { platform?: string; userAgent?: string } = navigator): ClientPlatform {
  const hint = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`
  // iPad reports as Mac in desktop mode; its hardware keyboards behave like a
  // Mac's for everything handled here.
  if (/Mac|iPhone|iPad/i.test(hint)) return 'mac'
  if (/Win/i.test(hint)) return 'windows'
  return 'other'
}

export class KeyboardControl {
  private readonly platform: ClientPlatform
  /** Codes the desktop believes are down, in press order. */
  private readonly held = new Set<string>()
  /** Windows: a ControlLeft keydown not sent yet, in case it is AltGr's. */
  private pendingControl: KeySample | null = null
  /** Windows: ControlLeft is AltGr's phantom; swallow its repeats and release. */
  private phantomControl = false

  constructor(platform: ClientPlatform) {
    this.platform = platform
  }

  /** Keys currently held on the desktop. For tests and the UI. */
  getHeld(): string[] {
    return [...this.held]
  }

  /** True while a ControlLeft is being held back; the caller owes a flush. */
  hasPending(): boolean {
    return this.pendingControl !== null
  }

  handle(sample: KeySample): KeyIntent[] {
    if (!sample.code) {
      // Soft keyboards and some IMEs report no physical key. There is no
      // position to send; typing those is text entry, a separate feature.
      return []
    }

    const out: KeyIntent[] = []

    if (this.platform === 'windows') {
      if (this.pendingControl) {
        const pending = this.pendingControl
        this.pendingControl = null
        if (sample.type === 'keydown' && sample.code === 'AltRight') {
          // The AltGr pair. The Control was never pressed by anyone: dropping
          // it is what stops Ctrl+Alt+Q (a shortcut) replacing AltGr+Q (@ on
          // a German layout). The host's AltRight is its own AltGr/Option.
          this.phantomControl = true
        } else {
          out.push(...this.press(pending.code, false))
        }
      } else if (sample.type === 'keydown' && sample.code === 'ControlLeft' && !sample.repeat) {
        if (!this.held.has('ControlLeft')) {
          this.pendingControl = sample
          return out
        }
      }

      if (this.phantomControl && sample.code === 'ControlLeft') {
        // Its repeats while AltGr is held, and finally its release.
        if (sample.type === 'keyup') this.phantomControl = false
        return out
      }
    }

    if (this.platform === 'mac' && sample.code === 'CapsLock') {
      // Each event is one toggle of the lock, whichever way the browser
      // labelled it — so each becomes one full press on the desktop.
      out.push({ kind: 'down', code: 'CapsLock', repeat: false })
      out.push({ kind: 'up', code: 'CapsLock', repeat: false })
      return out
    }

    if (sample.type === 'keydown') {
      if (this.platform === 'mac' && this.commandHeld() && !isModifier(sample.code)) {
        // No keyup is coming for this key while Command is down, so it is
        // pressed and released here and never counted as held. Autorepeat
        // still works: every repeat keydown becomes its own press.
        out.push({ kind: 'down', code: sample.code, repeat: sample.repeat })
        out.push({ kind: 'up', code: sample.code, repeat: false })
        return out
      }
      out.push(...this.press(sample.code, sample.repeat))
      return out
    }

    // keyup
    if (!this.held.has(sample.code)) {
      // Never pressed as far as the desktop knows: held before the stage had
      // focus, or already released by releaseAll(). Sending it would be an
      // orphan the host has to ignore anyway.
      return out
    }
    this.held.delete(sample.code)
    out.push({ kind: 'up', code: sample.code, repeat: false })
    return out
  }

  /** Sends a ControlLeft held back for AltGr detection that turned out real. */
  flushPending(): KeyIntent[] {
    const pending = this.pendingControl
    this.pendingControl = null
    return pending ? this.press(pending.code, false) : []
  }

  /**
   * Release everything. For blur, hidden tab, a panel taking the keyboard, or
   * the session ending — every case where the keyups are never coming.
   * Modifiers last, the order a hand lets go in.
   */
  releaseAll(): KeyIntent[] {
    this.pendingControl = null
    this.phantomControl = false
    const codes = [...this.held]
    this.held.clear()
    const ordered = [...codes.filter((c) => !isModifier(c)), ...codes.filter(isModifier)]
    return ordered.map((code) => ({ kind: 'up' as const, code, repeat: false }))
  }

  private press(code: string, repeat: boolean): KeyIntent[] {
    const alreadyHeld = this.held.has(code)
    if (isModifier(code) && (repeat || alreadyHeld)) {
      // Windows repeats a held Shift; there is nothing to repeat.
      return []
    }
    this.held.add(code)
    return [{ kind: 'down', code, repeat: repeat || alreadyHeld }]
  }

  private commandHeld(): boolean {
    return this.held.has('MetaLeft') || this.held.has('MetaRight')
  }
}
