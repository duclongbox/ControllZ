import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState } from '../components/Feedback'
import { StatChip } from '../components/StatChip'
import { Screen, Spacer } from '../components/Screen'
import { formatDuration } from '../lib/format'
import styles from './devices.module.css'

export function SessionEnded({
  deviceName = 'Studio Mac',
  deviceId,
  durationSeconds = 0,
  averageFps = null,
  relayed = false,
}: {
  deviceName?: string
  deviceId?: string
  durationSeconds?: number
  averageFps?: number | null
  relayed?: boolean
}) {
  const navigate = useNavigate()

  return (
    <Screen
      footer={
        <>
          <Button
            label="Reconnect"
            full
            onClick={() => navigate(deviceId ? `/session/${deviceId}` : '/')}
          />
          <Button label="Back to devices" variant="ghost" full onClick={() => navigate('/')} />
        </>
      }
    >
      <Spacer />
      <EmptyState icon="power" title="Session ended">
        You disconnected from {deviceName}. It stays paired — reconnecting needs no code.
      </EmptyState>

      <div className={styles.summary}>
        <StatChip caption="DURATION" value={formatDuration(durationSeconds)} />
        <StatChip
          caption="AVG FPS"
          value={averageFps === null ? '—' : averageFps.toFixed(1)}
          tone={averageFps !== null && averageFps >= 50 ? 'good' : 'neutral'}
        />
        <StatChip
          caption="RELAYED"
          value={relayed ? 'Yes' : 'No'}
          tone={relayed ? 'warn' : 'good'}
        />
      </div>
      <Spacer />
    </Screen>
  )
}
