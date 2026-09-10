import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { IconButton } from '../components/IconButton'
import type { IconName } from '../components/Icon'
import { StatusPill } from '../components/StatusPill'
import type { ConnectionStatus } from '../components/StatusPill'
import styles from './chrome.module.css'

/** The control set along the bottom bar. Order is deliberate: most-used left. */
export const VIEWER_ACTIONS = [
  { id: 'stats', icon: 'stats', label: 'Connection stats' },
  { id: 'keyboard', icon: 'keyboard', label: 'Keyboard' },
  { id: 'pointer', icon: 'pointer', label: 'Pointer mode' },
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
    <div className={cn(styles.bar, styles.top, !visible && styles.hidden)}>
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
  visible,
  onAction,
  onEnd,
}: {
  active: ViewerAction | null
  visible: boolean
  onAction: (action: ViewerAction) => void
  onEnd: () => void
}) {
  return (
    <div className={cn(styles.bar, styles.bottom, !visible && styles.hidden)}>
      <div className={styles.controls}>
        {VIEWER_ACTIONS.map((action) => (
          <IconButton
            key={action.id}
            icon={action.icon}
            label={action.label}
            appearance={active === action.id ? 'active' : 'ghost'}
            onClick={() => onAction(action.id)}
          />
        ))}
      </div>
      <IconButton icon="power" label="End session" appearance="danger" onClick={onEnd} />
    </div>
  )
}

export function FloatingControl({ children }: { children: ReactNode }) {
  return <div className={styles.floating}>{children}</div>
}

export function ViewerBanner({ children }: { children: ReactNode }) {
  return <div className={styles.banner}>{children}</div>
}
