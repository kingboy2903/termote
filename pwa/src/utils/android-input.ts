import type { Terminal } from '@xterm/xterm'

// Android soft keyboards (Gboard, Samsung, SwiftKey) send almost every key as
// an IME edit of xterm's hidden textarea (keydown keyCode 229), not as keys.
// xterm.js 6 then guesses the input from the textarea and gets it wrong:
// one DEL however many characters went, the whole textarea again when an
// autocorrect keeps its length, nothing while a word is being composed (it
// shows up only when the word ends), and once the textarea is empty a
// Backspace has nothing to delete, so it sends nothing at all.
//
// On Android this takes the textarea over: every edit is the difference
// between its text before (read at beforeinput, as xterm also clears it) and
// after, sent at once as that many DELs plus the new text, through
// term.input so it takes onData's path (view-only, Herdr reply filtering).
// Between words the textarea holds only SENTINEL, so a Backspace always has
// something to delete. Real keys (Enter, a hardware keyboard, toolbar keys)
// are still xterm's.

// One character for Backspace to delete; a space reads as the start of a word
// to the keyboard, so it neither capitalizes nor joins a word to it.
export const SENTINEL = ' '

const DEL = '\x7f'

// What to send for the textarea going from `before` to `after`: a DEL for each
// character after their common start, then the rest of `after`. The terminal's
// cursor is at the end of what was typed, so an edit in the middle is retyped
// from there. Characters are code points, so an emoji is one DEL.
export function textareaEdit(before: string, after: string): string {
  const a = Array.from(before)
  const b = Array.from(after)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return DEL.repeat(a.length - i) + b.slice(i).join('')
}

// Takes over the textarea of an opened terminal; returns the undo.
export function attachAndroidInput(term: Terminal): () => void {
  const ta = term.textarea
  const host = term.element
  if (!ta || !host) return () => {}

  let composing = false
  let last = ''
  const reset = () => {
    if (composing) return
    ta.value = SENTINEL
    ta.setSelectionRange(SENTINEL.length, SENTINEL.length)
    last = SENTINEL
  }
  const flush = () => {
    const now = ta.value
    const data = textareaEdit(last, now)
    last = now
    if (data) term.input(data, true)
  }

  // Capture on an ancestor runs before xterm's own listeners on the
  // textarea; stopping the event there keeps xterm from sending it too.
  const own = (e: Event) => {
    if (e.target !== ta) return false
    e.stopPropagation()
    return true
  }
  const listeners: [string, (e: Event) => void][] = [
    [
      'keydown',
      (e) => {
        const k = e as KeyboardEvent
        // A key the keyboard edits the textarea for: the edit is ours. Any
        // other key goes on to xterm (not prevented: that would stop the edit).
        if (k.keyCode === 229 || k.isComposing) own(e)
      },
    ],
    [
      'keyup',
      (e) => {
        // xterm clears the textarea after Enter and Ctrl+C
        if (e.target === ta && ta.value === '') reset()
      },
    ],
    [
      'beforeinput',
      (e) => {
        if (e.target === ta) last = ta.value
      },
    ],
    [
      'input',
      (e) => {
        if (!own(e)) return
        flush()
        // Deleted past the start of the textarea: a word being composed is
        // gone with it, and the keyboard may never end its composition, so
        // put SENTINEL back now or the next Backspace has nothing to delete.
        if (ta.value === '') composing = false
        reset()
      },
    ],
    [
      'compositionstart',
      (e) => {
        if (own(e)) composing = true
      },
    ],
    ['compositionupdate', own],
    [
      'compositionend',
      (e) => {
        if (!own(e)) return
        composing = false
        flush()
        reset()
      },
    ],
    [
      'focus',
      (e) => {
        // xterm empties the textarea on blur
        if (e.target === ta) reset()
      },
    ],
  ]
  for (const [type, fn] of listeners) host.addEventListener(type, fn, true)
  reset()
  return () => {
    for (const [type, fn] of listeners) host.removeEventListener(type, fn, true)
  }
}
