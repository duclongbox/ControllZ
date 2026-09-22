import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListGroup, ListRow } from '../components/List'
import { NavBar, Overline, Screen } from '../components/Screen'
import { Toggle } from '../components/Toggle'
import { getPhoneDeviceId } from '../session/wsClient'
import { HIDE_DELAYS, setPref, usePrefs } from '../store/prefs'
import styles from './devices.module.css'

/** "c1f2a3b4-…-b2c3d4e5f607" → "c1f2a3b4…f607", which is enough to match a log. */
function shortId(id: string | null): string {
  if (!id) return 'Not registered yet'
  return id.length <= 13 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`
}

export function Settings() {
  const navigate = useNavigate()
  const prefs = usePrefs()
  const [pickingDelay, setPickingDelay] = useState(false)

  const delayLabel =
    HIDE_DELAYS.find((option) => option.value === prefs.hideChromeAfterMs)?.label ?? '3 seconds'

  return (
    <Screen compact>
      <NavBar title="Settings" onBack={() => navigate(-1)} />

      <div className={styles.section}>
        <Overline>During a session</Overline>
        <ListGroup>
          <ListRow
            label="Keep the screen awake"
            sub="Screen Wake Lock, re-acquired on focus"
            trailing={
              <Toggle
                on={prefs.wakeLock}
                onChange={(on) => setPref('wakeLock', on)}
                label="Keep the screen awake"
              />
            }
          />
          <ListRow
            label="Show stats overlay"
            sub="Opens with the session instead of on demand"
            trailing={
              <Toggle
                on={prefs.showStats}
                onChange={(on) => setPref('showStats', on)}
                label="Show stats overlay"
              />
            }
          />
          <ListRow
            label="Haptics on tap"
            trailing={
              <Toggle
                on={prefs.haptics}
                onChange={(on) => setPref('haptics', on)}
                label="Haptics on tap"
              />
            }
          />
          <ListRow
            label="Hide controls after"
            value={delayLabel}
            onClick={() => setPickingDelay((open) => !open)}
          />
        </ListGroup>

        {pickingDelay ? (
          <ListGroup>
            {HIDE_DELAYS.map((option) => (
              <ListRow
                key={option.value}
                label={option.label}
                selected={option.value === prefs.hideChromeAfterMs}
                onClick={() => {
                  setPref('hideChromeAfterMs', option.value)
                  setPickingDelay(false)
                }}
              />
            ))}
          </ListGroup>
        ) : null}
      </div>

      <div className={styles.section}>
        <Overline>Quality</Overline>
        {/* Read-only on purpose. Both of these are instructions to the desktop
         * encoder, and there is no message for either yet — a switch that
         * stored a preference nothing can honour would be a lie. */}
        <ListGroup>
          <ListRow label="Default priority" value="Automatic" />
          <ListRow label="Cap on cellular" value="Not enforced yet" />
        </ListGroup>
        <span className={styles.note}>
          The quality ladder is driven by the computer. These become adjustable when the desktop app
          accepts a priority.
        </span>
      </div>

      <div className={styles.section}>
        <Overline>Help</Overline>
        <ListGroup>
          <ListRow label="Install the desktop app" onClick={() => navigate('/install')} />
          <ListRow label="How it works" onClick={() => navigate('/landing')} />
          <ListRow label="Privacy" onClick={() => navigate('/privacy')} />
          <ListRow label="Security" onClick={() => navigate('/security')} />
        </ListGroup>
      </div>

      <div className={styles.section}>
        <Overline>About</Overline>
        <ListGroup>
          <ListRow label="Version" value={__APP_VERSION__} />
          <ListRow label="This phone" value={shortId(getPhoneDeviceId())} />
        </ListGroup>
      </div>
    </Screen>
  )
}
