import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import styles from './Banner.module.css'

export type BannerTone = 'info' | 'warn' | 'error' | 'success'

/* The defaults read as connection conditions, which is what banners were for
 * originally. The prose pages use the same component for something else, so
 * the icon can be overridden. */
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
  icon,
  className,
}: {
  tone: BannerTone
  title: string
  children?: ReactNode
  action?: { label: string; onClick: () => void }
  /** Overrides the tone's default, which assumes a connection condition. */
  icon?: IconName
  className?: string
}) {
  return (
    <div className={cn(styles.banner, styles[tone], className)} role="status">
      <Icon name={icon ?? TONE_ICON[tone]} size={20} className={styles.icon} />
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
