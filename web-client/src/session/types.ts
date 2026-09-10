import type { RejectReason } from '../protocol/types'

/**
 * Where the session is in its lifecycle.
 *
 * Note what is NOT here: `degraded` and `relayed`. Both are conditions of a
 * live session, not phases of it — the stream keeps running and the last
 * decoded frame stays on screen. They live on `transport` and `quality` so no
 * screen has to treat "quality dropped" as "connection lost".
 */
export const SESSION_PHASES = [
  'idle',
  'authorising',
  'negotiating',
  'gathering',
  'streaming',
  'reconnecting',
  'rejected',
  'ended',
] as const
export type SessionPhase = (typeof SESSION_PHASES)[number]

/** Which ICE candidate pair won. Drives the "Relayed" pill and its banner. */
export type Transport = 'direct' | 'relayed'

/** Where the encoder ladder currently sits. */
export type Quality = 'nominal' | 'degraded'

/** What the user asked the ladder to optimise for. */
export const QUALITY_PRIORITIES = ['auto', 'smooth', 'sharp'] as const
export type QualityPriority = (typeof QUALITY_PRIORITIES)[number]

/** Pointer interaction model on the stage. */
export const POINTER_MODES = ['trackpad', 'direct'] as const
export type PointerMode = (typeof POINTER_MODES)[number]

/** One rung of the connecting ladder. Every step names what it is waiting on. */
export interface ConnectStep {
  id: string
  label: string
  /** The signalling message or event this step corresponds to. */
  detail: string
  state: 'done' | 'active' | 'pending'
}

/** A display the desktop can capture. One at a time — see implementation-plan.md §2.9. */
export interface Display {
  id: string
  name: string
  width: number
  height: number
}

export interface Device {
  id: string
  name: string
  presence: 'online' | 'offline'
  /** How the last (or current) session reached it. */
  transport: Transport
  pairedAt: string
  lastConnectedAt: string
  displays: Display[]
}

/**
 * The 1 Hz readout. At M1 this comes from `RTCPeerConnection.getStats()`;
 * today the mock driver synthesises it. Shape is deliberately the subset the
 * overlay actually renders, not everything getStats() returns.
 */
export interface SessionStats {
  fps: number
  bitrateBps: number
  rttMs: number
  jitterMs: number
  lossFraction: number
  freezeCount: number
  width: number
  height: number
  decodeMs: number
  /** Human-readable winning candidate pair, e.g. "host ⇄ host". */
  candidatePair: string
  keyframes: number
}

export interface SessionState {
  phase: SessionPhase
  steps: ConnectStep[]
  transport: Transport
  quality: Quality
  stats: SessionStats | null
  /** Epoch ms when media started flowing, or null if it has not. */
  startedAt: number | null
  /** Set only when `phase === 'rejected'`. */
  rejectReason: RejectReason | null
  device: Device | null
  activeDisplayId: string | null
  qualityPriority: QualityPriority
}

export function initialSessionState(): SessionState {
  return {
    phase: 'idle',
    steps: [],
    transport: 'direct',
    quality: 'nominal',
    stats: null,
    startedAt: null,
    rejectReason: null,
    device: null,
    activeDisplayId: null,
    qualityPriority: 'auto',
  }
}

/** True while media is on screen — including degraded and relayed. */
export function isLive(state: SessionState): boolean {
  return state.phase === 'streaming' || state.phase === 'reconnecting'
}
