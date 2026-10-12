import { describe, expect, it } from 'vitest'
import { MAX_TEXT_LENGTH } from '../src/protocol/input'
import { PAD, TextComposer, composerKeepsKey, textIntents } from '../src/viewer/textComposer'
import type { ComposerIntent } from '../src/viewer/textComposer'

/* The soft keyboard types into a hidden textarea; what the desktop gets is
 * the diff. These are the edits a phone keyboard actually makes — a letter,
 * a correction, a prediction, a composition — and what each must become. */

const SP = ' '.repeat(PAD)
const key = (code: 'Backspace' | 'Delete' | 'Enter' | 'Tab'): ComposerIntent => ({ kind: 'key', code })
const text = (t: string): ComposerIntent => ({ kind: 'text', text: t })

/** A textarea holding `before` + caret + `after`, inside the padding. */
function typed(before: string, after = ''): { value: string; caret: number } {
  return { value: SP + before + after + SP, caret: PAD + before.length }
}

/** Feed one textarea state and return the intents. */
function input(composer: TextComposer, state: { value: string; caret: number }) {
  return composer.handleInput(state.value, state.caret)
}

describe('TextComposer', () => {
  it('starts as padding with the caret in the middle', () => {
    const composer = new TextComposer()
    expect(composer.reset()).toEqual({ value: SP + SP, caret: PAD })
  })

  it('a typed letter is text, and the content is kept for the keyboard', () => {
    const composer = new TextComposer()
    const result = input(composer, typed('a'))
    expect(result.intents).toEqual([text('a')])
    // Nothing to re-pad: the textarea is left alone so autocorrect can see it.
    expect(result.write).toBeNull()
    expect(input(composer, typed('ab')).intents).toEqual([text('b')])
  })

  it('a Backspace on nothing eats padding and is still sent', () => {
    const composer = new TextComposer()
    const result = composer.handleInput(' '.repeat(PAD * 2 - 1), PAD - 1)
    expect(result.intents).toEqual([key('Backspace')])
    // Then the padding is restored, or the next Backspace would find less.
    expect(result.write).toEqual({ value: SP + SP, caret: PAD })
  })

  it('tells Backspace from Delete by where the caret ends up', () => {
    const composer = new TextComposer()
    const deleted = composer.handleInput(' '.repeat(PAD * 2 - 1), PAD)
    expect(deleted.intents).toEqual([key('Delete')])
  })

  it('removes a letter of its own text with a Backspace', () => {
    const composer = new TextComposer()
    input(composer, typed('ab'))
    expect(input(composer, typed('a')).intents).toEqual([key('Backspace')])
  })

  it('an autocorrection is Backspaces then the fix', () => {
    const composer = new TextComposer()
    input(composer, typed('teh'))
    // The keyboard rewrites the word in place on the space that follows.
    expect(input(composer, typed('the ')).intents).toEqual([
      key('Backspace'),
      key('Backspace'),
      text('he '),
    ])
  })

  it('a prediction completes the word', () => {
    const composer = new TextComposer()
    input(composer, typed('hel'))
    expect(input(composer, typed('hello ')).intents).toEqual([text('lo ')])
  })

  it('a line break is Enter, and the context is reset after it', () => {
    const composer = new TextComposer()
    input(composer, typed('hi'))
    const result = input(composer, typed('hi\n'))
    expect(result.intents).toEqual([key('Enter')])
    expect(result.write).toEqual({ value: SP + SP, caret: PAD })
  })

  it('an emoji is one piece of text', () => {
    const composer = new TextComposer()
    expect(input(composer, typed('😀')).intents).toEqual([text('😀')])
    expect(input(composer, typed('')).intents).toEqual([key('Backspace'), key('Backspace')])
  })

  it('a composition is typed live and replaced on commit', () => {
    const composer = new TextComposer()
    composer.setComposing(true)
    expect(input(composer, typed('n')).intents).toEqual([text('n')])
    expect(input(composer, typed('ni')).intents).toEqual([text('i')])
    const commit = input(composer, typed('你'))
    expect(commit.intents).toEqual([key('Backspace'), key('Backspace'), text('你')])
    // Never rewritten under the IME.
    expect(commit.write).toBeNull()
    composer.setComposing(false)
    expect(input(composer, typed('你')).intents).toEqual([])
  })

  it('a caret past the padding on both sides is re-padded without sending', () => {
    const composer = new TextComposer()
    // A Delete eats trailing padding, which is put straight back…
    const padded = composer.handleInput(' '.repeat(PAD * 2 - 1), PAD)
    expect(padded.intents).toEqual([key('Delete')])
    expect(padded.write).toEqual({ value: SP + SP, caret: PAD })
    // …and typed text keeps its padding when a Delete touches it.
    input(composer, typed('ab'))
    const result = composer.handleInput(SP + 'ab' + ' '.repeat(PAD - 1), PAD + 2)
    expect(result.intents).toEqual([key('Delete')])
    expect(result.write).toEqual({ value: SP + 'ab' + SP, caret: PAD + 2 })
  })

  it('resets once the content has grown long', () => {
    const composer = new TextComposer()
    const long = 'x'.repeat(1100)
    const result = input(composer, typed(long))
    expect(result.intents).toHaveLength(2)
    expect(result.write).toEqual({ value: SP + SP, caret: PAD })
  })

  it('a reset forgets the content, so the next edit is diffed against padding', () => {
    const composer = new TextComposer()
    input(composer, typed('abc'))
    composer.reset()
    expect(input(composer, typed('d')).intents).toEqual([text('d')])
  })
})

