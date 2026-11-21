import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachAndroidInput, SENTINEL, textareaEdit } from './android-input'
import { isAndroid } from './platform'

const DEL = '\x7f'

describe('textareaEdit', () => {
  it('sends what was added', () => {
    expect(textareaEdit(' ', ' h')).toBe('h')
    expect(textareaEdit(' he', ' hello')).toBe('llo')
  })
  it('sends a DEL for each character removed', () => {
    expect(textareaEdit(' ', '')).toBe(DEL)
    expect(textareaEdit(' hello', ' he')).toBe(DEL.repeat(3))
  })
  it('replaces an autocorrected word of the same length', () => {
    expect(textareaEdit(' teh', ' the')).toBe(`${DEL.repeat(2)}he`)
  })
  it('counts an emoji as one character', () => {
    expect(textareaEdit(' a😀', ' a')).toBe(DEL)
    expect(textareaEdit(' a', ' a😀')).toBe('😀')
  })
  it('sends nothing for no change', () => {
    expect(textareaEdit(' ab', ' ab')).toBe('')
  })
})

// The textarea of an xterm, and the element its listeners sit under.
function fakeTerm() {
  const element = document.createElement('div')
  const textarea = document.createElement('textarea')
  element.append(textarea)
  document.body.append(element)
  const sent: string[] = []
  // xterm's own listeners, which must not see the keyboard's edits
  const xterm = vi.fn()
  for (const type of ['keydown', 'input', 'compositionstart', 'compositionend'])
    textarea.addEventListener(type, xterm, true)
  const term = {
    element,
    textarea,
    input: (data: string) => sent.push(data),
  } as unknown as Terminal
  return { term, textarea, sent, xterm }
}

// What a keyboard does: beforeinput, the edit, then input.
function edit(ta: HTMLTextAreaElement, value: string) {
  ta.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
  ta.value = value
  ta.dispatchEvent(new InputEvent('input', { bubbles: true }))
}
const ime229 = (ta: HTMLTextAreaElement) =>
  ta.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, keyCode: 229 }),
  )
const composition = (ta: HTMLTextAreaElement, type: string) =>
  ta.dispatchEvent(new CompositionEvent(type, { bubbles: true }))

describe('attachAndroidInput', () => {
  let t: ReturnType<typeof fakeTerm>
  let detach: () => void
  beforeEach(() => {
    t = fakeTerm()
    detach = attachAndroidInput(t.term)
  })
  afterEach(() => {
    detach()
    t.term.element?.remove()
  })

  it('leaves one character in the textarea to delete', () => {
    expect(t.textarea.value).toBe(SENTINEL)
  })

  it('sends a composed word as it is typed, not at its end', () => {
    composition(t.textarea, 'compositionstart')
    ime229(t.textarea)
    edit(t.textarea, ' h')
    ime229(t.textarea)
    edit(t.textarea, ' hi')
    expect(t.sent.join('')).toBe('hi')
    composition(t.textarea, 'compositionend')
    expect(t.sent.join('')).toBe('hi')
    expect(t.textarea.value).toBe(SENTINEL)
    expect(t.xterm).not.toHaveBeenCalled()
  })

  it('deletes inside a word being composed', () => {
    composition(t.textarea, 'compositionstart')
    edit(t.textarea, ' hello')
    edit(t.textarea, ' hel')
    expect(t.sent).toEqual(['hello', DEL.repeat(2)])
  })

  it('keeps deleting after the textarea had nothing left', () => {
    for (let i = 0; i < 10; i++) {
      ime229(t.textarea)
      edit(t.textarea, '')
    }
    expect(t.sent).toEqual(Array(10).fill(DEL))
    expect(t.textarea.value).toBe(SENTINEL)
  })

  it('keeps deleting past a composed word into text typed before', () => {
    // Text already on the shell's line (typed before a reload): only the
    // SENTINEL stands for it here, and the composition never ends.
    composition(t.textarea, 'compositionstart')
    edit(t.textarea, ' ab')
    edit(t.textarea, ' a')
    edit(t.textarea, ' ')
    edit(t.textarea, '')
    expect(t.textarea.value).toBe(SENTINEL)
    for (let i = 0; i < 5; i++) edit(t.textarea, '')
    expect(t.sent.join('')).toBe(`ab${DEL.repeat(8)}`)
    expect(t.textarea.value).toBe(SENTINEL)
  })

  it('turns an autocorrect into DELs and the new word', () => {
    composition(t.textarea, 'compositionstart')
    edit(t.textarea, ' teh')
    edit(t.textarea, ' the ')
    composition(t.textarea, 'compositionend')
    expect(t.sent.join('')).toBe(`teh${DEL.repeat(2)}he `)
  })

  it('reads the textarea before each edit, as xterm also clears it', () => {
    t.textarea.value = ''
    edit(t.textarea, 'x')
    expect(t.sent).toEqual(['x'])
  })

  it('puts the character back after xterm clears the textarea', () => {
    t.textarea.value = ''
    t.textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
    expect(t.textarea.value).toBe(SENTINEL)
    t.textarea.value = ''
    t.textarea.dispatchEvent(new FocusEvent('focus'))
    expect(t.textarea.value).toBe(SENTINEL)
  })

  it('leaves real keys to xterm', () => {
    t.textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Enter',
        keyCode: 13,
      }),
    )
    expect(t.xterm).toHaveBeenCalledTimes(1)
    expect(t.sent).toEqual([])
  })

  it('stops after detach', () => {
    detach()
    edit(t.textarea, ' a')
    expect(t.sent).toEqual([])
    expect(t.xterm).toHaveBeenCalled()
  })
})

describe('isAndroid', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('reads the user agent', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130',
      platform: 'Linux armv81',
    })
    expect(isAndroid()).toBe(true)
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      platform: 'iPhone',
    })
    expect(isAndroid()).toBe(false)
  })
})
