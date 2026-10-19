import type { FormEvent } from 'react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { TextComposer } from './textComposer'
import type { ComposerIntent, ComposerState } from './textComposer'
import styles from './panels.module.css'

/** How long after the textarea blurs before the overlay is taken as dismissed. */
const DISMISS_GRACE_MS = 150

export interface SoftKeyboardHandle {
  /** Forget the typed context — the remote caret moved some other way. */
  reset(): void
  /** Bring the OS keyboard back. Only works from inside a user gesture. */
  focus(): void
  /** Whether `target` is this composer's textarea. */
  owns(target: EventTarget | null): boolean
}

/**
 * The hidden textarea the phone's keyboard types into.
 *
 * Mounting it focuses it, which is what raises the OS keyboard — so it has to
 * mount inside the tap that asked for the keyboard (iOS refuses a focus() from
 * anywhere else). It is never cleared between keystrokes; see TextComposer for
 * why. Every change becomes intents for the parent to send.
 */
export const SoftKeyboard = forwardRef<
  SoftKeyboardHandle,
  {
    onIntent: (intent: ComposerIntent) => void
    /** The OS keyboard went away on its own (its hide key, mostly). */
    onDismiss: () => void
  }
>(function SoftKeyboard({ onIntent, onDismiss }, ref) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<TextComposer | null>(null)
  if (composerRef.current === null) composerRef.current = new TextComposer()
  const composer = composerRef.current
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const write = useCallback((state: ComposerState | null) => {
    const el = textarea.current
    if (!el || !state) return
    el.value = state.value
    el.setSelectionRange(state.caret, state.caret)
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      reset: () => write(composer.reset()),
      focus: () => textarea.current?.focus(),
      owns: (target) => target !== null && target === textarea.current,
    }),
    [composer, write],
  )

  // Layout effect, not effect: it runs inside the commit, which for a tap is
  // still inside the tap — the gesture iOS wants to see behind a focus().
  useLayoutEffect(() => {
    write(composer.reset())
    textarea.current?.focus()
  }, [composer, write])

  useEffect(() => () => clearTimeout(dismissTimer.current), [])

  const handleInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const el = event.currentTarget
      const { intents, write: next } = composer.handleInput(el.value, el.selectionStart)
      for (const intent of intents) onIntent(intent)
      write(next)
    },
    [composer, onIntent, write],
  )

  // Safari has fired compositionend before the final input event, Chrome
  // after. Settling on compositionend handles both: a diff already handled
  // is empty, and a padding restore is overdue either way.
  const handleCompositionEnd = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      composer.setComposing(false)
      handleInput(event)
    },
    [composer, handleInput],
  )

  // A blur means the keyboard is going (its own hide key), or focus is moving
  // to one of our buttons — whose tap is about to change the overlay anyway,
  // and unmounts this before the grace period is up.
  const handleBlur = useCallback(() => {
    clearTimeout(dismissTimer.current)
    dismissTimer.current = setTimeout(onDismiss, DISMISS_GRACE_MS)
  }, [onDismiss])

  return (
    <textarea
      ref={textarea}
      className={styles.composer}
      aria-label="Type on the computer"
      autoCapitalize="sentences"
      autoCorrect="on"
      spellCheck={false}
      enterKeyHint="enter"
      rows={1}
      onInput={handleInput}
      onCompositionStart={() => composer.setComposing(true)}
      onCompositionEnd={handleCompositionEnd}
      onBlur={handleBlur}
    />
  )
})
