import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { CodeInput } from '../components/CodeInput'
import { InlineWait } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { NavBar, Screen, ScreenTitle, Spacer } from '../components/Screen'
import { formatCountdown } from '../lib/format'
import { useSessionClient } from '../session/useSession'
import type { WsSessionClient } from '../session/wsClient'
import styles from './pairing.module.css'

type Status = 'entering' | 'verifying' | 'invalid'

/** The one code the mock accepts. At M3 the server decides. */
const ACCEPTED = '418902'
const EXPIRY_SECONDS = 252
const MAX_ATTEMPTS = 3

/**
 * Six-digit entry — three artboards in one screen (entering / verifying /
 * invalid), because they are states of one thing, not separate destinations.
 */
export function PairCode() {
  const navigate = useNavigate()
  const client = useSessionClient() as Partial<WsSessionClient>
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<Status>('entering')
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS)
  const [remaining, setRemaining] = useState(EXPIRY_SECONDS)

  useEffect(() => {
    const id = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [])

  function refuse() {
    setStatus('invalid')
    setAttemptsLeft((n) => Math.max(0, n - 1))
  }

  function submit(entered: string) {
    setStatus('verifying')

    // The dev gallery injects the mock driver, which has no pairing half; it
    // keeps the one accepted code so the screens stay clickable offline.
    if (!client.pairWithCode) {
      setTimeout(() => (entered === ACCEPTED ? navigate('/pair/done') : refuse()), 900)
      return
    }

    // pairCodeSubmit → pairedConfirmed carries the desktop this phone may now
    // connect to, which is exactly the id the viewer route needs.
    client
      .pairWithCode(entered)
      .then((desktop) => navigate(`/session/${desktop.deviceId}`))
      .catch(() => refuse())
  }

  const expired = remaining === 0
  const locked = attemptsLeft === 0

  return (
    <Screen
      compact
      footer={
        status === 'invalid' ? (
          <Button
            label="Try again"
            full
            disabled={locked}
            onClick={() => {
              setCode('')
              setStatus('entering')
            }}
          />
        ) : (
          <span className={styles.fine}>Submits automatically on the sixth digit.</span>
        )
      }
    >
      <NavBar title="Pair a computer" onBack={() => navigate('/pair/scan')} />

      <ScreenTitle
        small
        title={
          status === 'invalid'
            ? 'That code did not work'
            : status === 'verifying'
              ? 'Checking the code'
              : 'Enter the code'
        }
        subtitle={
          status === 'entering'
            ? 'Six digits, shown in the desktop app. It expires five minutes after it appears.'
            : undefined
        }
      />

      <CodeInput
        value={code}
        onChange={setCode}
        onComplete={submit}
        invalid={status === 'invalid'}
        disabled={status === 'verifying' || locked}
        autoFocus
      />

      {status === 'entering' ? (
        <div className={styles.expiry}>
          <span className={styles.expiryLabel}>{expired ? 'This code has expired' : 'Expires in'}</span>
          <span className={`${styles.expiryValue} ${expired ? styles.expired : ''}`}>
            {formatCountdown(remaining)}
          </span>
        </div>
      ) : null}

      {status === 'verifying' ? <InlineWait>Creating the pairing record…</InlineWait> : null}

      {status === 'invalid' ? (
        <>
          <Banner tone="error" title="Code expired or already used">
            Codes are single-use and last five minutes. Generate a fresh one in the desktop app.
          </Banner>
          <div className={styles.attempts}>
            <Icon name="lock" size={16} />
            <span className={styles.attemptsText}>
              {locked
                ? 'Too many attempts. Try again in 15 minutes.'
                : `${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left before this device is rate-limited for 15 minutes.`}
            </span>
          </div>
        </>
      ) : null}

      <Spacer />
    </Screen>
  )
}
