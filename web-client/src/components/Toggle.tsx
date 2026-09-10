import { cn } from '../lib/cn'
import styles from './Toggle.module.css'

export function Toggle({
  on,
  onChange,
  disabled = false,
  label,
}: {
  on: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={cn(styles.toggle, on && styles.on)}
      onClick={() => onChange(!on)}
    >
      <span className={styles.knob} />
    </button>
  )
}
