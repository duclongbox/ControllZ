import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Viewer chrome auto-hide.
 *
 * The chrome is an overlay, never part of the layout, so hiding it costs the
 * video nothing — but it must come back the instant a finger lands. Returns the
 * current visibility plus a `wake` to call on any pointer activity.
 */
export function useAutoHide(delayMs = 3000, enabled = true) {
  const [visible, setVisible] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clear = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = undefined
  }, [])

  const wake = useCallback(() => {
    setVisible(true)
    clear()
    if (enabled) timer.current = setTimeout(() => setVisible(false), delayMs)
  }, [clear, delayMs, enabled])

  const hold = useCallback(() => {
    setVisible(true)
    clear()
  }, [clear])

  useEffect(() => {
    if (!enabled) {
      clear()
      setVisible(true)
      return
    }
    wake()
    return clear
  }, [enabled, wake, clear])

  return { visible, wake, hold }
}

/** True while the viewport is taller than it is wide. */
export function useIsPortrait(): boolean {
  const [portrait, setPortrait] = useState(() =>
    typeof window === 'undefined' ? false : window.innerHeight > window.innerWidth,
  )

  useEffect(() => {
    const update = () => setPortrait(window.innerHeight > window.innerWidth)
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return portrait
}

/** Mirrors `navigator.onLine`, which is a lower bound: online can still fail. */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return online
}

/** Seconds elapsed since `startedAt`, ticking once a second. */
export function useElapsed(startedAt: number | null): number {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (startedAt === null) {
      setElapsed(0)
      return
    }
    const tick = () => setElapsed((Date.now() - startedAt) / 1000)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  return elapsed
}

/** Tracks an element's rendered size. Used to lay the cursor puck over the stage. */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      setSize({ width: box.width, height: box.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, size }
}

/**
 * True on something that is plainly not a phone: a wide viewport driven by a
 * mouse. Used only to decide what an unpaired visitor sees at `/` — the
 * marketing page, which has the desktop downloads on it, rather than a pairing
 * flow they cannot finish on the machine they are reading it on.
 *
 * Deliberately not used for layout. Layout is a media query's job.
 */
export function useIsDesktop(): boolean {
  const query = '(min-width: 900px) and (pointer: fine)'
  const [desktop, setDesktop] = useState(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? false
      : window.matchMedia(query).matches,
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const update = (event: MediaQueryListEvent) => setDesktop(event.matches)
    setDesktop(mql.matches)
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  return desktop
}

/**
 * Holds a Screen Wake Lock while `active`.
 *
 * The lock is dropped by the browser whenever the page is hidden — switching
 * apps, or the phone locking — and is NOT restored on return, so it is
 * re-acquired on every `visibilitychange`. Unsupported browsers (iOS before
 * 16.4) simply never resolve one; there is no fallback worth having.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockAPI }).wakeLock
    if (!wakeLock) return

    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return
      try {
        sentinel = await wakeLock.request('screen')
      } catch {
        // Denied, or the tab lost focus mid-request. Nothing to recover.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}

interface WakeLockSentinelLike {
  release(): Promise<void>
}

interface WakeLockAPI {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}
