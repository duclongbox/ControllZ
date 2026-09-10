import { cn } from '../lib/cn'
import styles from './ModifierKey.module.css'

/**
 * A key in the M2 modifier bar.
 *
 * `code` is the physical `KeyboardEvent.code`, never a character: a soft
 * keyboard emitting "A" does not say which key to synthesise, and layouts
 * differ per OS.
 */
export function ModifierKey({
  label,
  code,
  active = false,
  square = false,
  onPress,
}: {
  label: string
  code: string
  active?: boolean
  square?: boolean
  onPress: (code: string) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(styles.key, active && styles.active, square && styles.square)}
      onClick={() => onPress(code)}
    >
      {label}
    </button>
  )
}
