/* The phone's on-screen keyboard → text and key intents for the desktop.
 *
 * A soft keyboard has no positions to send. What it produces is *text*, and
 * not keystroke by keystroke: a word is autocorrected after the fact, a swipe
 * lands a whole word, a prediction replaces a half-typed one, an IME composes
 * for a while and then commits. The only reliable view of all that is the
 * textarea it types into. So the viewer keeps a hidden textarea focused, and
 * this class turns each change to that textarea into what the desktop has to
 * do to match: so many Backspaces, so many Deletes, then this text.
 *
 * The textarea is never cleared after a keystroke. Clearing it would make the
 * keyboard forget the word it is in the middle of — no autocorrect, no
 * predictions, a capital at the start of every letter. Instead each change is
 * diffed against the last one, and the content is only reset when the context
 * is stale anyway: after Enter, after a key sent some other way (the remote
 * caret moved), and when it has grown long.
 *
 * Padding: the content is wrapped in PAD spaces on each side. Without them a
 * Backspace on an empty textarea changes nothing and is lost; with them it
 * eats a space, and that is the diff. Spaces, because they are the one thing
 * the keyboard's own correction and capitalisation treat as "nothing here".
 *
 * Pure and framework-free, like KeyboardControl, so every rule is testable
 * without a DOM. */

import { MAX_TEXT_LENGTH } from '../protocol/input'

/** Spaces kept on each side of the content. Four survive a few stray deletes. */
export const PAD = 4

/** Reset past this many characters (never mid-composition). */
export const RESET_LENGTH = 1000

/** The keys a soft keyboard sends as something other than a character. */
export type EditKey = 'Backspace' | 'Delete' | 'Enter' | 'Tab'

export type ComposerIntent = { kind: 'text'; text: string } | { kind: 'key'; code: EditKey }

/** What the textarea should hold: its value and where the caret is. */
export interface ComposerState {
  value: string
  caret: number
}

export interface ComposerResult {
  intents: ComposerIntent[]
  /** Content to write back into the textarea, or null to leave it alone. */
  write: ComposerState | null
}

const BASELINE: ComposerState = { value: ' '.repeat(PAD * 2), caret: PAD }

/**
 * True where the on-screen keyboard is the keyboard: a phone or a tablet.
 * A desktop browser with a mouse keeps typing through the window listener,
 * by position, exactly as before — focusing a textarea there would turn
 * every physical key into text and lose the shortcuts.
 */
export function prefersSoftKeyboard(
  matchMedia: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia,
): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}

/** The shape of a KeyboardEvent this cares about. */
export interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing: boolean
}

/**
 * Whether a key event aimed at the composer's textarea should be left to the
 * textarea — so the change shows up as a diff — rather than forwarded as a
 * physical key. Everything the soft keyboard itself produces stays: the
 * characters, the edits, and the events with no position at all (an IME in
 * progress, Android's "Unidentified"). What is forwarded is what the textarea
 * would do the wrong thing with: Tab would move focus, arrows would move the
 * local caret, Escape and function keys do nothing, and a chord from a
 * hardware keyboard is a shortcut, not text.
 */
export function composerKeepsKey(event: KeyLike): boolean {
  if (event.isComposing || event.key === 'Process' || event.key === 'Unidentified') return true
  if (event.code === '') return true
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  if (event.key.length === 1 || event.key === 'Dead') return true
  return event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter'
}

/** Longest common prefix of `a` and `b`, at most `limit`. */
function commonPrefix(a: string, b: string, limit: number): number {
  let n = 0
  while (n < limit && a.charCodeAt(n) === b.charCodeAt(n)) n++
  return n
}

/** Longest common suffix of `a` and `b`, at most `limit`. */
function commonSuffix(a: string, b: string, limit: number): number {
  let n = 0
  while (n < limit && a.charCodeAt(a.length - 1 - n) === b.charCodeAt(b.length - 1 - n)) n++
  return n
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff
}

/**
 * Splits inserted text into runs the wire accepts: line breaks and tabs become
 * key presses (the host refuses control characters in text), and a run is
 * never longer than one message or cut between the halves of an emoji.
 */
