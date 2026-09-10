import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Icon } from './Icon'
import styles from './List.module.css'

export function ListGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(styles.group, className)}>{children}</div>
}

export interface ListRowProps {
  label: string
  sub?: string
  value?: string
  /** Renders a control (Toggle, StatusPill…) instead of a value + chevron. */
  trailing?: ReactNode
  danger?: boolean
  selected?: boolean
  onClick?: () => void
}

export function ListRow({
  label,
  sub,
  value,
  trailing,
  danger = false,
  selected = false,
  onClick,
}: ListRowProps) {
  const content = (
    <>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {sub ? <span className={styles.sub}>{sub}</span> : null}
      </span>
      <span className={styles.trailing}>
        {value ? <span className={styles.value}>{value}</span> : null}
        {trailing}
        {selected ? <Icon name="check" size={18} className={styles.check} /> : null}
        {onClick && !trailing && !selected ? <Icon name="chevron-right" size={18} /> : null}
      </span>
    </>
  )

  const className = cn(styles.row, danger && styles.danger)

  return onClick ? (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  )
}
