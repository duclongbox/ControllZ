import { cn } from '../lib/cn'
import styles from './StatusPill.module.css'

export type ConnectionStatus =
  | 'live'
  | 'connecting'
  | 'degraded'
  | 'relayed'
  | 'offline'
  | 'error'

/**
 * Connection state, always visible in the viewer top bar.
 *
 * Status is the only thing in the app allowed to use colour semantically —
 * docs/ui-spec.md §1.5.
 */
export function StatusPill({
  status,
  label,
  solid = false,
}: {
  status: ConnectionStatus
  label: string
  solid?: boolean
}) {
  const pulsing = status === 'connecting'
  return (
    <span
      className={cn(styles.pill, styles[status], solid && styles.solid, pulsing && styles.pulse)}
      role="status"
    >
      <span className={styles.dot} />
      {label}
    </span>
  )
}
