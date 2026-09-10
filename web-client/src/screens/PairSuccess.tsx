import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState } from '../components/Feedback'
import { Field } from '../components/Field'
import { Overline, Screen, Spacer } from '../components/Screen'
import styles from './pairing.module.css'

export function PairSuccess() {
  const navigate = useNavigate()
  const [name, setName] = useState('Studio Mac')

  return (
    <Screen
      footer={
        <>
          <Button label="Start session" full onClick={() => navigate('/session/dev_studio_mac')} />
          <Button label="Later" variant="ghost" full onClick={() => navigate('/')} />
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
