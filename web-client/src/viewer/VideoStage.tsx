import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useCallback, useRef } from 'react'
import { cn } from '../lib/cn'
import { useElementSize } from '../lib/hooks'
import { containFit, toNormalised } from '../lib/normalise'
import type { FrameBox, NormalisedPoint, Size } from '../lib/normalise'
import { DesktopFrame } from '../mock/DesktopFrame'
import styles from './VideoStage.module.css'

export interface VideoStageProps {
  /** Size of the incoming track. At M1 this is `video.videoWidth/Height`. */
  trackSize: Size
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
  dim = 0,
  showGuides = false,
  onPointer,
  onActivity,
  children,
}: VideoStageProps) {
  const { ref, size } = useElementSize<HTMLDivElement>()
  const frameRef = useRef<HTMLDivElement>(null)
  const box = containFit(size, trackSize)

  const handle = useCallback(
    (kind: 'move' | 'down' | 'up') => (event: ReactPointerEvent<HTMLDivElement>) => {
      onActivity?.()
      if (!onPointer || !frameRef.current) return

      // Reuse the production mapping rather than a stage-local shortcut: the
      // dead-zone rejection is the whole point and must not be duplicated.
      const point = toNormalised(event, {
        getBoundingClientRect: () => frameRef.current!.getBoundingClientRect(),
        videoWidth: trackSize.width,
        videoHeight: trackSize.height,
      })
      if (point) onPointer(kind, point)
    },
    [onActivity, onPointer, trackSize.height, trackSize.width],
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
          <DesktopFrame />
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
