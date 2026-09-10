import type { ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { StatChip } from '../components/StatChip'
import { ModifierKey } from '../components/ModifierKey'
import { Button } from '../components/Button'
import { Spinner } from '../components/Feedback'
import { formatBitrate, formatLoss, formatMs, formatResolution } from '../lib/format'
import type { FrameBox, NormalisedPoint } from '../lib/normalise'
import { fromNormalised } from '../lib/normalise'
import type { SessionStats } from '../session/types'
import styles from './panels.module.css'

/* ------------------------------------------------------------------ panel */

export function SidePanel({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <aside className={styles.panel} aria-label={title}>
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>{title}</span>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {children}
      {footer}
    </aside>
  )
}

export function PanelSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <span className={styles.statsLabel}>{label}</span>
      {children}
    </div>
  )
}

export function PanelFootNote({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.footNote}>
      <span className={styles.footLabel}>{label}</span>
      <span className={styles.footValue}>{value}</span>
    </div>
  )
}

/* ------------------------------------------------------------ stats card */

/** Thresholds that turn a readout amber or red. Tuned to the M1 targets. */
function fpsTone(fps: number) {
  return fps >= 50 ? 'good' : fps >= 25 ? 'warn' : 'bad'
}
function rttTone(ms: number) {
  return ms <= 80 ? 'good' : ms <= 140 ? 'warn' : 'bad'
}
function lossTone(fraction: number) {
  return fraction <= 0.005 ? 'good' : fraction <= 0.03 ? 'warn' : 'bad'
}

export function StatsOverlay({ stats }: { stats: SessionStats }) {
  return (
    <div className={styles.stats} aria-label="Connection stats">
      <div className={styles.statsHead}>
        <span className={styles.statsLabel}>LIVE STATS · 1 Hz</span>
        <span className={styles.statsCodec}>H.264 CB</span>
      </div>

      <div className={styles.statsGrid}>
        <StatChip caption="FPS" value={stats.fps.toFixed(1)} tone={fpsTone(stats.fps)} />
        <StatChip
          caption="BITRATE"
          value={formatBitrate(stats.bitrateBps)}
          tone={stats.bitrateBps > 6_000_000 ? 'good' : 'warn'}
        />
        <StatChip caption="RTT" value={formatMs(stats.rttMs)} tone={rttTone(stats.rttMs)} />
        <StatChip caption="JITTER" value={formatMs(stats.jitterMs, 1)} tone="good" />
        <StatChip
          caption="LOSS"
          value={formatLoss(stats.lossFraction)}
          tone={lossTone(stats.lossFraction)}
        />
        <StatChip
          caption="FREEZES"
          value={String(stats.freezeCount)}
          tone={stats.freezeCount === 0 ? 'good' : 'warn'}
        />
      </div>

      <div className={styles.rule} />

      <div className={styles.statsRows}>
        <StatsRow label="Resolution" value={formatResolution(stats.width, stats.height)} />
        <StatsRow label="Decode" value={`${stats.decodeMs.toFixed(1)} ms/frame`} />
        <StatsRow label="Candidate pair" value={stats.candidatePair} />
        <StatsRow label="Keyframes" value={`${stats.keyframes} (PLI-driven)`} />
      </div>
    </div>
  )
}

function StatsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statsRow}>
      <span className={styles.statsRowKey}>{label}</span>
      <span className={styles.statsRowValue}>{value}</span>
    </div>
  )
}

/* ------------------------------------------------------------ cursor puck */

/** The synthetic cursor, drawn where the desktop reported it. */
export function CursorPuck({ point, box }: { point: NormalisedPoint; box: FrameBox | null }) {
  if (!box) return null
  const { x, y } = fromNormalised(point, box)
  return (
    <div className={styles.puck} style={{ left: x, top: y }}>
      <span className={styles.halo} />
      <Icon name="pointer" size={22} strokeWidth={2} />
    </div>
  )
}

/* --------------------------------------------------------- modifier bar */

const MODIFIERS = [
  { label: 'esc', code: 'Escape', sticky: false },
  { label: 'tab', code: 'Tab', sticky: false },
  { label: 'ctrl', code: 'ControlLeft', sticky: true },
  { label: 'alt', code: 'AltLeft', sticky: true },
  { label: '⌘', code: 'MetaLeft', sticky: true },
  { label: 'shift', code: 'ShiftLeft', sticky: true },
] as const

const ARROWS = [
  { label: '←', code: 'ArrowLeft' },
  { label: '↓', code: 'ArrowDown' },
  { label: '↑', code: 'ArrowUp' },
  { label: '→', code: 'ArrowRight' },
] as const

/**
 * Sits directly above the OS keyboard. We never draw a keyboard ourselves —
 * the real one renders on top, and a painted fake would read as doubled up.
 */
export function ModifierBar({
  latched,
  onToggle,
  onKey,
}: {
  latched: readonly string[]
  onToggle: (code: string) => void
  onKey: (code: string) => void
}) {
  return (
    <div className={styles.modifiers}>
      {MODIFIERS.map((key) => (
        <ModifierKey
          key={key.code}
          label={key.label}
          code={key.code}
          active={latched.includes(key.code)}
          onPress={key.sticky ? onToggle : onKey}
        />
      ))}
      <span className={styles.modSpacer} />
      {ARROWS.map((key) => (
        <ModifierKey key={key.code} label={key.label} code={key.code} square onPress={onKey} />
      ))}
    </div>
  )
}

/* --------------------------------------------------------- reconnecting */

export function ReconnectOverlay({ onEnd }: { onEnd: () => void }) {
  return (
    <div className={styles.reconnect}>
      <Spinner large />
      <span className={styles.reconnectTitle}>Reconnecting…</span>
      <p className={styles.reconnectBody}>
        The network changed. Restarting ICE — the last frame stays on screen so you keep your place.
      </p>
      <Button label="End session" variant="secondary" onClick={onEnd} />
    </div>
  )
}
