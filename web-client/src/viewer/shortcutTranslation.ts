/* Cmd ⇄ Ctrl, and what the browser keeps for itself.
 *
 * Keys cross the wire as positions, and Command on a Mac keyboard is the same
 * position as the Windows key on a PC one (`MetaLeft`). So a Mac user pressing
 * Cmd+C at a Windows desktop sends Win+C, which does nothing, and a Windows
 * user pressing Ctrl+C at a Mac sends Control+C, which is not copy. The fix is
 * the one every remote desktop makes: when exactly one side is a Mac, Meta and
 * Control trade places. The host never remaps — it stays a position mapper —
 * so the decision is made here, on the phone, where the preference lives.
 *
 * The swap runs on the intents KeyboardControl has already cleaned up, not on
 * the raw browser events: the Mac quirk rules in there (no keyup under
 * Command) key off the real Command key, and must keep doing so.
 *
 * Pure and framework-free, like KeyboardControl, so every rule is testable
 * without a DOM. */

import type { HostPlatform, KeyIntent } from '../protocol/input'
import type { ShortcutModifiers } from '../session/types'
import type { ClientPlatform } from './keyboardControl'
import { isModifier } from './keyboardControl'

/** Left stays left, right stays right: a swapped chord is still one hand. */
const SWAP: Record<string, string> = {
  MetaLeft: 'ControlLeft',
  ControlLeft: 'MetaLeft',
  MetaRight: 'ControlRight',
  ControlRight: 'MetaRight',
}

function isCommandFamily(platform: ClientPlatform | HostPlatform): boolean {
  return platform === 'mac'
}

/**
 * Whether Meta and Control should trade places for this pairing. `auto` is a
 * swap exactly when the two sides disagree about which key carries shortcuts;
 * an unknown host (null — it has not said, or is too old to say) swaps
 * nothing, which is what every key did before `hostInfo` existed.
 */
export function shouldSwapModifiers(
  mode: ShortcutModifiers,
  client: ClientPlatform,
  host: HostPlatform | null,
): boolean {
  if (mode === 'swap') return true
  if (mode === 'off') return false
  if (host === null) return false
  return isCommandFamily(client) !== isCommandFamily(host)
}

/** One intent with its modifier translated, or the same intent when no swap. */
export function translateIntent(intent: KeyIntent, swap: boolean): KeyIntent {
  if (!swap) return intent
  const code = SWAP[intent.code]
  return code === undefined ? intent : { ...intent, code }
}

/** The modifier the browser builds its own shortcuts on, by position. */
export function browserShortcutModifiers(client: ClientPlatform): readonly string[] {
  return client === 'mac' ? ['MetaLeft', 'MetaRight'] : ['ControlLeft', 'ControlRight']
}

/**
 * The chords a page is never allowed to cancel, in the words the user would
 * read them in. Pressing one of these does what it says to the browser, never
 * to the desktop, however the page handles the keydown — and most of them
 * never reach the page at all.
 */
export function reservedShortcutLabels(client: ClientPlatform): readonly string[] {
  return client === 'mac'
    ? ['⌘W', '⌘T', '⌘N', '⌘Q', '⌘Tab']
    : ['Ctrl+W', 'Ctrl+T', 'Ctrl+N', 'Alt+Tab']
}

/**
 * True when the window losing focus with these keys held was most likely a
 * shortcut the browser or OS took for itself (Ctrl+T opened a tab, Alt+Tab
 * switched apps): a bare letter held across a blur is just a hand resting on
 * the keyboard, a modifier is a chord that went somewhere.
 */
export function escapedToBrowser(held: readonly string[]): boolean {
  return held.some(isModifier)
}