export function textIntents(inserted: string): ComposerIntent[] {
  const out: ComposerIntent[] = []
  let run = ''
  const flush = () => {
    if (run.length > 0) out.push({ kind: 'text', text: run })
    run = ''
  }
  // Windows line endings from a paste are one Enter, not two.
  const text = inserted.replace(/\r\n?/g, '\n')
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if (unit === 0x0a || unit === 0x09) {
      flush()
      out.push({ kind: 'key', code: unit === 0x0a ? 'Enter' : 'Tab' })
      continue
    }
    if (unit < 0x20 || unit === 0x7f) continue
    const pair = isHighSurrogate(unit) && i + 1 < text.length
    if (run.length + (pair ? 2 : 1) > MAX_TEXT_LENGTH) flush()
    run += pair ? text.slice(i, i + 2) : text[i]
    if (pair) i++
  }
  flush()
  return out
}

export class TextComposer {
  private value = BASELINE.value
  private caret = BASELINE.caret
  private composing = false

  /** Forget the content. Returns what to put in the textarea. */
  reset(): ComposerState {
    this.value = BASELINE.value
    this.caret = BASELINE.caret
    this.composing = false
    return { ...BASELINE }
  }

  /**
   * An IME is composing: the textarea's content is its working area and must
   * not be rewritten under it. Diffs still flow, so the desktop shows the
   * pre-edit text live; the commit is just another diff.
   */
  setComposing(composing: boolean): void {
    this.composing = composing
  }

  isComposing(): boolean {
    return this.composing
  }

  /** For tests and the UI. */
  getState(): ComposerState {
    return { value: this.value, caret: this.caret }
  }

  /**
   * The textarea changed. `caret` is `selectionStart` afterwards: it is what
   * tells a Backspace from a Delete when all that is around is padding.
   *
   * Any edit replaces one span of the old value with one span of the new, and
   * that span ends at the new caret. So the suffix the two share runs at most
   * from the new caret to the end, and the prefix at most up to it; what is
   * between is what was removed (before the old caret: Backspaces, after it:
   * Deletes) and what was inserted (text, with its line breaks as Enters).
   */
  handleInput(value: string, caret: number | null): ComposerResult {
    const last = this.value
    const lastCaret = this.caret
    const at = Math.max(0, Math.min(caret ?? value.length, value.length))

    const suffix = commonSuffix(last, value, Math.min(value.length - at, last.length))
    const prefix = commonPrefix(last, value, Math.min(at, last.length - suffix))

    const removedEnd = last.length - suffix
    const backspaces = Math.max(0, Math.min(lastCaret, removedEnd) - prefix)
    const deletes = Math.max(0, removedEnd - Math.max(lastCaret, prefix))
    const inserted = value.slice(prefix, value.length - suffix)

    const intents: ComposerIntent[] = []
    for (let i = 0; i < backspaces; i++) intents.push({ kind: 'key', code: 'Backspace' })
    for (let i = 0; i < deletes; i++) intents.push({ kind: 'key', code: 'Delete' })
    intents.push(...textIntents(inserted))

    this.value = value
    this.caret = at

    if (this.composing) return { intents, write: null }

    // The context is stale after a line break — the remote caret is on a new
    // line, and the keyboard's idea of "the current word" is behind it — and
    // not worth keeping past a page of text.
    if (/[\n\r]/.test(inserted) || value.length > RESET_LENGTH) {
      return { intents, write: this.reset() }
    }
    return { intents, write: this.repad() }
  }

  /**
   * Restore the padding where a delete has eaten into it. Nothing is sent for
   * this: the spaces are ours, not the user's.
   */
  private repad(): ComposerState | null {
    if (/^ *$/.test(this.value)) {
      // Nothing but padding left. Enough of it is fine as it is; less than
      // the full set means a delete ate some, and the baseline puts it back.
      return this.value.length >= PAD * 2 ? null : this.reset()
    }
    let leading = 0
    while (this.value[leading] === ' ') leading++
    let trailing = 0
    while (this.value[this.value.length - 1 - trailing] === ' ') trailing++
    const addFront = Math.max(0, PAD - leading)
    const addBack = Math.max(0, PAD - trailing)
    if (addFront === 0 && addBack === 0) return null
    this.value = ' '.repeat(addFront) + this.value + ' '.repeat(addBack)
    this.caret += addFront
    return { value: this.value, caret: this.caret }
  }
}
