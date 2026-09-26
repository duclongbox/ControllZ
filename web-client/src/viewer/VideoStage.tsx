import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { useElementSize } from '../lib/hooks'
import { containFit, toFramePoint } from '../lib/normalise'
import type { FrameBox, Size } from '../lib/normalise'
import { DesktopFrame } from '../mock/DesktopFrame'
import { wheelDelta } from '../protocol/input'
import type { StagePointerSample, StageWheelSample } from './pointerControl'
import styles from './VideoStage.module.css'

export interface VideoStageProps {
  /**
   * Fallback size of the incoming track, used until the video reports its own
   * intrinsic size and whenever there is no stream at all.
   */
  trackSize: Size
  /**
   * The desktop's video. Null renders the placeholder frame instead, which is
   * what the design views and the mock driver rely on.
   */
  stream?: MediaStream | null
  /** 0…1 scrim over the frame — used behind sheets and the reconnect overlay. */
  dim?: number
  /** Paint the pillarbox/letterbox bars. Design and dev views only. */
  showGuides?: boolean
  /**
   * Raw pointer activity, mapped into frame space but not yet interpreted.
   *
   * The stage deliberately does not decide what a touch means: it reports where
   * the finger is and whether that is on the frame, and `PointerControl` turns
   * that into clicks and cursor moves. Bar touches are reported too, flagged
   * `inFrame: false` — trackpad mode needs them, direct mode drops them.
   */
  onPointer?: (sample: StagePointerSample) => void
  /**
   * A wheel or touchpad scroll over the stage. While set, the browser's own
   * scroll and zoom are suppressed there: the gesture belongs to the desktop.
   */
  onWheel?: (sample: StageWheelSample) => void
  /**
   * Any pointer activity at all, including the bars, with its `pointerType`.
   * Wakes the chrome — for a touch, anyway; see the viewer for the mouse.
   */
  onActivity?: (pointerType: string) => void
  /** Overlays that need to know where the frame actually is. */
  children?: (box: FrameBox | null) => ReactNode
}

