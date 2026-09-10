import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { DeviceRow } from '../components/DeviceRow'
import { EmptyState } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { Screen, Spacer } from '../components/Screen'
import { formatRelative } from '../lib/format'
import { DEVICES } from '../mock/devices'
import type { Device } from '../session/types'
import styles from './devices.module.css'

function metaFor(device: Device): string {
  if (device.presence === 'offline') {
    return `Offline · last seen ${formatRelative(device.lastConnectedAt)}`
  }
  return device.transport === 'relayed' ? 'Online · via relay' : 'Online · same network'
}

/** The home screen. `devices` is injectable so the dev gallery can show empty. */
export function Devices({ devices = DEVICES }: { devices?: readonly Device[] }) {
  const navigate = useNavigate()
  const empty = devices.length === 0

  return (
    <Screen
      compact
      footer={
        empty ? (
          <>
            <Button label="Pair a computer" full onClick={() => navigate('/pair/scan')} />
            <Button label="How do I install the desktop app?" variant="ghost" full />
          </>
        ) : (
          <Button
            label="Pair another computer"
            variant="secondary"
            icon="plus"
            full
            onClick={() => navigate('/pair/scan')}
          />
        )
      }
    >
      <div className={styles.header}>
        <h1 className={styles.title}>Computers</h1>
        {!empty ? (
          <button
            type="button"
            className={styles.iconAction}
            aria-label="Settings"
            onClick={() => navigate('/settings')}
          >
            <Icon name="settings" size={20} />
          </button>
        ) : null}
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
          {devices.map((device) => (
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
