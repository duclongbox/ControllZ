import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Banner } from '../components/Banner'
import { ListGroup, ListRow } from '../components/List'
import { SegmentedControl } from '../components/Segment'
import type { ConnectionStatus } from '../components/StatusPill'
import { useAutoHide, useWakeLock } from '../lib/hooks'
import type { NormalisedPoint } from '../lib/normalise'
import { formatResolution } from '../lib/format'
import { useSession, useSessionClient } from '../session/useSession'
import { getDevice, markConnected } from '../store/devices'
import { setPref, usePrefs } from '../store/prefs'
import type { PointerMode, QualityPriority, SessionState } from '../session/types'
import { PointerControl } from '../viewer/pointerControl'
import type { StagePointerSample } from '../viewer/pointerControl'
import { VideoStage } from '../viewer/VideoStage'
import { FloatingControl, ViewerBanner, ViewerBottomBar, ViewerTopBar } from '../viewer/chrome'
import type { ViewerAction } from '../viewer/chrome'
import {
  CursorPuck,
  ModifierBar,
  PanelFootNote,
  PanelSection,
  ReconnectOverlay,
  SidePanel,
  StatsOverlay,
} from '../viewer/panels'
import { Connecting } from './Connecting'
import { ConnectRejected } from './ConnectRejected'
import { SessionEnded } from './SessionEnded'
import styles from './Viewer.module.css'

type Overlay = Exclude<ViewerAction, 'fullscreen'> | null

const QUALITY_OPTIONS: Array<{ value: QualityPriority; label: string; sub: string }> = [
  { value: 'auto', label: 'Automatic', sub: 'Adapts to the link, 1 s loop' },
  { value: 'smooth', label: 'Smooth', sub: 'Hold frame rate, drop resolution first' },
  { value: 'sharp', label: 'Sharp', sub: 'Hold resolution, allow frame drops' },
]

function statusFor(state: SessionState): { status: ConnectionStatus; label: string } {
  if (state.phase === 'reconnecting') return { status: 'connecting', label: 'Reconnecting' }
  if (state.transport === 'relayed') return { status: 'relayed', label: 'Relayed' }
  if (state.quality === 'degraded') return { status: 'degraded', label: 'Degraded' }
  return { status: 'live', label: 'Live' }
}

