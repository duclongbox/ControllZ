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
