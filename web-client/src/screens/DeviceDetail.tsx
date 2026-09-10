import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { ListGroup, ListRow } from '../components/List'
import { NavBar, Overline, Screen } from '../components/Screen'
import { StatusPill } from '../components/StatusPill'
import { findDevice } from '../mock/devices'
import { Devices } from './Devices'
import styles from './devices.module.css'

export function DeviceDetail() {
  const navigate = useNavigate()
  const { deviceId = '' } = useParams()
  const device = findDevice(deviceId)

  // A deleted or unknown device is not an error screen — it just isn't paired.
  if (!device) return <Devices devices={[]} />

  const pairedOn = new Date(device.pairedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <Screen compact>
      <NavBar title={device.name} onBack={() => navigate('/')} />

      <div className={styles.identity}>
        <span className={styles.avatar}>
          <Icon name="monitor" size={28} />
        </span>
        <span className={styles.deviceName}>{device.name}</span>
        <StatusPill
          status={device.presence === 'online' ? 'live' : 'offline'}
          label={
            device.presence === 'online'
              ? device.transport === 'relayed'
                ? 'Online · via relay'
                : 'Online · same network'
              : 'Offline'
          }
          solid
        />
      </div>

      <Button
        label="Start session"
        full
        onClick={() => navigate(`/session/${device.id}`)}
      />

      <div className={styles.section}>
        <Overline>Session defaults</Overline>
        <ListGroup>
          <ListRow label="Display" value={device.displays[0]?.name ?? '—'} onClick={() => {}} />
          <ListRow label="Quality" value="Automatic" onClick={() => {}} />
          <ListRow label="Pointer mode" value="Trackpad" onClick={() => {}} />
        </ListGroup>
      </div>

      <div className={styles.section}>
        <Overline>Pairing</Overline>
        <ListGroup>
          <ListRow label="Paired" value={pairedOn} />
          <ListRow label="Remove this pairing" danger onClick={() => navigate('/')} />
        </ListGroup>
        <span className={styles.note}>
          Removing revokes the record on the server. This phone will need a fresh code to connect
          again.
        </span>
      </div>
    </Screen>
  )
}