export function VideoStage({
  trackSize,
  stream = null,
  dim = 0,
  showGuides = false,
  onPointer,
  onWheel,
  onActivity,
  children,
}: VideoStageProps) {
  const { ref, size } = useElementSize<HTMLDivElement>()
  const frameRef = useRef<HTMLDivElement>(null)
  const activePointer = useRef<number | null>(null)
  // A callback ref, not useRef: the frame only renders once the stage has been
  // measured, so the <video> mounts a render later than this component. An
  // effect keyed on `stream` alone would have run already, against a ref that
  // was still null, and the track would never be attached.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [intrinsic, setIntrinsic] = useState<Size | null>(null)

  // The track's real size is what the letterbox maths and the pointer mapping
  // must use: a stats-derived guess that disagrees with the decoded frame maps
  // touches to the wrong place on the desktop.
  useEffect(() => {
    if (!video) {
      setIntrinsic(null)
      return
    }
    if (video.srcObject !== stream) video.srcObject = stream

    const measure = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setIntrinsic({ width: video.videoWidth, height: video.videoHeight })
      }
    }
    measure()
    // `resize` also covers the desktop changing resolution mid-session.
    video.addEventListener('loadedmetadata', measure)
    video.addEventListener('resize', measure)
    return () => {
      video.removeEventListener('loadedmetadata', measure)
      video.removeEventListener('resize', measure)
    }
  }, [stream, video])

  const frameSize = stream !== null && intrinsic !== null ? intrinsic : trackSize
  const box = containFit(size, frameSize)

  const emit = useCallback(
    (kind: StagePointerSample['kind'], event: ReactPointerEvent<HTMLDivElement>) => {
      if (!onPointer) return
      const frame = frameRef.current
        ? toFramePoint(event, {
            getBoundingClientRect: () => frameRef.current!.getBoundingClientRect(),
            videoWidth: frameSize.width,
            videoHeight: frameSize.height,
          })
        : null
      onPointer({
        kind,
        frame,
        at: event.timeStamp,
        pointerType: event.pointerType,
        buttons: event.buttons,
      })
    },
    [onPointer, frameSize.height, frameSize.width],
  )

  // Native, not React's onWheel: React attaches wheel listeners as passive, and
  // a passive listener cannot preventDefault — so the page would scroll, and
  // Ctrl+wheel or a touchpad pinch would zoom the whole viewer, underneath
  // every scroll the desktop receives. Read through a ref so the listener is
  // attached once rather than on every frame-size change.
  const wheelRef = useRef<(event: WheelEvent) => void>(() => {})
  wheelRef.current = (event: WheelEvent) => {
    if (!onWheel) return
    event.preventDefault()
    // A touchpad pinch arrives as Ctrl+wheel. Zoom is a keyboard-modifier
    // gesture on the desktop, and without the keyboard channel it would land
    // as a plain scroll — swallowed until keys exist rather than mistranslated.
    if (event.ctrlKey) return
    const frame = frameRef.current
      ? toFramePoint(event, {
          getBoundingClientRect: () => frameRef.current!.getBoundingClientRect(),
          videoWidth: frameSize.width,
          videoHeight: frameSize.height,
        })
      : null
    onWheel({ frame, ...wheelDelta(event) })
  }

  useEffect(() => {
    const stage = ref.current
    if (!stage) return
    const listener = (event: WheelEvent) => wheelRef.current(event)
    stage.addEventListener('wheel', listener, { passive: false })
    return () => stage.removeEventListener('wheel', listener)
  }, [ref])

  const handleDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      onActivity?.(event.pointerType)
      // One pointer at a time. Multi-touch gestures are deferred, and letting a
      // second finger interleave would have it fight the first for the cursor.
      if (activePointer.current !== null) return
      activePointer.current = event.pointerId

      // Touch pointers are captured implicitly, mice are not — so without this
      // a drag that leaves the stage stops reporting and the button is never
      // released. Same reason `pointercancel` is handled at all.
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Not supported, or the pointer is already gone. Implicit capture on
        // touch still covers the case that matters on a phone.
      }
      emit('down', event)
    },
    [emit, onActivity],
  )

  const handleMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      onActivity?.(event.pointerType)
      // A mouse hovers: with nothing pressed it still has a position, and the
      // desktop cursor should follow it. A finger or pen does not report until
      // it touches, so for those only the active pointer counts.
      const hovering = event.pointerType === 'mouse' && activePointer.current === null
      if (!hovering && activePointer.current !== event.pointerId) return
      emit('move', event)
    },
    [emit, onActivity],
  )

  const handleEnd = useCallback(
    (kind: 'up' | 'cancel') => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (activePointer.current !== event.pointerId) return
      activePointer.current = null
      emit(kind, event)
    },
    [emit],
  )

  // The stage is the remote desktop, so the browser's own reading of a right
  // or middle click has to go: a context menu over the video, or Windows'
  // middle-click autoscroll cursor, would sit on top of the click the desktop
  // is about to receive.
  const suppressContextMenu = useCallback((event: ReactMouseEvent) => event.preventDefault(), [])
  const suppressAutoscroll = useCallback((event: ReactMouseEvent) => {
    if (event.button === 1) event.preventDefault()
  }, [])

  return (
    <div
      ref={ref}
      className={styles.stage}
      onContextMenu={suppressContextMenu}
      onMouseDown={suppressAutoscroll}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleEnd('up')}
      onPointerCancel={handleEnd('cancel')}
    >
      {box ? (
        <div
          ref={frameRef}
          className={styles.frame}
          style={{
            left: box.offsetX,
            top: box.offsetY,
            width: box.width,
            height: box.height,
          }}
        >
          {stream ? (
            // muted + playsInline are what let iOS Safari start it without a
            // tap; autoplay alone is refused.
            <video ref={setVideo} className={styles.video} autoPlay muted playsInline />
          ) : (
            <DesktopFrame />
          )}
        </div>
      ) : null}

      {showGuides && box && box.offsetX > 0.5 ? (
        <>
          <span className={cn(styles.guide, styles.guideStart)} style={{ width: box.offsetX }} />
          <span className={cn(styles.guide, styles.guideEnd)} style={{ width: box.offsetX }} />
        </>
      ) : null}

      {dim > 0 ? <div className={styles.dim} style={{ opacity: dim }} /> : null}

      {children ? <div className={styles.overlay}>{children(box)}</div> : null}
    </div>
  )
}
