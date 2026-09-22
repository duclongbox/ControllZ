import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { cn } from '../lib/cn'
import { useIsOnline, useIsPortrait } from '../lib/hooks'
import styles from './overlays.module.css'

/* System states that can interrupt any screen.
 *
 * These are overlays rather than routes on purpose: they are conditions, not
 * destinations. Losing the network mid-session should not push a history entry
 * you then have to press Back through. */

function OfflineCover() {
  return (
    <div className={styles.cover}>
      <EmptyState icon="wifi" tone="warn" title="No connection">
        This phone is offline. Your paired computers are still there — nothing was lost.
      </EmptyState>
      <Button
        label="Try again"
        variant="secondary"
        icon="refresh"
        onClick={() => window.location.reload()}
      />
    </div>
  )
}

function RotateCover() {
  return (
    <div className={cn(styles.cover, styles.rotate)}>
      <div className={styles.phone}>
        <span className={styles.rotateIcon}>
          <Icon name="rotate" size={26} strokeWidth={2} />
        </span>
      </div>
      <span className={styles.title}>Turn your phone sideways</span>
      <p className={styles.body}>
        A desktop is wider than it is tall. Landscape gives the stream every pixel we have.
      </p>
    </div>
  )
}

function InstallSheet({
  onDismiss,
  onInstall,
}: {
  onDismiss: () => void
  /** Absent in the dev gallery, where there is no real prompt to accept. */
  onInstall?: () => void
}) {
  return (
    <>
      <div className={styles.scrim} onClick={onDismiss} />
      <div className={styles.sheet} role="dialog" aria-label="Add to home screen">
        <span className={styles.grabber} />
        <div className={styles.sheetHead}>
          <span className={styles.appIcon}>
            <Icon name="monitor" size={26} />
          </span>
          <span className={styles.sheetText}>
            <span className={styles.sheetTitle}>Add RemoteHost to your home screen</span>
            <span className={styles.sheetBody}>
              Full screen, landscape lock, and it opens straight into your computers.
            </span>
          </span>
        </div>
        <div className={styles.sheetActions}>
          <Button label="Add to home screen" full onClick={onInstall ?? onDismiss} />
          <Button label="Not now" variant="ghost" full onClick={onDismiss} />
        </div>
      </div>
    </>
  )
}

/** Chrome's deferred install prompt. Not in lib.dom, and absent on iOS entirely. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'remotehost.installDismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    /* storage disabled: the prompt may reappear next launch, which is survivable */
  }
}

export function AppShell() {
  const online = useIsOnline()
  const portrait = useIsPortrait()
  const location = useLocation()
  const [installOpen, setInstallOpen] = useState(false)
  const deferred = useRef<InstallPromptEvent | null>(null)
  const main = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Chrome shows its own mini-infobar unless the event is preventDefault'd;
      // holding it lets the app ask at a moment that makes sense instead.
      event.preventDefault()
      deferred.current = event as InstallPromptEvent
      if (!wasDismissed()) setInstallOpen(true)
    }
    const onInstalled = () => {
      deferred.current = null
      setInstallOpen(false)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(() => {
    const event = deferred.current
    setInstallOpen(false)
    rememberDismissed()
    if (!event) return
    deferred.current = null
    void event.prompt().catch(() => {})
  }, [])

  const dismiss = useCallback(() => {
    rememberDismissed()
    setInstallOpen(false)
  }, [])

  // A router navigation changes what is on screen without touching focus, so a
  // screen reader is left parked on the control that was just tapped — on a
  // screen that no longer exists. Moving focus to the top of the new screen
  // fixes that, but only where the new screen did not place focus itself:
  // child effects run before this one, so a screen with an autofocused control
  // (the pairing code, the rename field) has already claimed it, and taking it
  // back would mean the keyboard types into nothing. Scroll needs no reset —
  // every screen owns its scroll container and mounts fresh at the top.
  useEffect(() => {
    const active = document.activeElement
    if (active && active !== document.body && main.current?.contains(active)) return
    main.current?.focus({ preventScroll: true })
  }, [location.pathname])

  const inSession = location.pathname.startsWith('/session/')

  return (
    <>
      <div ref={main} tabIndex={-1} className={styles.main}>
        <Outlet />
      </div>
      {inSession && portrait ? <RotateCover /> : null}
      {!online ? <OfflineCover /> : null}
      {installOpen ? <InstallSheet onDismiss={dismiss} onInstall={install} /> : null}
    </>
  )
}

export { InstallSheet, OfflineCover, RotateCover }
