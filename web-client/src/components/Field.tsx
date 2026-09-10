import type { InputHTMLAttributes } from 'react'
import { cn } from '../lib/cn'
import styles from './Field.module.css'

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string
  invalid?: boolean
}

/** Single-line text input. 52 tall to match Button. */
export function Field({ label, invalid = false, className, ...rest }: FieldProps) {
  return (
    <div className={cn(styles.field, invalid && styles.invalid, className)}>
      <input className={styles.input} aria-label={label} aria-invalid={invalid} {...rest} />
    </div>
  )
}
