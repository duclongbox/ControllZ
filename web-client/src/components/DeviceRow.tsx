import { cn } from '../lib/cn'
import { Icon } from './Icon'
import styles from './DeviceRow.module.css'

/**
 * One paired desktop in the device list.
 *
 * An offline row still navigates rather than being disabled — the next screen
 * explains why it cannot connect, which is more useful than a dead row.
 */
export function DeviceRow({
  name,
  meta,
  presence,
  onClick,
}: {
  name: string
  meta: string
  presence: 'online' | 'offline'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(styles.row, presence === 'offline' && styles.offline)}
    >
      <span className={styles.avatar}>
        <Icon name="monitor" size={22} />
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        <span className={styles.meta}>
          <span className={styles.dot} />
          <span className={styles.metaText}>{meta}</span>
        </span>
      </span>
      <Icon name="chevron-right" size={20} className={styles.chevron} />
    </button>
  )
}
