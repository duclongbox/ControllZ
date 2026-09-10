import { containFit, fromNormalised, letterboxKind, toNormalised } from '../src/lib/normalise'

/* The letterbox maths is the only real logic in the client right now, and the
 * one place a silent bug would be invisible: a wrong offset does not throw, it
 * just puts the cursor somewhere the user did not tap. */

function video(rect: { width: number; height: number; left?: number; top?: number }, track: { width: number; height: number }) {
  return {
    getBoundingClientRect: () =>
      ({
        width: rect.width,
        height: rect.height,
        left: rect.left ?? 0,
        top: rect.top ?? 0,
        right: (rect.left ?? 0) + rect.width,
        bottom: (rect.top ?? 0) + rect.height,
        x: rect.left ?? 0,
        y: rect.top ?? 0,
        toJSON: () => ({}),
      }) as DOMRect,
    videoWidth: track.width,
    videoHeight: track.height,
  }
}

describe('containFit', () => {
  it('pillarboxes a 16:9 track in a wider viewport', () => {
    // 844x390 phone landscape is 2.16:1 — wider than 16:9, so bars go on the sides.
    const box = containFit({ width: 844, height: 390 }, { width: 1920, height: 1080 })!
    expect(box).not.toBeNull()
    expect(box.height).toBeCloseTo(390, 5)
    expect(box.width).toBeCloseTo(693.33, 1)
    expect(box.offsetX).toBeCloseTo(75.33, 1)
    expect(box.offsetY).toBeCloseTo(0, 5)
    expect(letterboxKind(box)).toBe('pillarbox')
  })

  it('letterboxes a 16:9 track in a taller viewport', () => {
    const box = containFit({ width: 390, height: 844 }, { width: 1920, height: 1080 })!
    expect(box.width).toBeCloseTo(390, 5)
    expect(box.height).toBeCloseTo(219.375, 3)
    expect(box.offsetX).toBeCloseTo(0, 5)
    expect(box.offsetY).toBeCloseTo(312.3, 1)
    expect(letterboxKind(box)).toBe('letterbox')
  })

  it('fits exactly when the aspect ratios match', () => {
    const box = containFit({ width: 1600, height: 900 }, { width: 1920, height: 1080 })!
    expect(box.offsetX).toBeCloseTo(0, 5)
    expect(box.offsetY).toBeCloseTo(0, 5)
    expect(letterboxKind(box)).toBe('exact')
  })

  it('never scales beyond contain — the frame is not cropped', () => {
    const box = containFit({ width: 844, height: 390 }, { width: 1920, height: 1080 })!
    expect(box.width).toBeLessThanOrEqual(844)
    expect(box.height).toBeLessThanOrEqual(390)
  })

  it('returns null before a frame has decoded', () => {
    // videoWidth/videoHeight are 0 until the first frame arrives.
    expect(containFit({ width: 844, height: 390 }, { width: 0, height: 0 })).toBeNull()
    expect(containFit({ width: 0, height: 0 }, { width: 1920, height: 1080 })).toBeNull()
    expect(containFit({ width: 844, height: NaN }, { width: 1920, height: 1080 })).toBeNull()
  })
})

describe('toNormalised', () => {
  const el = video({ width: 844, height: 390 }, { width: 1920, height: 1080 })

  it('maps the centre of the frame to 0.5, 0.5', () => {
    expect(toNormalised({ clientX: 422, clientY: 195 }, el)).toEqual({
      nx: expect.closeTo(0.5, 5),
      ny: expect.closeTo(0.5, 5),
    })
  })

  it('maps the frame corners to 0 and 1', () => {
    // Derive the edges rather than hardcoding them: the boundary is exact, and
    // a value a fraction outside it is meant to be rejected, not clamped.
    const box = containFit({ width: 844, height: 390 }, { width: 1920, height: 1080 })!

    const topLeft = toNormalised({ clientX: box.offsetX, clientY: box.offsetY }, el)!
    expect(topLeft.nx).toBeCloseTo(0, 6)
    expect(topLeft.ny).toBeCloseTo(0, 6)

    const bottomRight = toNormalised(
      { clientX: box.offsetX + box.width, clientY: box.offsetY + box.height },
      el,
    )!
    expect(bottomRight.nx).toBeCloseTo(1, 6)
    expect(bottomRight.ny).toBeCloseTo(1, 6)
  })

  it('rejects a point a fraction outside the frame edge', () => {
    const box = containFit({ width: 844, height: 390 }, { width: 1920, height: 1080 })!
    expect(toNormalised({ clientX: box.offsetX - 0.01, clientY: 195 }, el)).toBeNull()
    expect(toNormalised({ clientX: box.offsetX + box.width + 0.01, clientY: 195 }, el)).toBeNull()
  })

  it('rejects a touch in the pillarbox bars rather than clamping it', () => {
    // This is the important one: clamping would slide every dead-zone touch
    // onto the nearest edge of the remote screen.
    expect(toNormalised({ clientX: 10, clientY: 195 }, el)).toBeNull()
    expect(toNormalised({ clientX: 838, clientY: 195 }, el)).toBeNull()
  })

  it('accounts for the element not being at the viewport origin', () => {
    const offset = video({ width: 844, height: 390, left: 100, top: 50 }, { width: 1920, height: 1080 })
    const centre = toNormalised({ clientX: 100 + 422, clientY: 50 + 195 }, offset)!
    expect(centre.nx).toBeCloseTo(0.5, 5)
    expect(centre.ny).toBeCloseTo(0.5, 5)
  })

  it('returns null before a frame has decoded', () => {
    const blank = video({ width: 844, height: 390 }, { width: 0, height: 0 })
    expect(toNormalised({ clientX: 422, clientY: 195 }, blank)).toBeNull()
  })

  it('is unaffected by a resolution change — the whole point of 0…1', () => {
    const hd = video({ width: 844, height: 390 }, { width: 1920, height: 1080 })
    const sd = video({ width: 844, height: 390 }, { width: 1280, height: 720 })
    expect(toNormalised({ clientX: 500, clientY: 200 }, hd)).toEqual(
      toNormalised({ clientX: 500, clientY: 200 }, sd),
    )
  })
})

describe('fromNormalised', () => {
  it('round-trips through toNormalised', () => {
    const el = video({ width: 844, height: 390 }, { width: 1920, height: 1080 })
    const box = containFit({ width: 844, height: 390 }, { width: 1920, height: 1080 })!
    const point = toNormalised({ clientX: 500, clientY: 200 }, el)!
    const back = fromNormalised(point, box)
    expect(back.x).toBeCloseTo(500, 3)
    expect(back.y).toBeCloseTo(200, 3)
  })
})
