import { useSyncExternalStore } from 'react'
import type { PointerMode, QualityPriority } from '../session/types'

/* Local preferences.
 *
 * Every one of these is a decision this phone makes on its own — nothing here
 * is sent to the desktop or the server, which is why it can exist before
 * either of them does. Settings that DO need the far end (the quality ladder,
 * display choice) are rendered read-only in Settings rather than stored here,
 * so the app never remembers a preference it cannot honour.
 */

const KEY = 'remotehost.prefs'

export interface Prefs {
  /** Screen Wake Lock while a session is streaming. */
  wakeLock: boolean
  /** Open the stats overlay as soon as media starts. */
  showStats: boolean
  /** A short vibration when a tap is sent. */
  haptics: boolean
  /** Viewer chrome auto-hide delay, ms. 0 keeps it up. */
  hideChromeAfterMs: number
  /** Default pointer model for new sessions. */
  pointerMode: PointerMode
  /** Remembered so the viewer's control opens where the user left it. */
  qualityPriority: QualityPriority
}

export const HIDE_DELAYS = [
  { value: 2000, label: '2 seconds' },
  { value: 3000, label: '3 seconds' },
  { value: 5000, label: '5 seconds' },
  { value: 0, label: 'Never' },
] as const

const DEFAULTS: Prefs = {
  wakeLock: true,
  showStats: false,
  haptics: true,
  hideChromeAfterMs: 3000,
  pointerMode: 'trackpad',
  qualityPriority: 'auto',
}

const listeners = new Set<() => void>()
let cache: Prefs | null = null

function read(): Prefs {
  let stored: unknown
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    stored = null
  }
  if (typeof stored !== 'object' || stored === null) return DEFAULTS

  // Merged key by key so an unknown or malformed field falls back to its
  // default instead of poisoning the whole object.
  const partial = stored as Partial<Prefs>
  return {
    wakeLock: typeof partial.wakeLock === 'boolean' ? partial.wakeLock : DEFAULTS.wakeLock,
    showStats: typeof partial.showStats === 'boolean' ? partial.showStats : DEFAULTS.showStats,
    haptics: typeof partial.haptics === 'boolean' ? partial.haptics : DEFAULTS.haptics,
    hideChromeAfterMs: HIDE_DELAYS.some((d) => d.value === partial.hideChromeAfterMs)
      ? (partial.hideChromeAfterMs as number)
      : DEFAULTS.hideChromeAfterMs,
    pointerMode:
      partial.pointerMode === 'direct' || partial.pointerMode === 'trackpad'
        ? partial.pointerMode
        : DEFAULTS.pointerMode,
    qualityPriority:
      partial.qualityPriority === 'smooth' ||
      partial.qualityPriority === 'sharp' ||
      partial.qualityPriority === 'auto'
        ? partial.qualityPriority
        : DEFAULTS.qualityPriority,
  }
}

export function getPrefs(): Prefs {
  if (cache === null) cache = read()
  return cache
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  const next = { ...getPrefs(), [key]: value }
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage disabled: the change still applies for this session.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs)
}

// A second tab — or the same app open in another window — changes the same
// keys, and the cache here would otherwise outlive them.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== KEY) return
    cache = null
    for (const listener of listeners) listener()
  })
}

/** Tests only. */
export function resetPrefsForTest(): void {
  cache = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener()
}
