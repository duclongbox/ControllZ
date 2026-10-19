import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { IconButton } from '../components/IconButton'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import { StatusPill } from '../components/StatusPill'
import type { ConnectionStatus } from '../components/StatusPill'
import styles from './chrome.module.css'

/** The control set along the bottom bar. Order is deliberate: most-used left. */
export const VIEWER_ACTIONS = [
  { id: 'stats', icon: 'stats', label: 'Connection stats' },
  { id: 'keyboard', icon: 'keyboard', label: 'Keyboard' },
  { id: 'pointer', icon: 'pointer', label: 'Pointer mode' },
  { id: 'sound', icon: 'volume', label: 'Sound' },
  { id: 'quality', icon: 'quality', label: 'Quality' },
  { id: 'monitor', icon: 'monitor', label: 'Display' },
  { id: 'fullscreen', icon: 'fullscreen', label: 'Full screen' },
] as const satisfies ReadonlyArray<{ id: string; icon: IconName; label: string }>

export type ViewerAction = (typeof VIEWER_ACTIONS)[number]['id']

export function ViewerTopBar({
  deviceName,
  status,
  statusLabel,
  rttMs,
  visible,
  onBack,
}: {
  deviceName: string
  status: ConnectionStatus
  statusLabel: string
  rttMs: number | null
  visible: boolean
  onBack: () => void
}) {
  const tone = rttMs === null ? '' : rttMs > 140 ? styles.rttBad : rttMs > 80 ? styles.rttWarn : ''
  return (
    <div className={cn(styles.bar, styles.top, !visible && styles.hidden)} aria-hidden={!visible}>
      <div className={styles.identity}>
        <IconButton icon="chevron-left" label="Leave session" size="md" onClick={onBack} />
        <span className={styles.name}>{deviceName}</span>
        <StatusPill status={status} label={statusLabel} />
      </div>
      <div className={styles.rtt}>
        <span className={cn(styles.rttValue, tone)}>{rttMs === null ? '—' : Math.round(rttMs)}</span>
        <span className={styles.rttUnit}>ms</span>
      </div>
    </div>
  )
}

export function ViewerBottomBar({
  active,
  fullscreen = false,
  sound = true,
  visible,
  onAction,
  onEnd,
}: {
  active: ViewerAction | null
  /** The fullscreen control is a toggle, so it has to show which way it goes. */
  fullscreen?: boolean
  /** Sound likewise: the icon shows the current state, the tap flips it. */
  sound?: boolean
  visible: boolean
  onAction: (action: ViewerAction) => void
  onEnd: () => void
}) {
  return (
    <div className={cn(styles.bar, styles.bottom, !visible && styles.hidden)} aria-hidden={!visible}>
      <div className={styles.controls}>
        {VIEWER_ACTIONS.map((action) => {
          const isFullscreen = action.id === 'fullscreen' && fullscreen
          const isMuted = action.id === 'sound' && !sound
          return (
            <IconButton
              key={action.id}
              icon={isFullscreen ? 'fullscreen-exit' : isMuted ? 'volume-off' : action.icon}
              label={
                isFullscreen ? 'Exit full screen' : isMuted ? 'Sound off' : action.label
              }
              appearance={active === action.id || isFullscreen ? 'active' : 'ghost'}
              aria-pressed={action.id === 'sound' ? sound : undefined}
              onClick={() => onAction(action.id)}
            />
          )
        })}
      </div>
      <IconButton icon="power" label="End session" appearance="danger" onClick={onEnd} />
    </div>
  )
}

/**
 * The one control that is always up: the way into menu mode (both bars, the
 * stage paused). It lives in a corner so that whenever the picture leaves
 * black bars it sits in one and covers nothing; on a matching ratio it covers
 * one corner of the desktop and no more. Pointer-down is swallowed so a tap
 * on it keeps the soft keyboard's textarea focused.
 */
export function MenuButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className={styles.menu}>
      <IconButton
        icon={open ? 'close' : 'menu'}
        label={open ? 'Hide controls' : 'Show controls'}
        appearance={open ? 'active' : 'ghost'}
        onClick={onToggle}
        onPointerDown={(event) => event.preventDefault()}
      />
    </div>
  )
}

/**
 * Under the bars in menu mode: the tap that closes the menu lands here, so
 * none of it reaches the desktop. Not focusable, and pointer-down swallowed:
 * focus stays where it was, which with the soft keyboard up is its textarea.
 */
export function MenuScrim({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className={styles.menuScrim}
      aria-label="Close controls"
      tabIndex={-1}
      onClick={onClose}
      onPointerDown={(event) => event.preventDefault()}
    />
  )
}

export function FloatingControl({ children }: { children: ReactNode }) {
  return <div className={styles.floating}>{children}</div>
}

/**
 * Shown when sound is wanted but the browser is withholding it until it sees
 * a gesture (iOS Safari). The pill is that gesture: its click unmutes from
 * inside the handler. A tap on the stage does the same, so this is a hint as
 * much as a control, and it goes away on its own once sound is playing.
 */
export function SoundPrompt({ onClick }: { onClick: () => void }) {
  return (
    <div className={styles.soundPrompt}>
      <button type="button" className={styles.soundPromptButton} onClick={onClick}>
        <Icon name="volume" size={18} />
        Tap for sound
      </button>
    </div>
  )
}

export function ViewerBanner({ children }: { children: ReactNode }) {
  return <div className={styles.banner}>{children}</div>
}
