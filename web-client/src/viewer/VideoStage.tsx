import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
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
  /**
   * Keep focus where it is on a tap. With the soft keyboard up, a touch on
   * the stage would otherwise blur its textarea and dismiss the keyboard the
   * user just opened. Pointer events still flow; only the focus change and
   * the compatibility mouse events are cancelled.
   */
  holdFocus?: boolean
  /**
   * Silence the desktop's audio. True is the state the video element always
   * starts in — autoplay with sound is refused on a phone — and the stage
   * tries to unmute as soon as this goes false. If the browser refuses that
   * (iOS Safari, before any tap), the element stays muted and
   * `onAudioBlocked(true)` says so; the next pointer-down on the stage, which
   * is a user gesture, is used to unmute, as is `unmute()` on the handle.
   */
  muted?: boolean
  /** Whether sound is currently wanted but withheld by the browser. */
  onAudioBlocked?: (blocked: boolean) => void
  /** Overlays that need to know where the frame actually is. */
  children?: (box: FrameBox | null) => ReactNode
}

export interface VideoStageHandle {
  /**
   * Try to unmute from inside a user gesture. Resolves to whether sound is
   * now playing; a refusal leaves the video playing muted.
   */
  unmute: () => Promise<boolean>
}

/**
 * Unmute `video` and make sure it is playing. Returns whether that was
 * allowed. On refusal the element is put back the way it was: muted and
 * playing, since WebKit pauses a muted-autoplay video that is unmuted
 * outside a gesture, and a paused stage is a frozen desktop.
 */
async function tryUnmute(video: HTMLVideoElement): Promise<boolean> {
  video.muted = false
  try {
    await video.play()
    return true
  } catch {
    video.muted = true
    try {
      await video.play()
    } catch {
      // Still refused muted — autoplay itself will pick it up.
    }
    return false
  }
}

export const VideoStage = forwardRef<VideoStageHandle, VideoStageProps>(function VideoStage(
  {
    trackSize,
    stream = null,
    dim = 0,
    showGuides = false,
    onPointer,
    onWheel,
    onActivity,
    holdFocus = false,
    muted = true,
    onAudioBlocked,
    children,
  },
  handle,
) {
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

  // Sound. The element is muted whenever `muted` says so or the browser has
  // refused; `blocked` is the difference between those two, and is what a
  // gesture can fix. Read through refs inside event handlers so a stale
  // closure never unmutes against the user's wish.
  const blocked = useRef(false)
  const onAudioBlockedRef = useRef(onAudioBlocked)
  onAudioBlockedRef.current = onAudioBlocked
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  const setBlocked = useCallback((next: boolean) => {
    if (blocked.current === next) return
    blocked.current = next
    onAudioBlockedRef.current?.(next)
  }, [])

  const attemptUnmute = useCallback(
    async (target: HTMLVideoElement): Promise<boolean> => {
      const ok = await tryUnmute(target)
      // The answer is only meaningful while sound is still wanted: a toggle
      // off mid-attempt wins.
      if (mutedRef.current) {
        target.muted = true
        setBlocked(false)
        return false
      }
      setBlocked(!ok)
      return ok
    },
    [setBlocked],
  )

  useEffect(() => {
    if (!video) return
    if (muted || !stream) {
      video.muted = true
      setBlocked(false)
      return
    }
    void attemptUnmute(video)
  }, [attemptUnmute, muted, setBlocked, stream, video])

  useImperativeHandle(
    handle,
    () => ({
      unmute: async () => {
        if (!video || mutedRef.current) return false
        return attemptUnmute(video)
      },
    }),
    [attemptUnmute, video],
  )

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
      if (holdFocus) event.preventDefault()
      // A gesture, at last: the browser that refused sound on arrival will
      // allow it from in here.
      if (blocked.current && !mutedRef.current && video) void attemptUnmute(video)
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
    [attemptUnmute, emit, holdFocus, onActivity, video],
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
            // tap; autoplay alone is refused. Sound is switched on afterwards
            // by the effect above, once the picture is already moving.
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
})
