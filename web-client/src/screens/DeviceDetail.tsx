import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/Button'
import { ConfirmDialog } from '../components/Dialog'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { ListGroup, ListRow } from '../components/List'
import { NavBar, Overline, Screen } from '../components/Screen'
import { StatusPill } from '../components/StatusPill'
import { formatRelative } from '../lib/format'
import { forgetDevice, renameDevice, useDevices } from '../store/devices'
import { setPref, usePrefs } from '../store/prefs'
import { Devices } from './Devices'
import styles from './devices.module.css'

export function DeviceDetail() {
  const navigate = useNavigate()
  const { deviceId = '' } = useParams()
  const devices = useDevices()
  const prefs = usePrefs()
  const device = devices.find((item) => item.id === deviceId) ?? null
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState(false)

  // A removed or unknown device is not an error screen — it just isn't paired.
  if (!device) return <Devices devices={[]} />

  const pairedOn = new Date(device.pairedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  function commitRename() {
    if (!device) return
    renameDevice(device.id, draft)
    setRenaming(false)
  }

  return (
    <Screen compact>
      <NavBar title={device.name} onBack={() => navigate('/')} />

      <div className={styles.identity}>
        <span className={styles.avatar}>
          <Icon name="monitor" size={28} />
        </span>
        {renaming ? (
          <div className={styles.renameBlock}>
            <Field
              label="Computer name"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename()
                if (event.key === 'Escape') setRenaming(false)
              }}
              autoFocus
            />
            <div className={styles.renameActions}>
              <Button label="Save" onClick={commitRename} />
              <Button label="Cancel" variant="ghost" onClick={() => setRenaming(false)} />
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.nameButton}
            onClick={() => {
              setDraft(device.name)
              setRenaming(true)
            }}
          >
            <span className={styles.deviceName}>{device.name}</span>
            <Icon name="chevron-right" size={18} />
          </button>
        )}
        <StatusPill
          status={device.presence === 'online' ? 'live' : 'offline'}
          label={
            device.presence === 'online'
              ? device.transport === 'relayed'
                ? 'Online · via relay'
                : 'Online · same network'
              : device.lastConnectedAt === null
                ? 'Not connected yet'
                : `Last connected ${formatRelative(device.lastConnectedAt)}`
          }
          solid
        />
      </div>

      <Button label="Start session" full onClick={() => navigate(`/session/${device.id}`)} />

      <div className={styles.section}>
        <Overline>Session defaults</Overline>
        <ListGroup>
          {/* Pointer model is this phone's own choice, so it is settable here.
           * Display and quality are the desktop's to answer and there is no
           * message for either yet — they render as read-only rather than as
           * buttons that would do nothing. */}
          <ListRow
            label="Pointer mode"
            value={prefs.pointerMode === 'direct' ? 'Direct' : 'Trackpad'}
            onClick={() =>
              setPref('pointerMode', prefs.pointerMode === 'direct' ? 'trackpad' : 'direct')
            }
          />
          <ListRow label="Display" value={device.displays[0]?.name ?? 'Chosen by the desktop'} />
          <ListRow label="Quality" value="Automatic" />
        </ListGroup>
        <span className={styles.note}>
          Display and quality are reported by the computer once a session starts.
        </span>
      </div>

      <div className={styles.section}>
        <Overline>Pairing</Overline>
        <ListGroup>
          <ListRow label="Paired" value={pairedOn} />
          <ListRow label="Remove this pairing" danger onClick={() => setConfirming(true)} />
        </ListGroup>
        <span className={styles.note}>
          Removing forgets this computer on this phone. Connecting again needs a fresh code from the
          desktop app.
        </span>
      </div>

      {confirming ? (
        <ConfirmDialog
          title={`Remove ${device.name}?`}
          confirmLabel="Remove pairing"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            forgetDevice(device.id)
            navigate('/')
          }}
        >
          This phone will forget {device.name} and need a fresh six-digit code before it can connect
          again.
        </ConfirmDialog>
      ) : null}
    </Screen>
  )
}
