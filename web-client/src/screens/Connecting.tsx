import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Screen, ScreenTitle, Spacer } from '../components/Screen'
import { cn } from '../lib/cn'
import type { ConnectStep } from '../session/types'
import styles from './devices.module.css'

/**
 * The connecting ladder.
 *
 * Every rung is named, so if it stalls you can see exactly where. This is the
 * "no spinner without a name" rule (docs/ui-spec.md §1.7) at its most literal.
 */
export function Connecting({
  deviceName,
  steps,
  onCancel,
}: {
  deviceName: string
  steps: readonly ConnectStep[]
  onCancel: () => void
}) {
  return (
    <Screen footer={<Button label="Cancel" variant="secondary" full onClick={onCancel} />}>
      <ScreenTitle
        small
        title={`Connecting to ${deviceName}`}
        subtitle="Every step is named. If it stalls, you can see exactly where."
      />

      <div className={styles.ladder}>
        {steps.map((step, index) => (
          <div key={step.id} className={cn(styles.step, styles[step.state])}>
            <div className={styles.rail}>
              <span className={styles.marker}>
                {step.state === 'done' ? (
                  <Icon name="check" size={14} strokeWidth={2.5} />
                ) : step.state === 'active' ? (
                  <span className={styles.pulse} />
                ) : null}
              </span>
              {index < steps.length - 1 ? <span className={styles.connector} /> : null}
            </div>
            <div className={styles.stepText}>
              <span className={styles.stepLabel}>{step.label}</span>
              <span className={styles.stepDetail}>{step.detail}</span>
            </div>
          </div>
        ))}
      </div>

      <Spacer />
    </Screen>
  )
}