export function Viewer() {
  const { deviceId = '' } = useParams()
  const navigate = useNavigate()
  const client = useSessionClient()
  const state = useSession()
  const prefs = usePrefs()

  /* The session client never learns a name — the wire carries device ids and
   * nothing else — so every screen under here would otherwise say "Computer".
   * The name the user gave it is in this phone's own device list. */
  const deviceName = state.device?.name ?? getDevice(deviceId)?.name ?? 'Your computer'

  // Both of these open at the user's stored preference and are then theirs to
  // change for the rest of the session; the panel writes the change back, so
  // the next session starts where this one ended.
  const [overlay, setOverlay] = useState<Overlay>(prefs.showStats ? 'stats' : null)
  const [pointerMode, setPointerMode] = useState<PointerMode>(prefs.pointerMode)
  const [latched, setLatched] = useState<string[]>([])

  // The virtual cursor lives in PointerControl, not in React state: it is
  // updated on every pointer sample, and routing 120 Hz of that through a
  // re-render would make the gesture rules depend on render timing. `cursor`
  // here is only what the puck is drawn from.
  const controlRef = useRef<PointerControl | null>(null)
  if (controlRef.current === null) controlRef.current = new PointerControl()
  const control = controlRef.current
  const [cursor, setCursor] = useState<NormalisedPoint>(control.getCursor())

  // Chrome holds open while a panel is up — hiding it under an open sheet would
  // strand the user with no way back. A delay of 0 is the "never hide"
  // setting, which is the same thing as the auto-hide being disabled.
  const { visible, wake, hold } = useAutoHide(
    prefs.hideChromeAfterMs || 3000,
    overlay === null && prefs.hideChromeAfterMs > 0,
  )

  // Only while media is actually flowing: a lock held through a ten-second
  // handshake that then fails is a lock taken for nothing.
  useWakeLock(prefs.wakeLock && state.phase === 'streaming')

  // The device list says when each computer last worked. This is the only
  // place that knows the answer.
  useEffect(() => {
    if (state.phase === 'streaming' && deviceId) markConnected(deviceId, state.transport)
  }, [state.phase, state.transport, deviceId])

  useEffect(() => {
    if (deviceId) client.connect(deviceId)
    return () => client.end()
  }, [client, deviceId])

  useEffect(() => {
    if (overlay !== null) hold()
  }, [overlay, hold])

  const handlePointer = useCallback(
    (sample: StagePointerSample) => {
      for (const intent of control.handle(sample)) {
        // Only on press. A vibration per move would fire at the sample rate,
        // which is a phone buzzing continuously through a drag.
        if (intent.kind === 'down' && prefs.haptics) navigator.vibrate?.(8)
        client.sendPointer(intent)
      }
      setCursor(control.getCursor())
    },
    [client, control, prefs.haptics],
  )

  // Switching modes abandons whatever gesture is in flight, so a button held in
  // direct mode has to be released — the trackpad gesture that follows will
  // never send the `up` for it.
  useEffect(() => {
    for (const intent of control.setMode(pointerMode)) {
      client.sendPointer(intent)
    }
  }, [client, control, pointerMode])

  // Same hazard when a panel opens over the stage: the stage stops reporting
  // mid-drag, so the release that was coming never arrives. The host's deadman
  // would eventually let go, but a second of stuck mouse button is a second of
  // the desktop doing something nobody asked for.
  useEffect(() => {
    if (overlay === null) return
    for (const intent of control.abandon()) {
      client.sendPointer(intent)
    }
  }, [client, control, overlay])

  // Same hazard at the end of the session: a finger still down when the stage
  // unmounts owes the desktop a release. The host's deadman covers the case
  // where this never arrives; this is the case where it can.
  useEffect(() => {
    return () => {
      for (const intent of control.abandon()) {
        client.sendPointer(intent)
      }
    }
  }, [client, control])

  const handleAction = useCallback(
    (action: ViewerAction) => {
      wake()
      if (action === 'fullscreen') {
        void document.documentElement.requestFullscreen?.().catch(() => {})
        return
      }
      setOverlay((current) => (current === action ? null : action))
    },
    [wake],
  )

  const toggleLatch = useCallback((code: string) => {
    setLatched((keys) => (keys.includes(code) ? keys.filter((k) => k !== code) : [...keys, code]))
  }, [])

  const sendKey = useCallback(
    (code: string) => {
      client.sendKey('down', code, latched)
      client.sendKey('up', code, latched)
      setLatched([])
    },
    [client, latched],
  )

  // ---- non-streaming phases render their own screen -----------------------

  if (state.phase === 'rejected' && state.rejectReason) {
    return (
      <ConnectRejected reason={state.rejectReason} deviceName={deviceName} />
    )
  }

  if (state.phase === 'ended') {
    return (
      <SessionEnded
        deviceName={deviceName}
        deviceId={state.device?.id ?? deviceId}
        durationSeconds={state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0}
        averageFps={state.stats?.fps ?? null}
        relayed={state.transport === 'relayed'}
      />
    )
  }

  if (state.phase !== 'streaming' && state.phase !== 'reconnecting') {
    return (
      <Connecting
        deviceName={deviceName}
        steps={state.steps}
        onCancel={() => navigate('/')}
      />
    )
  }

  // ---- live ---------------------------------------------------------------

  const { status, label } = statusFor(state)
  const track = state.stats
    ? { width: state.stats.width, height: state.stats.height }
    : { width: 1920, height: 1080 }
  const dim = overlay === 'quality' || overlay === 'monitor' ? 0.45 : 0
  const reconnecting = state.phase === 'reconnecting'
  const activeDisplay = state.device?.displays.find((d) => d.id === state.activeDisplayId)

  return (
    <div className={styles.viewer}>
      <VideoStage
        trackSize={track}
        stream={state.stream}
        dim={reconnecting ? 0.66 : dim}
        onActivity={wake}
        onPointer={overlay === null ? handlePointer : undefined}
      >
        {(box) =>
          pointerMode === 'trackpad' && !reconnecting ? (
            <CursorPuck point={cursor} box={box} />
          ) : null
        }
      </VideoStage>

      <div className={styles.chrome}>
        {reconnecting ? (
          <ReconnectOverlay onEnd={() => client.end()} />
        ) : (
          <>
            <ViewerTopBar
              deviceName={deviceName}
              status={status}
              statusLabel={label}
              rttMs={state.stats?.rttMs ?? null}
              visible={visible}
              onBack={() => client.end()}
            />

            <ViewerBottomBar
              active={overlay}
              visible={visible}
              onAction={handleAction}
              onEnd={() => client.end()}
            />

            {state.transport === 'relayed' && overlay === null && visible ? (
              <ViewerBanner>
                <Banner tone="warn" title="Relayed connection">
                  No direct path to {deviceName}, so media is going
                  through the TURN relay. Capped to keep it smooth.
                </Banner>
              </ViewerBanner>
            ) : null}

            {overlay === 'stats' && state.stats ? <StatsOverlay stats={state.stats} /> : null}

            {overlay === 'pointer' ? (
              <FloatingControl>
                <SegmentedControl
                  label="Pointer mode"
                  floating
                  value={pointerMode}
                  onChange={(mode) => {
                    setPointerMode(mode)
                    setPref('pointerMode', mode)
                  }}
                  options={[
                    { value: 'trackpad', label: 'Trackpad' },
                    { value: 'direct', label: 'Direct' },
                  ]}
                />
              </FloatingControl>
            ) : null}

            {overlay === 'keyboard' ? (
              <ModifierBar latched={latched} onToggle={toggleLatch} onKey={sendKey} />
            ) : null}

            {overlay === 'quality' ? (
              <SidePanel
                title="Quality"
                onClose={() => setOverlay(null)}
                footer={<PanelFootNote label="Ceiling" value="1080p · 12 Mb/s" />}
              >
                <PanelSection label="PRIORITY">
                  <ListGroup>
                    {QUALITY_OPTIONS.map((option) => (
                      <ListRow
                        key={option.value}
                        label={option.label}
                        sub={option.sub}
                        selected={state.qualityPriority === option.value}
                        onClick={() => client.setQualityPriority(option.value)}
                      />
                    ))}
                  </ListGroup>
                </PanelSection>
              </SidePanel>
            ) : null}

            {overlay === 'monitor' ? (
              <SidePanel
                title="Display"
                onClose={() => setOverlay(null)}
                footer={
                  <PanelFootNote
                    label="Switching forces a keyframe"
                    value={activeDisplay ? formatResolution(activeDisplay.width, activeDisplay.height) : '—'}
                  />
                }
              >
                <PanelSection label="CAPTURED DISPLAY">
                  <ListGroup>
                    {(state.device?.displays ?? []).map((display) => (
                      <ListRow
                        key={display.id}
                        label={display.name}
                        value={formatResolution(display.width, display.height)}
                        selected={display.id === state.activeDisplayId}
                        onClick={() => client.setDisplay(display.id)}
                      />
                    ))}
                  </ListGroup>
                </PanelSection>
              </SidePanel>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
