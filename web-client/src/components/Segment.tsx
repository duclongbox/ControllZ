import { cn } from '../lib/cn'
import styles from './Segment.module.css'

export interface SegmentOption<T extends string> {
  value: T
  label: string
}

/** 2–3 options in a padded track. Used for the M2 pointer-mode switch. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  floating = false,
  label,
}: {
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (next: T) => void
  floating?: boolean
  label: string
}) {
  return (
    <div className={cn(styles.track, floating && styles.floating)} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={cn(styles.segment, option.value === value && styles.selected)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
