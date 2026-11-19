import { Plus } from 'lucide-react'
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useWheelScrollX } from '../hooks/use-wheel-scroll-x'
import { useT } from '../i18n/i18n-context'
import { slidePlace, slideShift } from '../utils/reorder'
import { type TabGroupRow, tabGroupFill } from '../utils/tab-group'
import { visibleUnsafe } from '../utils/unsafe-chars'
import { AgentStatusBadge } from './agent-status-badge'
import { NewTabForm } from './new-tab-form'
import { FOCUS_RING, IconButton } from './ui/button'

interface Props {
  rows: TabGroupRow[]
  // The group of the tab on screen; unset: the tabs in none
  active?: string
  onSelect: (row: TabGroupRow) => void
  // Unset (view-only role): no New tab group button. name: the tab's whole
  // name, its group first
  onAdd?: (name: string, icon?: string) => void
  // Unset (view-only role, or a backend that moves no tab): the row keeps
  // its order. The line at from to place to of the lines without it; what
  // it returns settles once the move is over, done or not
  onMove?: (from: number, to: number) => unknown
}

// How far (px) a pressed group moves before it drags
const DRAG_SLOP = 4

// The tab groups of the workspace on screen in a row of the header's whole
// width above its tab bar (the row layout, setting tabGroupsLayout), which
// then shows the picked one's tabs only. Each shows its colour, how many
// tabs it has and the heaviest agent status among them. Arrow keys move the
// focus; Enter or Space picks, since a pick switches the tab on screen. +
// asks for a new group and its first tab. A group moves along the row by a
// drag (a mouse or a pen) or Alt+Arrow, the others making room.
export function TabGroupRows({ rows, active, onSelect, onAdd, onMove }: Props) {
  const { t } = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  useWheelScrollX(scrollRef)
  const addRef = useRef<HTMLButtonElement>(null)
  const [formOpen, setFormOpen] = useState(false)
  const closeForm = (byPress = false) => {
    setFormOpen(false)
    if (!byPress) addRef.current!.focus()
  }

  const lines = () => [
    ...scrollRef.current!.querySelectorAll<HTMLElement>('[role="tab"]'),
  ]
  const movable = !!onMove && rows.length > 1
  const order = rows.map((r) => r.name ?? '').join('\n')
  const latest = useRef({ order, onMove })
  latest.current = { order, onMove }
  // A dropped group and the ones that made room stay where they were drawn
  // until the new order arrives, or the move ends without one (they slide
  // back)
  const held = useRef<HTMLElement[] | null>(null)
  const letGo = useRef((animate: boolean) => {
    const els = held.current
    if (!els) return
    held.current = null
    for (const el of els) {
      // Drawn in its new place in this frame: no slide from the old one
      if (!animate) el.style.transition = 'none'
      el.style.translate = ''
    }
    if (animate) return
    void scrollRef.current?.offsetWidth
    for (const el of els) el.style.transition = ''
  })
  // A group moved by its keys takes the focus back once it is drawn in its
  // place, when moving its node dropped it
  const refocus = useRef<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new order lets the groups go
  useLayoutEffect(() => {
    letGo.current(false)
    const name = refocus.current
    refocus.current = null
    if (name === null || document.activeElement !== document.body) return
    lines()
      .find((el) => el.dataset.tabGroupRow === name)
      ?.focus()
  }, [order])
  // Ends a drag in progress (its window listeners), also on unmount
  const endDrag = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      endDrag.current?.()
      letGo.current(false)
    },
    [],
  )
  const move = (from: number, to: number) => {
    const done = () => letGo.current(true)
    void Promise.resolve(latest.current.onMove!(from, to)).then(done, done)
  }
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (
      !movable ||
      e.button !== 0 ||
      e.pointerType === 'touch' ||
      endDrag.current ||
      held.current
    )
      return
    startDrag(e.currentTarget, e.clientX)
  }
  const startDrag = (el: HTMLElement, startX: number) => {
    const list = scrollRef.current!
    const started = order
    // Set when the drag starts: the groups in the row's order, their boxes
    // without any slide, and the room the dragged one takes
    let els: HTMLElement[] = []
    let boxes: DOMRect[] = []
    let from = -1
    let to = -1
    let room = 0
    const begin = () => {
      els = lines()
      boxes = els.map((l) => l.getBoundingClientRect())
      from = els.indexOf(el)
      to = from
      room =
        boxes[from].width +
        (Number.parseFloat(getComputedStyle(list).columnGap) || 0)
      el.setAttribute('data-dragging', 'true')
    }
    const onMoveEvent = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - startX
      if (from === -1) {
        if (Math.abs(dx) < DRAG_SLOP) return
        begin()
      }
      const box = list.getBoundingClientRect()
      const self = boxes[from]
      const x = Math.min(
        Math.max(dx, box.left - self.left),
        box.right - self.right,
      )
      el.style.translate = `${x}px 0`
      to = slidePlace(boxes, from, x)
      els.forEach((other, i) => {
        if (i === from) return
        const shift = slideShift(i, from, to, room)
        other.style.translate = shift ? `${shift}px 0` : ''
      })
    }
    const finish = (drop: boolean) => {
      window.removeEventListener('pointermove', onMoveEvent)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      endDrag.current = null
      if (from === -1) return
      el.removeAttribute('data-dragging')
      // The click that ends a drag does not pick the group
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, true))
      // The row changed under the drag: its places no longer hold
      if (!drop || to === from || latest.current.order !== started) {
        for (const other of els) other.style.translate = ''
        return
      }
      // Into its slot, the others still aside, until the new order
      const slot =
        to > from
          ? boxes[to].right - boxes[from].right
          : boxes[to].left - boxes[from].left
      el.style.translate = `${slot}px 0`
      held.current = els
      move(from, to)
    }
    const swallow = (c: MouseEvent) => {
      c.stopPropagation()
      c.preventDefault()
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    // Escape puts the group back
    const onKey = (k: globalThis.KeyboardEvent) => {
      if (k.key !== 'Escape' || from === -1) return
      k.preventDefault()
      k.stopPropagation()
      finish(false)
    }
    window.addEventListener('pointermove', onMoveEvent)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    endDrag.current = () => finish(false)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const tabs = lines()
    const at = tabs.indexOf(document.activeElement as HTMLElement)
    const last = tabs.length - 1
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      const to = at + (e.key === 'ArrowLeft' ? -1 : 1)
      if (!movable || held.current || to < 0 || to > last) return
      refocus.current = tabs[at].dataset.tabGroupRow!
      move(at, to)
      return
    }
    const next = {
      ArrowRight: at === last ? 0 : at + 1,
      ArrowLeft: at === 0 ? last : at - 1,
      Home: 0,
      End: last,
    }[e.key]
    if (next === undefined) return
    e.preventDefault()
    tabs[next].focus()
  }

  return (
    <div className="relative flex w-full min-w-0 shrink-0 items-center gap-1 pt-1">
      <div
        ref={scrollRef}
        role="tablist"
        aria-label={t('shell.tabGroups.row')}
        onKeyDown={onKeyDown}
        className="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-hide"
      >
        {rows.map((row) => {
          const selected = row.name === active
          const name =
            row.name === undefined
              ? t('shell.tabGroups.none')
              : visibleUnsafe(row.name)
          // A group is drawn in its colour once picked, as in the tab bar
          const fill =
            row.name === undefined
              ? 'bg-term text-fg shadow-sm'
              : `${tabGroupFill(row.name)} text-white`
          return (
            <button
              key={row.name ?? ''}
              type="button"
              role="tab"
              data-tab-group-row={row.name ?? ''}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(row)}
              onPointerDown={onPointerDown}
              data-movable={movable || undefined}
              aria-keyshortcuts={
                movable ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined
              }
              title={`${name} · ${t('shell.chip.sessions', { count: row.sessions.length })}`}
              className={`flex h-6 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12px] font-medium transition-[color,background-color,translate] duration-(--duration-fast) ease-standard data-dragging:z-20 data-dragging:transition-none pointer-coarse:h-8 ${FOCUS_RING} ${
                selected
                  ? fill
                  : 'text-fg-muted hover:bg-surface-raised hover:text-fg'
              }`}
            >
              {row.name !== undefined && !selected && (
                <span
                  aria-hidden="true"
                  className={`size-2 shrink-0 rounded-full ${tabGroupFill(row.name)}`}
                />
              )}
              <span className="max-w-[160px] truncate ui-terminal:font-label">
                {name}
              </span>
              <span className="text-[11px] opacity-70">
                {row.sessions.length}
              </span>
              <AgentStatusBadge status={row.agentStatus} size={11} />
            </button>
          )
        })}
      </div>
      {onAdd && (
        <IconButton
          ref={addRef}
          size="sm"
          // Not a press outside the form: + itself closes it
          data-new-tab-group-toggle
          onClick={() => (formOpen ? closeForm() : setFormOpen(true))}
          aria-expanded={formOpen}
          className="size-6 pointer-coarse:size-8"
          aria-label={t('shell.tabGroups.add')}
          title={t('shell.tabGroups.add')}
        >
          <Plus size={14} aria-hidden="true" />
        </IconButton>
      )}
      {formOpen && (
        <NewTabForm
          onAdd={onAdd!}
          onClose={closeForm}
          toggleSelector="[data-new-tab-group-toggle]"
          groups={rows.flatMap((r) => r.name ?? [])}
          focusGroup
          align="start"
        />
      )}
    </div>
  )
}
