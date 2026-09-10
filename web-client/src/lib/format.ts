/* Display formatting for the stats overlay and session summaries.
 *
 * These all produce fixed-width-ish output on purpose: the stats overlay
 * refreshes at 1 Hz, and a value that changes digit count every tick is
 * unreadable while you are dragging a window. */

/** Bits per second → "11.8M" / "820k". */
export function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0'
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)}M`
  if (bps >= 1_000) return `${Math.round(bps / 1_000)}k`
  return String(Math.round(bps))
}

/** Milliseconds → "38ms". */
export function formatMs(ms: number, digits = 0): string {
  if (!Number.isFinite(ms)) return '—'
  return `${ms.toFixed(digits)}ms`
}

/** Fractional loss (0…1) → "0.02%". */
export function formatLoss(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(2)}%`
}

/** Seconds → "12:04" / "1:02:11". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`
}

/** Countdown seconds → "4:12", for the pairing-code expiry. */
export function formatCountdown(seconds: number): string {
  return formatDuration(Math.max(0, seconds))
}

/** "1920×1080" — the multiplication sign, not an ASCII x. */
export function formatResolution(width: number, height: number): string {
  return `${width}×${height}`
}

/** A coarse "how long ago" for device lists. Deliberately vague. */
export function formatRelative(isoTimestamp: string, now = Date.now()): string {
  const then = Date.parse(isoTimestamp)
  if (Number.isNaN(then)) return 'unknown'
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}
