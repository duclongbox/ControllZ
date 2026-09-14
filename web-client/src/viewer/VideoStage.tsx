import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { useElementSize } from '../lib/hooks'
import { containFit, toNormalised } from '../lib/normalise'
import type { FrameBox, NormalisedPoint, Size } from '../lib/normalise'
import { DesktopFrame } from '../mock/DesktopFrame'
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
   * Pointer activity inside the rendered frame, already normalised to 0…1.
   * Never fires for a touch in the bars — those are not desktop interactions.
   */
  onPointer?: (kind: 'move' | 'down' | 'up', point: NormalisedPoint) => void
  /** Any pointer activity at all, including the bars. Wakes the chrome. */
  onActivity?: () => void
  /** Overlays that need to know where the frame actually is. */
  children?: (box: FrameBox | null) => ReactNode
}

export function VideoStage({
  trackSize,
  stream = null,
  dim = 0,
  showGuides = false,
  onPointer,
  onActivity,
  children,
}: VideoStageProps) {
  const { ref, size } = useElementSize<HTMLDivElement>()
  const frameRef = useRef<HTMLDivElement>(null)
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

  const handle = useCallback(
    (kind: 'move' | 'down' | 'up') => (event: ReactPointerEvent<HTMLDivElement>) => {
      onActivity?.()
      if (!onPointer || !frameRef.current) return

      // Reuse the production mapping rather than a stage-local shortcut: the
      // dead-zone rejection is the whole point and must not be duplicated.
      const point = toNormalised(event, {
        getBoundingClientRect: () => frameRef.current!.getBoundingClientRect(),
        videoWidth: frameSize.width,
        videoHeight: frameSize.height,
      })
      if (point) onPointer(kind, point)
    },
    [onActivity, onPointer, frameSize.height, frameSize.width],
  )

  return (
    <div
      ref={ref}
      className={styles.stage}
      onPointerDown={handle('down')}
      onPointerMove={handle('move')}
      onPointerUp={handle('up')}
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
