import { describe, expect, it } from 'vitest'
import { KeyboardControl, detectPlatform } from '../src/viewer/keyboardControl'
import type { ClientPlatform, KeySample } from '../src/viewer/keyboardControl'
import type { KeyIntent } from '../src/protocol/input'

/* Each rule here undoes one way a browser misreports the keyboard. Forwarded
 * as-is, each would leave the desktop with a key stuck down, typed twice, or
 * pressed that nobody pressed — so the tests are written as those failures. */

let clock = 0
function down(code: string, repeat = false): KeySample {
  return { type: 'keydown', code, repeat, at: (clock += 5) }
}
function up(code: string): KeySample {
  return { type: 'keyup', code, repeat: false, at: (clock += 5) }
}

/** Compact "+KeyA" / "-KeyA" / "*KeyA" (repeat) notation. */
function run(platform: ClientPlatform, samples: KeySample[]): string[] {
  const control = new KeyboardControl(platform)
  return samples.flatMap((sample) => control.handle(sample)).map(show)
}
function show(intent: KeyIntent): string {
  return `${intent.kind === 'up' ? '-' : intent.repeat ? '*' : '+'}${intent.code}`
}

describe('ordinary typing', () => {
  it('forwards presses and releases by physical code', () => {
    expect(run('other', [down('KeyA'), up('KeyA'), down('Digit1'), up('Digit1')])).toEqual([
      '+KeyA',
      '-KeyA',
      '+Digit1',
      '-Digit1',
    ])
  })

  it('wraps a shifted letter in its Shift', () => {
    expect(run('other', [down('ShiftLeft'), down('KeyA'), up('KeyA'), up('ShiftLeft')])).toEqual([
      '+ShiftLeft',
      '+KeyA',
      '-KeyA',
      '-ShiftLeft',
    ])
  })

  it('forwards autorepeat, which no host generates for a synthesised key', () => {
    expect(run('other', [down('Backspace'), down('Backspace', true), up('Backspace')])).toEqual([
      '+Backspace',
      '*Backspace',
      '-Backspace',
    ])
  })

  it('drops modifier autorepeat, which Windows sends for a held Shift', () => {
    expect(
      run('windows', [down('ShiftLeft'), down('ShiftLeft', true), down('ShiftLeft', true)]),
    ).toEqual(['+ShiftLeft'])
  })

  it('does not send a release for a key it never saw pressed', () => {
    // Held before the viewer had focus.
    expect(run('other', [up('KeyQ')])).toEqual([])
  })

  it('ignores events with no physical key, as soft keyboards send', () => {
    expect(run('other', [down(''), up('')])).toEqual([])
  })
})

describe('Mac client: no keyup while Command is held', () => {
  it('releases a Command-chord key immediately, so Cmd+C cannot leave C stuck', () => {
    expect(run('mac', [down('MetaLeft'), down('KeyC'), up('MetaLeft')])).toEqual([
      '+MetaLeft',
      '+KeyC',
      '-KeyC',
      '-MetaLeft',
    ])
  })

  it('still repeats a held Command chord, as each repeat is its own press', () => {
    expect(run('mac', [down('MetaLeft'), down('KeyZ'), down('KeyZ', true)])).toEqual([
      '+MetaLeft',
      '+KeyZ',
      '-KeyZ',
      '*KeyZ',
      '-KeyZ',
    ])
  })

  it('ignores the keyup that sometimes does arrive afterwards', () => {
    expect(run('mac', [down('MetaRight'), down('KeyV'), up('KeyV')])).toEqual([
      '+MetaRight',
      '+KeyV',
      '-KeyV',
    ])
  })

  it('leaves Command itself, and other modifiers under it, as ordinary holds', () => {
    expect(run('mac', [down('MetaLeft'), down('ShiftLeft'), up('ShiftLeft'), up('MetaLeft')])).toEqual([
      '+MetaLeft',
      '+ShiftLeft',
      '-ShiftLeft',
      '-MetaLeft',
    ])
  })

  it('does not apply on Windows, where keyups arrive normally', () => {
    expect(run('windows', [down('MetaLeft'), down('KeyE'), up('KeyE'), up('MetaLeft')])).toEqual([
      '+MetaLeft',
      '+KeyE',
      '-KeyE',
      '-MetaLeft',
    ])
  })
})

