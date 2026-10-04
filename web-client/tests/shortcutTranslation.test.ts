import { parseHostInfo } from '../src/protocol/input'
import type { KeyIntent } from '../src/protocol/input'
import {
  browserShortcutModifiers,
  escapedToBrowser,
  reservedShortcutLabels,
  shouldSwapModifiers,
  translateIntent,
} from '../src/viewer/shortcutTranslation'

const down = (code: string): KeyIntent => ({ kind: 'down', code, repeat: false })

describe('shouldSwapModifiers', () => {
  it('auto swaps exactly when one side is a Mac', () => {
    expect(shouldSwapModifiers('auto', 'mac', 'windows')).toBe(true)
    expect(shouldSwapModifiers('auto', 'mac', 'linux')).toBe(true)
    expect(shouldSwapModifiers('auto', 'windows', 'mac')).toBe(true)
    expect(shouldSwapModifiers('auto', 'other', 'mac')).toBe(true)
  })

  it('auto leaves a matching pair alone', () => {
    expect(shouldSwapModifiers('auto', 'mac', 'mac')).toBe(false)
    expect(shouldSwapModifiers('auto', 'windows', 'windows')).toBe(false)
    expect(shouldSwapModifiers('auto', 'other', 'linux')).toBe(false)
  })

  it('auto swaps nothing until the host has said what it is', () => {
    // An older host never sends hostInfo. Keys then go by position, which is
    // exactly what they did before the message existed.
    expect(shouldSwapModifiers('auto', 'mac', null)).toBe(false)
    expect(shouldSwapModifiers('auto', 'windows', null)).toBe(false)
  })

  it('the explicit modes ignore the platforms', () => {
    expect(shouldSwapModifiers('swap', 'mac', 'mac')).toBe(true)
    expect(shouldSwapModifiers('swap', 'windows', null)).toBe(true)
    expect(shouldSwapModifiers('off', 'mac', 'windows')).toBe(false)
  })
})

describe('translateIntent', () => {
  it('trades Meta and Control both ways, keeping the side', () => {
    expect(translateIntent(down('MetaLeft'), true).code).toBe('ControlLeft')
    expect(translateIntent(down('ControlLeft'), true).code).toBe('MetaLeft')
    expect(translateIntent(down('MetaRight'), true).code).toBe('ControlRight')
    expect(translateIntent(down('ControlRight'), true).code).toBe('MetaRight')
  })

  it('so Cmd+C from a Mac reaches a Windows host as Ctrl+C', () => {
    const chord = [down('MetaLeft'), down('KeyC'), { kind: 'up', code: 'KeyC', repeat: false } as KeyIntent]
    expect(chord.map((i) => translateIntent(i, true).code)).toEqual(['ControlLeft', 'KeyC', 'KeyC'])
  })

  it('leaves every other key, and the rest of the intent, alone', () => {
    const repeat: KeyIntent = { kind: 'down', code: 'KeyA', repeat: true }
    expect(translateIntent(repeat, true)).toBe(repeat)
    expect(translateIntent(down('AltLeft'), true).code).toBe('AltLeft')
    expect(translateIntent(down('ShiftLeft'), true).code).toBe('ShiftLeft')
    const up: KeyIntent = { kind: 'up', code: 'MetaLeft', repeat: false }
    expect(translateIntent(up, true)).toEqual({ kind: 'up', code: 'ControlLeft', repeat: false })
  })

  it('is the identity when not swapping', () => {
    const meta = down('MetaLeft')
    expect(translateIntent(meta, false)).toBe(meta)
  })

  it('is its own inverse, so a release always matches its press', () => {
    for (const code of ['MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'KeyQ']) {
      expect(translateIntent(translateIntent(down(code), true), true).code).toBe(code)
    }
  })
})

describe('what the browser keeps', () => {
  it('names the modifier the browser builds its shortcuts on', () => {
    expect(browserShortcutModifiers('mac')).toEqual(['MetaLeft', 'MetaRight'])
    expect(browserShortcutModifiers('windows')).toEqual(['ControlLeft', 'ControlRight'])
    expect(browserShortcutModifiers('other')).toEqual(['ControlLeft', 'ControlRight'])
  })

  it('lists the chords in the words the user reads them in', () => {
    expect(reservedShortcutLabels('mac')).toContain('⌘W')
    expect(reservedShortcutLabels('windows')).toContain('Ctrl+W')
    expect(reservedShortcutLabels('windows')).toContain('Alt+Tab')
  })

  it('a blur with a modifier held is a chord that went to the browser', () => {
    expect(escapedToBrowser(['ControlLeft'])).toBe(true)
    expect(escapedToBrowser(['AltLeft', 'Tab'])).toBe(true)
    expect(escapedToBrowser(['KeyA'])).toBe(false)
    expect(escapedToBrowser([])).toBe(false)
  })
})

describe('parseHostInfo', () => {
  it('reads the three platforms the schema allows', () => {
    expect(parseHostInfo('{"type":"hostInfo","platform":"windows"}')).toBe('windows')
    expect(parseHostInfo('{"platform":"mac","type":"hostInfo"}')).toBe('mac')
    expect(parseHostInfo('{"type":"hostInfo","platform":"linux"}')).toBe('linux')
  })

  it('rejects everything else rather than guessing', () => {
    expect(parseHostInfo('{"type":"hostInfo","platform":"amiga"}')).toBeNull()
    expect(parseHostInfo('{"type":"keyDown","code":"KeyA"}')).toBeNull()
    expect(parseHostInfo('{"type":"hostInfo"}')).toBeNull()
    expect(parseHostInfo('not json')).toBeNull()
    expect(parseHostInfo('[]')).toBeNull()
    expect(parseHostInfo(new ArrayBuffer(4))).toBeNull()
  })
})
