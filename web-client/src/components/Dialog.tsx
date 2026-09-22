import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import type { ButtonVariant } from './Button'
import styles from './Dialog.module.css'

/**
 * A modal confirmation, for the one thing in the app that cannot be undone.
 *
 * Deliberately not a generic dialog system: it takes a question and two
 * answers. Anything richer than that belongs on a screen with a URL, so the
 * user can leave it with Back.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  confirmVariant = 'danger',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  confirmVariant?: ButtonVariant
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus lands on Cancel, not Confirm: a stray Enter on an open dialog should
  // do the harmless thing.
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <>
      <div className={styles.scrim} onClick={onCancel} />
      <div className={styles.dialog} role="alertdialog" aria-modal="true" aria-label={title}>
        <span className={styles.title}>{title}</span>
        <p className={styles.body}>{children}</p>
        <div className={styles.actions}>
          <Button label={confirmLabel} variant={confirmVariant} full onClick={onConfirm} />
          <Button
            ref={cancelRef}
            label={cancelLabel}
            variant="ghost"
            full
            onClick={onCancel}
          />
        </div>
      </div>
    </>
  )
}
