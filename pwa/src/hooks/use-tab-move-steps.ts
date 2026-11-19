import { type RefObject, useEffect, useRef } from 'react'
import type { Session } from '../types/session'

// How long a step waits for the tabs to show its move before giving up
const STEP_WAIT_MS = 5000

const lastingKey = (s: Session) => s.key ?? s.id

// Several tabs moved one after the other (utils/tab-group.ts moveSteps):
// each is found again by its lasting key, since a tmux move renumbers the
// windows, and the next waits until the tabs drawn show the last one in its
// place; a refused move ends them. busy is set meanwhile, so nothing else
// starts a move.
export function useTabMoveSteps(
  sessions: readonly Session[],
  onMove: ((id: string, index: number) => unknown) | undefined,
  busy: RefObject<boolean>,
) {
  const drawn = useRef(sessions)
  drawn.current = sessions
  const move = useRef(onMove)
  move.current = onMove
  const redrawn = useRef<(() => void)[]>([])
  // biome-ignore lint/correctness/useExhaustiveDependencies: new tabs wake the waiters
  useEffect(() => {
    for (const wake of redrawn.current.splice(0)) wake()
  }, [sessions])
  return async (steps: { key: string; index: number }[]) => {
    busy.current = true
    try {
      for (const { key, index } of steps) {
        const tab = drawn.current.find((s) => lastingKey(s) === key)
        if (!tab) return
        await move.current!(tab.id, index)
        // Until the tabs drawn show it there (a refused move: never)
        const there = () =>
          drawn.current.findIndex((s) => lastingKey(s) === key) === index
        const until = Date.now() + STEP_WAIT_MS
        while (!there() && Date.now() < until)
          await new Promise<void>((wake) => {
            redrawn.current.push(wake)
            setTimeout(wake, 100)
          })
        if (!there()) return
      }
    } finally {
      busy.current = false
    }
  }
}
