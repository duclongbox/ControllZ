import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Overline, Screen, ScreenTitle, Spacer } from '../components/Screen'
import styles from './devices.module.css'

/**
 * M1 development stub.
 *
 * A shared room code, no identity — the whole point is to de-risk the video
 * pipeline before pairing exists. This screen ships behind a dev flag and is
 * *deleted* at M3, not hidden: leaving a code-based join path alive alongside
 * real pairing would be a way in that nothing authenticates.
 */
export function JoinRoom() {
  const navigate = useNavigate()
  const [room, setRoom] = useState('studio-mac')

  return (
    <Screen
      footer={
        <Button
          label="Join room"
          full
          disabled={room.trim().length === 0}
          onClick={() => navigate('/session/dev_studio_mac')}
        />
      }
    >
      <ScreenTitle
        overline="Development stub · M1"
        title="Join a room"
        subtitle="A shared room code, no identity. Replaced entirely by real pairing in M3 — this screen ships behind a dev flag and is deleted, not hidden."
      />

      <div className={styles.section}>
        <Overline>Room code</Overline>
        <Field
          label="Room code"
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      <Spacer />
    </Screen>
  )
}
