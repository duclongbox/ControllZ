import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../lib/cn'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import styles from './IconButton.module.css'

export type IconButtonStyle = 'ghost' | 'active' | 'filled' | 'danger'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  /** Required: the icon is decorative, so the button needs its own name. */
  label: string
  appearance?: IconButtonStyle
  size?: 'md' | 'lg'
}

export function IconButton({
  icon,
  label,
  appearance = 'ghost',
  size = 'lg',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(styles.button, styles[appearance], size === 'md' && styles.sm, className)}
      {...rest}
    >
      <Icon name={icon} size={size === 'md' ? 20 : 22} />
    </button>
  )
}
