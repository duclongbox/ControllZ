import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListGroup, ListRow } from '../components/List'
import { NavBar, Overline, Screen } from '../components/Screen'
import { Toggle } from '../components/Toggle'
import styles from './devices.module.css'

export function Settings() {
  const navigate = useNavigate()
  const [wakeLock, setWakeLock] = useState(true)
  const [showStats, setShowStats] = useState(false)
  const [haptics, setHaptics] = useState(true)

  return (
    <Screen compact>
      <NavBar title="Settings" onBack={() => navigate('/')} />

      <div className={styles.section}>
        <Overline>During a session</Overline>
        <ListGroup>
          <ListRow
            label="Keep the screen awake"
            sub="Screen Wake Lock, re-acquired on focus"
            trailing={
              <Toggle on={wakeLock} onChange={setWakeLock} label="Keep the screen awake" />
            }
          />
          <ListRow
            label="Show stats overlay"
            trailing={<Toggle on={showStats} onChange={setShowStats} label="Show stats overlay" />}
          />
          <ListRow
            label="Haptics on tap"
            trailing={<Toggle on={haptics} onChange={setHaptics} label="Haptics on tap" />}
          />
          <ListRow label="Hide controls after" value="3 seconds" onClick={() => {}} />
        </ListGroup>
      </div>

      <div className={styles.section}>
        <Overline>Quality</Overline>
        <ListGroup>
          <ListRow label="Default priority" value="Automatic" onClick={() => {}} />
          <ListRow label="Cap on cellular" value="720p" onClick={() => {}} />
        </ListGroup>
      </div>

      <div className={styles.section}>
        <Overline>About</Overline>
        <ListGroup>
          <ListRow label="Version" value="0.1.0 · M0" />
          <ListRow label="This device" value="ph_8f21…c40e" />
        </ListGroup>
        <span className={styles.note}>
          Not connected to a server yet — the desktop host and signalling server land in M1.
        </span>
      </div>
    </Screen>
  )
}
