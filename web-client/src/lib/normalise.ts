/* Letterbox / coordinate mapping.
 *
 * The video is contain-fit, so the rendered frame almost never fills the
 * viewport: a 16:9 track in a 2.16:1 landscape phone leaves a pillarbox bar
 * down each side. A touch in those bars is not a touch on the desktop.
 *
 * Coordinates travel as fractions of the frame (0…1), never pixels. The input
 * channel is unordered and unreliable, so a resolution change on the desktop
 * and an in-flight coordinate can cross; sending 0…1 makes every packet
 * self-contained, with no shared mutable state between the two ends to fall out
 * of sync. It also means the phone never learns the desktop resolution.
 *
 * See docs/ui-spec.md §4. */

/** Where the rendered frame actually sits inside its element. */
export interface FrameBox {
  /** Rendered frame width in CSS px. */
  width: number
  /** Rendered frame height in CSS px. */
  height: number
  /** Left offset of the frame inside the element (pillarbox bar width). */
  offsetX: number
  /** Top offset of the frame inside the element (letterbox bar height). */
  offsetY: number
  /** Uniform contain-fit scale applied to the track. */
  scale: number
}

/** A point on the remote desktop, as a fraction of the frame. */
export interface NormalisedPoint {
  nx: number
  ny: number
}

export interface Size {
  width: number
  height: number
}

/**
 * Compute the contain-fit box for a track of `track` size rendered into an
 * element of `element` size.
 *
 * Returns `null` when either size is degenerate — most often because no frame
 * has decoded yet, so `videoWidth`/`videoHeight` are still 0.
 */
export function containFit(element: Size, track: Size): FrameBox | null {
  if (
    !Number.isFinite(element.width) ||
    !Number.isFinite(element.height) ||
    !Number.isFinite(track.width) ||
    !Number.isFinite(track.height) ||
    element.width <= 0 ||
    element.height <= 0 ||
    track.width <= 0 ||
    track.height <= 0
  ) {
    return null
  }

  const scale = Math.min(element.width / track.width, element.height / track.height)
  const width = track.width * scale
  const height = track.height * scale

  return {
    width,
    height,
    offsetX: (element.width - width) / 2,
    offsetY: (element.height - height) / 2,
    scale,
  }
}

/**
 * Map a client-space point (a pointer event's `clientX`/`clientY`) onto the
 * remote desktop, as a 0…1 fraction of the rendered frame.
 *
 * Returns `null` when the point falls in a letterbox bar, or when no frame has
 * decoded yet. Callers must treat `null` as "not a desktop interaction" and
 * drop the event rather than clamping it — clamping would slide every dead-zone
 * touch onto the nearest edge of the remote screen.
 */
export function toNormalised(
  point: { clientX: number; clientY: number },
  video: { getBoundingClientRect(): DOMRect; videoWidth: number; videoHeight: number },
): NormalisedPoint | null {
  const rect = video.getBoundingClientRect()
  const box = containFit(
    { width: rect.width, height: rect.height },
    { width: video.videoWidth, height: video.videoHeight },
  )
  if (!box) return null

  const nx = (point.clientX - rect.left - box.offsetX) / box.width
  const ny = (point.clientY - rect.top - box.offsetY) / box.height

  // A touch exactly on the far edge computes to 1 + 2e-16 because offsetX and
  // width do not sum back exactly. Tolerate that much and no more: the bars are
  // tens of pixels wide, so a real dead-zone touch is never within EPSILON.
  if (nx < -EPSILON || nx > 1 + EPSILON || ny < -EPSILON || ny > 1 + EPSILON) return null

  return { nx: clamp01(nx), ny: clamp01(ny) }
}

const EPSILON = 1e-6

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * Inverse of {@link toNormalised}: where a normalised desktop point lands
 * inside the element, in CSS px. Used to draw the synthetic cursor at the
 * position the desktop actually reported, rather than where the finger is.
 */
export function fromNormalised(point: NormalisedPoint, box: FrameBox): { x: number; y: number } {
  return {
    x: box.offsetX + point.nx * box.width,
    y: box.offsetY + point.ny * box.height,
  }
}

/** Which bars a given fit produces — used by the scaling documentation. */
export function letterboxKind(box: FrameBox): 'pillarbox' | 'letterbox' | 'exact' {
  if (box.offsetX > box.offsetY + 0.5) return 'pillarbox'
  if (box.offsetY > box.offsetX + 0.5) return 'letterbox'
  return 'exact'
}
