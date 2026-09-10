import { useId, useRef } from 'react'
import { cn } from '../lib/cn'
import styles from './CodeInput.module.css'

const LENGTH = 6

/**
 * Six-digit first-time pairing code entry (`pairCodeSubmit`).
 *
 * A single real `<input>` sits invisibly over the cells so the numeric keypad,
 * paste and one-time-code autofill all behave; the cells are only a rendering
 * of its value. Submits automatically on the sixth digit — nobody should have
 * to reach for a Confirm button under a five-minute expiry.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  invalid = false,
  disabled = false,
  autoFocus = false,
  label = 'Pairing code',
}: {
  value: string
  onChange: (next: string) => void
  onComplete?: (code: string) => void
  invalid?: boolean
  disabled?: boolean
  autoFocus?: boolean
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const focusIndex = Math.min(value.length, LENGTH - 1)

  function handleChange(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, LENGTH)
    onChange(digits)
    if (digits.length === LENGTH) onComplete?.(digits)
  }

  return (
    <div className={styles.field}>
      <div className={styles.wrap} aria-hidden="true">
        {Array.from({ length: LENGTH }, (_, i) => {
          const char = value[i]
          const focused = !disabled && !invalid && i === focusIndex && value.length < LENGTH
          return (
            <div
              key={i}
              className={cn(
                styles.cell,
                char && styles.filled,
                focused && styles.focused,
                invalid && styles.error,
              )}
            >
              {char ?? (focused ? <span className={styles.caret} /> : null)}
            </div>
          )
        })}
      </div>
      <input
        ref={inputRef}
        id={id}
        className={styles.input}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={LENGTH}
        aria-label={label}
        aria-invalid={invalid}
        disabled={disabled}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
      />
    </div>
  )
}
