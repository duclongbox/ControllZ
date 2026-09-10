import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import styles from './Feedback.module.css'

export function Spinner({ large = false }: { large?: boolean }) {
  return <span className={cn(styles.spinner, large && styles.spinnerLg)} role="progressbar" />
}

/** A named wait. Never show a spinner without saying what it is waiting on. */
export function InlineWait({ children }: { children: ReactNode }) {
  return (
    <div className={styles.inlineWait}>
      <Spinner />
      <span className={styles.waitText}>{children}</span>
    </div>
  )
}

export function EmptyState({
  icon,
  tone = 'neutral',
  title,
  children,
  code,
}: {
  icon: IconName
  tone?: 'neutral' | 'success' | 'error' | 'warn'
  title: string
  children?: ReactNode
  /** The wire-level reason, for people who want it. Small and quiet. */
  code?: string
}) {
  const toneClass =
    tone === 'success'
      ? styles.badgeSuccess
      : tone === 'error'
        ? styles.badgeError
        : tone === 'warn'
          ? styles.badgeWarn
          : undefined

  return (
    <div className={styles.empty}>
      <span className={cn(styles.badge, toneClass)}>
        <Icon name={icon} size={28} strokeWidth={tone === 'success' ? 2.4 : 1.75} />
      </span>
      <span className={styles.title}>{title}</span>
      {children ? <p className={styles.body}>{children}</p> : null}
      {code ? <span className={styles.code}>{code}</span> : null}
    </div>
  )
}
