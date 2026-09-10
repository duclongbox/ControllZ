import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../lib/cn'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string
  variant?: ButtonVariant
  icon?: IconName
  full?: boolean
  loading?: boolean
}

/**
 * The primary action control. 52px tall (`--size-control-lg`) so it stays
 * comfortably tappable one-handed — see docs/ui-spec.md §1.4.
 */
export function Button({
  label,
  variant = 'primary',
  icon,
  full = false,
  loading = false,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(styles.button, styles[variant], full && styles.full, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className={styles.spinner} /> : icon ? <Icon name={icon} size={20} /> : null}
      <span>{label}</span>
    </button>
  )
}
