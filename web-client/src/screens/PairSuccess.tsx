import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState } from '../components/Feedback'
import { Field } from '../components/Field'
import { Overline, Screen, Spacer } from '../components/Screen'
import styles from './pairing.module.css'

/** What `pairWithCode` resolved with, handed over in the router's location state. */
interface PairedState {
  deviceId?: string
  displayName?: string
}

export function PairSuccess() {
  const navigate = useNavigate()
  // The desktop this phone just paired with. Absent when the screen is opened
  // directly — the dev gallery does that — and there is then no real device to
  // start a session against, so the screen must not invent one.
  const paired = (useLocation().state ?? {}) as PairedState
  const [name, setName] = useState(paired.displayName ?? 'Studio Mac')

  return (
    <Screen
      footer={
        <>
          {paired.deviceId ? (
            <Button
              label="Start session"
              full
              onClick={() => navigate(`/session/${paired.deviceId}`)}
            />
          ) : null}
          <Button
            label={paired.deviceId ? 'Later' : 'Back to devices'}
            variant={paired.deviceId ? 'ghost' : 'primary'}
            full
            onClick={() => navigate('/')}
          />
        </>
      }
    >
      <EmptyState icon="check" tone="success" title="Paired">
        This phone now holds a credential for that computer. Future connections need no code.
      </EmptyState>

      <div className={styles.nameBlock}>
        <Overline>Name this computer</Overline>
        <Field
          label="Computer name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <span className={styles.pointBody}>Stored on this phone only.</span>
      </div>

      <Spacer />
    </Screen>
  )
}