describe('Mac client: CapsLock reports lock state, not presses', () => {
  it('turns lock-on (keydown) and lock-off (keyup) each into one full press', () => {
    // On a Windows host every press toggles, so forwarding keydown-then-keyup
    // as one press would leave the two locks out of step after every use.
    expect(run('mac', [down('CapsLock'), up('CapsLock')])).toEqual([
      '+CapsLock',
      '-CapsLock',
      '+CapsLock',
      '-CapsLock',
    ])
  })

  it('forwards a Windows CapsLock as the real press and release it is', () => {
    expect(run('windows', [down('CapsLock'), up('CapsLock')])).toEqual(['+CapsLock', '-CapsLock'])
  })
})

describe('Windows client: AltGr arrives as a fake Control plus AltRight', () => {
  it('drops the phantom Control, so AltGr+Q is not Ctrl+Alt+Q', () => {
    expect(
      run('windows', [
        down('ControlLeft'),
        down('AltRight'),
        down('KeyQ'),
        up('KeyQ'),
        up('ControlLeft'),
        up('AltRight'),
      ]),
    ).toEqual(['+AltRight', '+KeyQ', '-KeyQ', '-AltRight'])
  })

  it("swallows the phantom's autorepeat while AltGr is held", () => {
    expect(
      run('windows', [
        down('ControlLeft'),
        down('AltRight'),
        down('ControlLeft', true),
        down('AltRight', true),
        up('ControlLeft'),
        up('AltRight'),
      ]),
    ).toEqual(['+AltRight', '-AltRight'])
  })

  it('holds back a real Control only until the next key', () => {
    const control = new KeyboardControl('windows')
    expect(control.handle(down('ControlLeft'))).toEqual([])
    expect(control.hasPending()).toBe(true)

    // Ctrl+C: the C flushes the Control ahead of itself, in order.
    expect(control.handle(down('KeyC')).map(show)).toEqual(['+ControlLeft', '+KeyC'])
    expect(control.hasPending()).toBe(false)
  })

  it('sends a lone Control when the hold-back window expires', () => {
    const control = new KeyboardControl('windows')
    control.handle(down('ControlLeft'))
    expect(control.flushPending().map(show)).toEqual(['+ControlLeft'])
    expect(control.flushPending()).toEqual([])
    expect(control.handle(up('ControlLeft')).map(show)).toEqual(['-ControlLeft'])
  })

  it('does not hold back Control on a Mac, which has no AltGr pair', () => {
    expect(run('mac', [down('ControlLeft')])).toEqual(['+ControlLeft'])
  })
})

describe('releasing everything', () => {
  it('lets go of every held key, modifiers last', () => {
    const control = new KeyboardControl('other')
    control.handle(down('ControlLeft'))
    control.handle(down('ShiftLeft'))
    control.handle(down('KeyZ'))

    expect(control.releaseAll().map(show)).toEqual(['-KeyZ', '-ControlLeft', '-ShiftLeft'])
    expect(control.getHeld()).toEqual([])
    // Idempotent: blur and unmount can both fire.
    expect(control.releaseAll()).toEqual([])
  })

  it('forgets a pending Control rather than sending it after the release', () => {
    const control = new KeyboardControl('windows')
    control.handle(down('ControlLeft'))
    expect(control.releaseAll()).toEqual([])
    expect(control.flushPending()).toEqual([])
  })

  it('drops the keyups that arrive after a release, which would be orphans', () => {
    const control = new KeyboardControl('other')
    control.handle(down('KeyA'))
    control.releaseAll()
    expect(control.handle(up('KeyA'))).toEqual([])
  })
})

describe('detectPlatform', () => {
  it('reads the platform the browser reports', () => {
    expect(detectPlatform({ platform: 'MacIntel' })).toBe('mac')
    expect(detectPlatform({ platform: 'Win32' })).toBe('windows')
    expect(detectPlatform({ platform: 'Linux x86_64' })).toBe('other')
    expect(detectPlatform({ platform: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(
      'windows',
    )
  })
})