describe('textIntents', () => {
  it('turns line breaks and tabs into keys, in order with the text', () => {
    expect(textIntents('a\r\nb\tc')).toEqual([text('a'), key('Enter'), text('b'), key('Tab'), text('c')])
  })

  it('drops other control characters', () => {
    expect(textIntents('a\u0007b\u007f')).toEqual([text('ab')])
  })

  it('splits a long run at the wire limit, never inside an emoji', () => {
    const run = 'a'.repeat(MAX_TEXT_LENGTH - 1) + '😀'
    const out = textIntents(run)
    expect(out).toEqual([text('a'.repeat(MAX_TEXT_LENGTH - 1)), text('😀')])
  })
})

describe('composerKeepsKey', () => {
  const event = (overrides: Partial<Parameters<typeof composerKeepsKey>[0]>) => ({
    key: 'a',
    code: 'KeyA',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    ...overrides,
  })

  it('leaves characters and edits to the textarea', () => {
    expect(composerKeepsKey(event({}))).toBe(true)
    expect(composerKeepsKey(event({ key: 'A', code: 'KeyA' }))).toBe(true)
    expect(composerKeepsKey(event({ key: 'Backspace', code: 'Backspace' }))).toBe(true)
    expect(composerKeepsKey(event({ key: 'Enter', code: 'Enter' }))).toBe(true)
    expect(composerKeepsKey(event({ key: 'Delete', code: 'Delete' }))).toBe(true)
    expect(composerKeepsKey(event({ key: 'Dead', code: 'Quote' }))).toBe(true)
  })

  it('leaves the soft keyboard\'s position-less events alone', () => {
    expect(composerKeepsKey(event({ key: 'Unidentified', code: '' }))).toBe(true)
    expect(composerKeepsKey(event({ key: 'Backspace', code: '' }))).toBe(true)
    expect(composerKeepsKey(event({ key: 'Process', code: 'KeyN', isComposing: true }))).toBe(true)
  })

  it('forwards navigation, Tab, Escape and chords as physical keys', () => {
    expect(composerKeepsKey(event({ key: 'Tab', code: 'Tab' }))).toBe(false)
    expect(composerKeepsKey(event({ key: 'ArrowLeft', code: 'ArrowLeft' }))).toBe(false)
    expect(composerKeepsKey(event({ key: 'Escape', code: 'Escape' }))).toBe(false)
    expect(composerKeepsKey(event({ key: 'F5', code: 'F5' }))).toBe(false)
    expect(composerKeepsKey(event({ key: 'c', code: 'KeyC', ctrlKey: true }))).toBe(false)
    expect(composerKeepsKey(event({ key: 'c', code: 'KeyC', metaKey: true }))).toBe(false)
  })
})
