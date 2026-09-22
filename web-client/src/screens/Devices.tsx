import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { DeviceRow } from '../components/DeviceRow'
import { EmptyState } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { Screen, Spacer } from '../components/Screen'
import { formatRelative } from '../lib/format'
import type { Device } from '../session/types'
import { useDevices } from '../store/devices'
import styles from './devices.module.css'

/* Presence is the server's to report, and there is no server answering yet, so
 * a stored device reads "offline" and the copy says when it last worked rather
 * than claiming to know it is asleep right now. */
function metaFor(device: Device): string {
  if (device.presence === 'online') {
    return device.transport === 'relayed' ? 'Online · via relay' : 'Online · same network'
  }
  if (device.lastConnectedAt === null) return 'Paired · not connected yet'
  return `Last connected ${formatRelative(device.lastConnectedAt)}`
}

/**
 * The home screen. `devices` is injectable so the dev gallery can show the
 * empty state and the fixtures without touching this phone's real storage.
 */
export function Devices({ devices }: { devices?: readonly Device[] }) {
  const navigate = useNavigate()
  const stored = useDevices()
  const list = devices ?? stored
  const empty = list.length === 0

  return (
    <Screen
      compact
      footer={
        empty ? (
          <>
            <Button label="Pair a computer" full onClick={() => navigate('/pair/code')} />
            <Button
              label="How do I install the desktop app?"
              variant="ghost"
              full
              onClick={() => navigate('/install')}
            />
          </>
        ) : (
          <Button
            label="Pair another computer"
            variant="secondary"
            icon="plus"
            full
            onClick={() => navigate('/pair/code')}
          />
        )
      }
    >
      <div className={styles.header}>
        <h1 className={styles.title}>Computers</h1>
        {/* Shown even when the list is empty: settings and the install guide
         * are the only things a phone with no pairings can usefully do. */}
        <button
          type="button"
          className={styles.iconAction}
          aria-label="Settings"
          onClick={() => navigate('/settings')}
        >
          <Icon name="settings" size={20} />
        </button>
      </div>

      {empty ? (
        <>
          <Spacer />
          <EmptyState icon="monitor" title="No computers yet">
            Install RemoteHost on a Mac or PC, then pair it with the code it shows you.
          </EmptyState>
          <Spacer />
        </>
      ) : (
        <div className={styles.list}>
          {list.map((device) => (
            <DeviceRow
              key={device.id}
              name={device.name}
              meta={metaFor(device)}
              presence={device.presence}
              onClick={() => navigate(`/device/${device.id}`)}
            />
          ))}
        </div>
      )}
    </Screen>
  )
}
