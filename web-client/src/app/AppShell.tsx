import { useEffect, useState } from 'react'
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

function InstallSheet({ onDismiss }: { onDismiss: () => void }) {
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
          <Button label="Add to home screen" full onClick={onDismiss} />
          <Button label="Not now" variant="ghost" full onClick={onDismiss} />
        </div>
      </div>
    </>
  )
}

export function AppShell() {
  const online = useIsOnline()
  const portrait = useIsPortrait()
  const location = useLocation()
  const [installOpen, setInstallOpen] = useState(false)

  // M5 wires this to a real `beforeinstallprompt`; for now it never fires, so
  // the sheet is reachable only from the dev gallery.
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setInstallOpen(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const inSession = location.pathname.startsWith('/session/')

  return (
    <>
      <Outlet />
      {inSession && portrait ? <RotateCover /> : null}
      {!online ? <OfflineCover /> : null}
      {installOpen ? <InstallSheet onDismiss={() => setInstallOpen(false)} /> : null}
    </>
  )
}

export { InstallSheet, OfflineCover, RotateCover }
