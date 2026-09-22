import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DEVICES } from '../mock/devices'
import { createMockClient } from '../session/mockClient'
import { SessionProvider } from '../session/SessionProvider'
import type { SessionState } from '../session/types'
import { InstallSheet, OfflineCover, RotateCover } from '../app/AppShell'
import { ConnectRejected } from './ConnectRejected'
import { Devices } from './Devices'
import { SessionEnded } from './SessionEnded'
import { Viewer } from './Viewer'
import styles from './DevGallery.module.css'

/* A click-through index of every screen and every state.
 *
 * Development only — this route is deleted before launch. It exists because
 * there is no server yet, so several states are otherwise unreachable. */

const ROUTES: Array<[string, string, string]> = [
  ['/', 'Home · resolves by state', 'M3'],
  ['/welcome', 'Welcome', 'M3'],
  ['/pair/code', 'Pair · enter code', 'M3'],
  ['/pair/scan', 'Pair · scan QR', 'M3'],
  ['/pair/done', 'Pair · success', 'M3'],
  ['/device/dev_studio_mac', 'Device detail', 'M3'],
  ['/session/dev_studio_mac', 'Session · direct', 'M1'],
  ['/session/dev_work_pc', 'Session · relayed', 'M4'],
  ['/session/dev_living_room', 'Session · offline device', 'M3'],
  ['/settings', 'Settings', 'M5'],
  ['/landing', 'Landing page', '—'],
  ['/install', 'Install & home screen', '—'],
  ['/privacy', 'Privacy', '—'],
  ['/security', 'Security', '—'],
  ['/no-such-page', 'Not found', '—'],
]

const STATES: Array<[string, string, string]> = [
  ['devices-list', 'Devices · fixtures', 'M3'],
  ['devices-empty', 'Devices · empty', 'M3'],
  ['reject-notPaired', 'Rejected · notPaired', 'M3'],
  ['reject-desktopOffline', 'Rejected · desktopOffline', 'M3'],
  ['reject-alreadyInSession', 'Rejected · alreadyInSession', 'M3'],
  ['viewer-live', 'Viewer · live', 'M1'],
  ['viewer-relayed', 'Viewer · relayed banner', 'M4'],
  ['viewer-degraded', 'Viewer · degraded', 'M4'],
  ['viewer-reconnecting', 'Viewer · reconnecting', 'M5'],
  ['session-ended', 'Session ended', 'M1'],
  ['overlay-offline', 'Overlay · no network', 'M5'],
  ['overlay-rotate', 'Overlay · rotate hint', 'M5'],
  ['overlay-install', 'Overlay · install prompt', 'M5'],
]

function seededViewer(overrides: Partial<SessionState>) {
  const device = DEVICES[0]
  const base: Partial<SessionState> = {
    phase: 'streaming',
    device,
    activeDisplayId: device.displays[0].id,
    startedAt: Date.now() - 724_000,
    steps: [],
    ...overrides,
  }
  return base
}

function FrozenViewer({ overrides }: { overrides: Partial<SessionState> }) {
  const client = useMemo(
    () => createMockClient({ frozen: true, initial: seededViewer(overrides) }),
    [overrides],
  )
  return (
    <SessionProvider client={client}>
      <Viewer />
    </SessionProvider>
  )
}

export function DevState() {
  const { stateId = '' } = useParams()

  switch (stateId) {
    // Both pass an explicit list: the screen otherwise reads this phone's real
    // storage, and the gallery must not depend on what is paired today.
    case 'devices-list':
      return <Devices devices={DEVICES} />
    case 'devices-empty':
      return <Devices devices={[]} />
    case 'reject-notPaired':
      return <ConnectRejected reason="notPaired" deviceName="Studio Mac" />
    case 'reject-desktopOffline':
      return <ConnectRejected reason="desktopOffline" deviceName="Living room mini" />
    case 'reject-alreadyInSession':
      return <ConnectRejected reason="alreadyInSession" deviceName="Work PC" />
    case 'viewer-live':
      return <FrozenViewer overrides={{}} />
    case 'viewer-relayed':
      return <FrozenViewer overrides={{ transport: 'relayed' }} />
    case 'viewer-degraded':
      return <FrozenViewer overrides={{ quality: 'degraded' }} />
    case 'viewer-reconnecting':
      return <FrozenViewer overrides={{ phase: 'reconnecting' }} />
    case 'session-ended':
      return (
        <SessionEnded
          deviceName="Studio Mac"
          deviceId="dev_studio_mac"
          durationSeconds={724}
          averageFps={57.9}
        />
      )
    case 'overlay-offline':
      return <OfflineCover />
    case 'overlay-rotate':
      return <RotateCover />
    case 'overlay-install':
      return (
        <div className={styles.installHost}>
          <InstallSheet onDismiss={() => history.back()} />
        </div>
      )
    default:
      return <DevGallery />
  }
}

export function DevGallery() {
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>Screen gallery</h1>
        <p className={styles.body}>
          Every screen and state, without a server. The session driver is a mock — no WebSocket, no
          peer connection, no media. This route is deleted before launch.
        </p>
      </div>

      <section className={styles.section}>
        <span className={styles.eyebrow}>Routes</span>
        <div className={styles.grid}>
          {ROUTES.map(([to, label, ms]) => (
            <Link key={to} to={to} className={styles.card}>
              <span className={styles.cardLabel}>{label}</span>
              <span className={styles.cardMeta}>
                <span className={styles.path}>{to}</span>
                <span className={styles.tag}>{ms}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.eyebrow}>States</span>
        <div className={styles.grid}>
          {STATES.map(([id, label, ms]) => (
            <Link key={id} to={`/dev/${id}`} className={styles.card}>
              <span className={styles.cardLabel}>{label}</span>
              <span className={styles.cardMeta}>
                <span className={styles.path}>/dev/{id}</span>
                <span className={styles.tag}>{ms}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
