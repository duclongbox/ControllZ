import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import styles from './Banner.module.css'

export type BannerTone = 'info' | 'warn' | 'error' | 'success'

const TONE_ICON: Record<BannerTone, IconName> = {
  info: 'wifi',
  warn: 'alert',
  error: 'alert',
  success: 'check',
}

/**
 * Explains a connection condition the user cannot otherwise see — why quality
 * dropped, why a connection was refused. Never use one for something the status
 * pill already says.
 */
export function Banner({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: BannerTone
  title: string
  children?: ReactNode
  action?: { label: string; onClick: () => void }
  className?: string
}) {
  return (
    <div className={cn(styles.banner, styles[tone], className)} role="status">
      <Icon name={TONE_ICON[tone]} size={20} className={styles.icon} />
      <div className={styles.body}>
        <span className={styles.title}>{title}</span>
        {children ? <span className={styles.text}>{children}</span> : null}
        {action ? (
          <button type="button" className={styles.action} onClick={action.onClick}>
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  )
}
