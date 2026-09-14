import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Banner } from '../components/Banner'
import { ListGroup, ListRow } from '../components/List'
import { SegmentedControl } from '../components/Segment'
import type { ConnectionStatus } from '../components/StatusPill'
import { useAutoHide } from '../lib/hooks'
import type { NormalisedPoint } from '../lib/normalise'
import { formatResolution } from '../lib/format'
import { useSession, useSessionClient } from '../session/useSession'
import type { PointerMode, QualityPriority, SessionState } from '../session/types'
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

  const [overlay, setOverlay] = useState<Overlay>(null)
  const [pointerMode, setPointerMode] = useState<PointerMode>('trackpad')
  const [cursor, setCursor] = useState<NormalisedPoint | null>({ nx: 0.62, ny: 0.44 })
  const [latched, setLatched] = useState<string[]>([])

  // Chrome holds open while a panel is up — hiding it under an open sheet would
  // strand the user with no way back.
  const { visible, wake, hold } = useAutoHide(3000, overlay === null)

  useEffect(() => {
    if (deviceId) client.connect(deviceId)
    return () => client.end()
  }, [client, deviceId])

  useEffect(() => {
    if (overlay !== null) hold()
  }, [overlay, hold])

  const handlePointer = useCallback(
    (kind: 'move' | 'down' | 'up', point: NormalisedPoint) => {
      setCursor(point)
      client.sendPointer(kind, point)
    },
    [client],
  )

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
      <ConnectRejected reason={state.rejectReason} deviceName={state.device?.name ?? 'Computer'} />
    )
  }

  if (state.phase === 'ended') {
    return (
      <SessionEnded
        deviceName={state.device?.name}
        deviceId={state.device?.id}
        durationSeconds={state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0}
        averageFps={state.stats?.fps ?? null}
        relayed={state.transport === 'relayed'}
      />
    )
  }

  if (state.phase !== 'streaming' && state.phase !== 'reconnecting') {
    return (
      <Connecting
        deviceName={state.device?.name ?? 'your computer'}
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
          pointerMode === 'trackpad' && cursor && !reconnecting ? (
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
              deviceName={state.device?.name ?? 'Computer'}
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
                  No direct path to {state.device?.name ?? 'this computer'}, so media is going
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
                  onChange={setPointerMode}
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
