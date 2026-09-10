import { cn } from '../lib/cn'
import styles from './StatChip.module.css'

export type StatTone = 'neutral' | 'good' | 'warn' | 'bad'

/**
 * One readout in the stats overlay.
 *
 * The value is monospaced with tabular figures so digits keep a constant width
 * across the 1 Hz refresh — no horizontal jitter while reading it.
 */
export function StatChip({
  caption,
  value,
  tone = 'neutral',
  small = false,
}: {
  caption: string
  value: string
  tone?: StatTone
  small?: boolean
}) {
  return (
    <div className={cn(styles.chip, small && styles.sm)}>
      <span className={styles.caption}>{caption}</span>
      <span className={cn(styles.value, styles[tone])}>{value}</span>
    </div>
  )
}
