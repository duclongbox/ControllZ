import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../lib/cn'
import { Icon } from './Icon'
import styles from './Screen.module.css'

/**
 * The portrait app shell: safe-area padding, a scrollable body, a pinned
 * footer.
 *
 * The viewer deliberately does NOT use this — its chrome floats over the stage
 * rather than sitting in the layout, so it would be wrong to give it padding.
 */
export function Screen({
  children,
  footer,
  compact = false,
  centered = false,
  className,
}: {
  children: ReactNode
  footer?: ReactNode
  /** Tighter top padding, for screens that open with a nav bar. */
  compact?: boolean
  centered?: boolean
  className?: string
}) {
  return (
    <div className={cn(styles.screen, compact && styles.compact, className)}>
      <div className={cn(styles.body, centered && styles.centered)}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </div>
  )
}

export function NavBar({
  title,
  onBack,
  trailing,
}: {
  title: string
  onBack?: () => void
  trailing?: ReactNode
}) {
  const navigate = useNavigate()
  const back = onBack ?? (() => navigate(-1))
  return (
    <div className={styles.nav}>
      <button type="button" className={styles.navButton} aria-label="Back" onClick={back}>
        <Icon name="chevron-left" size={24} />
      </button>
      <span className={styles.navTitle}>{title}</span>
      {trailing ?? <span className={styles.navSpacer} />}
    </div>
  )
}

export function ScreenTitle({
  title,
  subtitle,
  overline,
  small = false,
}: {
  title: string
  subtitle?: ReactNode
  overline?: string
  small?: boolean
}) {
  return (
    <div className={styles.titleBlock}>
      {overline ? <span className={styles.overline}>{overline}</span> : null}
      <h1 className={cn(styles.title, small && styles.titleSm)}>{title}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </div>
  )
}

export function Overline({ children }: { children: ReactNode }) {
  return <span className={styles.overline}>{children}</span>
}

export function Spacer() {
  return <span className={styles.spacer} />
}
