import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../types/session'
import { tabGroupRows } from '../utils/tab-group'
import { TabGroupRows } from './tab-group-row'

const tab = (id: string, name: string, extra: Partial<Session> = {}) =>
  ({ id, name, icon: '', description: '', ...extra }) as Session

const ROWS = tabGroupRows([
  tab('1', 'review/PR 1', { agentStatus: 'blocked' }),
  tab('2', 'review/PR 2'),
  tab('3', 'Shell'),
  tab('4', 'coding/api'),
])

const renderRow = (active?: string, onAdd?: () => void) => {
  const onSelect = vi.fn()
  render(
    <TabGroupRows
      rows={ROWS}
      active={active}
      onSelect={onSelect}
      onAdd={onAdd}
    />,
  )
  return onSelect
}
const row = (name: RegExp) => screen.getByRole('tab', { name })

describe('TabGroupRows', () => {
  it('lists the groups, the tabs in none as No group, the picked one selected', () => {
    renderRow('review')
    expect(screen.getByRole('tablist', { name: 'Tab groups' })).toBeVisible()
    expect(
      screen
        .getAllByRole('tab')
        .map((t) => t.getAttribute('data-tab-group-row')),
    ).toEqual(['review', '', 'coding'])
    expect(row(/review/)).toHaveAttribute('aria-selected', 'true')
    expect(row(/coding/)).toHaveAttribute('aria-selected', 'false')
    expect(row(/No group/)).toHaveAttribute('aria-selected', 'false')
  })

  it('draws the picked group in its colour, the others with a dot of theirs', () => {
    renderRow('review')
    expect(row(/review/).className).toMatch(/bg-avatar-\d/)
    expect(row(/review/).querySelector('.rounded-full')).toBeNull()
    expect(row(/coding/).className).not.toMatch(/bg-avatar/)
    expect(row(/coding/).querySelector('.rounded-full')!.className).toMatch(
      /bg-avatar-\d/,
    )
    // The tabs in none have no colour
    expect(row(/No group/).querySelector('.rounded-full')).toBeNull()
  })

  it('selects No group while the tab on screen is in none', () => {
    renderRow()
    expect(row(/No group/)).toHaveAttribute('aria-selected', 'true')
    expect(row(/No group/).className).not.toMatch(/bg-avatar/)
  })

  it('shows how many tabs each has and the heaviest status', () => {
    renderRow('review')
    expect(row(/review/)).toHaveTextContent('review2')
    expect(row(/review/)).toHaveAttribute('title', 'review · 2 sessions')
    expect(
      row(/review/).querySelector('[data-status="blocked"]'),
    ).not.toBeNull()
    expect(row(/coding/)).toHaveAttribute('title', 'coding · 1 session')
  })

  it('picks a group on a click', () => {
    const onSelect = renderRow('review')
    fireEvent.click(row(/coding/))
    expect(onSelect).toHaveBeenCalledWith(ROWS[2])
  })

  it('moves the focus with the arrow keys, Home and End, around the ends', () => {
    renderRow('review')
    const [review, none, coding] = screen.getAllByRole('tab')
    review.focus()
    fireEvent.keyDown(review, { key: 'ArrowRight' })
    expect(none).toHaveFocus()
    fireEvent.keyDown(none, { key: 'End' })
    expect(coding).toHaveFocus()
    fireEvent.keyDown(coding, { key: 'ArrowRight' })
    expect(review).toHaveFocus()
    fireEvent.keyDown(review, { key: 'ArrowLeft' })
    expect(coding).toHaveFocus()
    fireEvent.keyDown(coding, { key: 'ArrowLeft' })
    expect(none).toHaveFocus()
    fireEvent.keyDown(none, { key: 'Home' })
    expect(review).toHaveFocus()
    // Any other key is left alone
    fireEvent.keyDown(review, { key: 'a' })
    expect(review).toHaveFocus()
  })

  it('has no New tab group button without onAdd', () => {
    renderRow('review')
    expect(screen.queryByRole('button', { name: 'New tab group' })).toBeNull()
  })

  it('asks for a new group and its first tab, offering those there are', () => {
    const onAdd = vi.fn()
    renderRow('review', onAdd)
    const add = screen.getByRole('button', { name: 'New tab group' })
    expect(add).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(add)
    expect(add).toHaveAttribute('aria-expanded', 'true')
    const form = screen.getByRole('form', { name: 'New session' })
    // Under the row's start, where there is always room
    expect(form).toHaveClass('left-0')
    const group = within(form).getByRole('combobox', {
      name: 'Tab group (optional)',
    })
    expect(group).toHaveFocus()
    expect(group).toHaveValue('')
    expect(
      [...form.querySelectorAll('datalist option')].map((o) =>
        o.getAttribute('value'),
      ),
    ).toEqual(['review', 'coding'])
    fireEvent.change(group, { target: { value: ' specs ' } })
    fireEvent.change(
      within(form).getByRole('textbox', { name: 'Session name' }),
      { target: { value: 'auth' } },
    )
    fireEvent.submit(form)
    expect(onAdd).toHaveBeenCalledWith('specs/auth', undefined)
    // Closed by the form itself: the focus is back on +
    expect(screen.queryByRole('form')).toBeNull()
    expect(add).toHaveFocus()
  })

  it('closes the form on + again, and on a press outside without the focus', () => {
    renderRow('review', vi.fn())
    const add = screen.getByRole('button', { name: 'New tab group' })
    fireEvent.click(add)
    // A press on + is not one outside
    fireEvent.pointerDown(add)
    expect(screen.getByRole('form')).toBeInTheDocument()
    fireEvent.click(add)
    expect(screen.queryByRole('form')).toBeNull()
    expect(add).toHaveFocus()
    fireEvent.click(add)
    add.blur()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('form')).toBeNull()
    expect(add).not.toHaveFocus()
  })

  describe('moving a group along the row', () => {
    const renderMovable = (onMove: (from: number, to: number) => unknown) =>
      render(
        <TabGroupRows
          rows={ROWS}
          active="review"
          onSelect={onSelect}
          onMove={onMove}
        />,
      )
    const onSelect = vi.fn()
    const slide = (name: RegExp) => row(name).style.translate
    // jsdom lays nothing out: the row spans 0-300 and each group 100 px
    const layOut = () => {
      const rect = (left: number, width: number) =>
        ({ left, right: left + width, width, top: 0, bottom: 24 }) as DOMRect
      vi.spyOn(
        screen.getByRole('tablist'),
        'getBoundingClientRect',
      ).mockReturnValue(rect(0, 300))
      screen.getAllByRole('tab').forEach((el, i) => {
        vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
          rect(i * 100, 100),
        )
      })
    }
    const press = (el: HTMLElement, clientX: number, init = {}) =>
      fireEvent.pointerDown(el, {
        button: 0,
        pointerType: 'mouse',
        clientX,
        ...init,
      })
    const moveTo = (clientX: number) =>
      fireEvent.pointerMove(window, { clientX })
    const release = () => fireEvent.pointerUp(window)
    // The rows in another order, as the server's new order draws them
    const reordered = (onMove: () => unknown) => (
      <TabGroupRows
        rows={[ROWS[1], ROWS[0], ROWS[2]]}
        active="review"
        onSelect={onSelect}
        onMove={onMove}
      />
    )
    afterEach(async () => {
      vi.restoreAllMocks()
      onSelect.mockClear()
      // A drag's swallowed click is let go after its task
      await new Promise((r) => setTimeout(r))
    })

    it('marks the groups movable only with onMove and more than one', () => {
      const { unmount } = renderMovable(vi.fn())
      expect(row(/review/)).toHaveAttribute('data-movable', 'true')
      expect(row(/review/)).toHaveAttribute(
        'aria-keyshortcuts',
        'Alt+ArrowLeft Alt+ArrowRight',
      )
      unmount()
      renderRow('review')
      expect(row(/review/)).not.toHaveAttribute('data-movable')
      expect(row(/review/)).not.toHaveAttribute('aria-keyshortcuts')
    })

    it('does not drag without onMove', () => {
      renderRow('review')
      layOut()
      press(row(/review/), 50)
      moveTo(160)
      expect(slide(/review/)).toBe('')
    })

    it('does not drag a single line', () => {
      render(
        <TabGroupRows
          rows={[ROWS[0]]}
          active="review"
          onSelect={onSelect}
          onMove={vi.fn()}
        />,
      )
      press(row(/review/), 50)
      moveTo(160)
      expect(slide(/review/)).toBe('')
    })

    it('slides a group along the row, the others making room, and asks its move', async () => {
      const onMove = vi.fn()
      const { rerender } = renderMovable(onMove)
      layOut()
      press(row(/review/), 50)
      // Less than the slop: still a click
      moveTo(52)
      expect(slide(/review/)).toBe('')
      moveTo(160)
      expect(row(/review/)).toHaveAttribute('data-dragging', 'true')
      expect(slide(/review/)).toBe('110px 0')
      expect(slide(/No group/)).toBe('-100px 0')
      expect(slide(/coding/)).toBe('')
      // Held inside the row
      moveTo(900)
      expect(slide(/review/)).toBe('200px 0')
      moveTo(160)
      release()
      expect(row(/review/)).not.toHaveAttribute('data-dragging')
      expect(onMove).toHaveBeenCalledWith(0, 1)
      // In its slot until the new order
      expect(slide(/review/)).toBe('100px 0')
      expect(slide(/No group/)).toBe('-100px 0')
      // The click that ends the drag picks nothing
      fireEvent.click(row(/review/))
      expect(onSelect).not.toHaveBeenCalled()
      rerender(reordered(onMove))
      expect(slide(/review/)).toBe('')
      expect(slide(/No group/)).toBe('')
      expect(row(/review/).style.transition).toBe('')
      await Promise.resolve()
    })

    it('drags to the left too', () => {
      const onMove = vi.fn()
      renderMovable(onMove)
      layOut()
      press(row(/coding/), 250)
      moveTo(20)
      expect(slide(/coding/)).toBe('-200px 0')
      expect(slide(/review/)).toBe('100px 0')
      release()
      expect(onMove).toHaveBeenCalledWith(2, 0)
      expect(slide(/coding/)).toBe('-200px 0')
    })

    it('slides the groups back when the move ends without a new order', async () => {
      const onMove = vi.fn().mockRejectedValue(new Error('refused'))
      renderMovable(onMove)
      layOut()
      press(row(/review/), 50)
      moveTo(160)
      release()
      expect(slide(/review/)).toBe('100px 0')
      await vi.waitFor(() => expect(slide(/review/)).toBe(''))
      expect(slide(/No group/)).toBe('')
      // Another drag may start
      press(row(/review/), 50)
      moveTo(160)
      expect(slide(/review/)).toBe('110px 0')
      fireEvent.pointerCancel(window)
      expect(slide(/review/)).toBe('')
    })

    it('starts no other drag while one is held or in progress', () => {
      const onMove = vi.fn(() => new Promise(() => {}))
      renderMovable(onMove)
      layOut()
      press(row(/review/), 50)
      // A second press during the drag is ignored
      press(row(/coding/), 250)
      moveTo(160)
      expect(slide(/coding/)).toBe('')
      release()
      expect(onMove).toHaveBeenCalledTimes(1)
      press(row(/coding/), 250)
      moveTo(20)
      expect(slide(/coding/)).toBe('')
      // Nor a move by its keys
      row(/coding/).focus()
      fireEvent.keyDown(row(/coding/), { key: 'ArrowLeft', altKey: true })
      expect(onMove).toHaveBeenCalledTimes(1)
    })

    it('puts the group back on a drop where it was, Escape or a cancel', () => {
      const onMove = vi.fn()
      renderMovable(onMove)
      layOut()
      press(row(/review/), 50)
      moveTo(160)
      moveTo(55)
      release()
      expect(slide(/review/)).toBe('')
      press(row(/review/), 50)
      // Escape before the drag began is not its key
      fireEvent.keyDown(window, { key: 'Escape' })
      moveTo(160)
      fireEvent.keyDown(window, { key: 'a' })
      expect(slide(/review/)).toBe('110px 0')
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(slide(/review/)).toBe('')
      expect(slide(/No group/)).toBe('')
      expect(onMove).not.toHaveBeenCalled()
    })

    it('leaves a press that never moved as a click', () => {
      const onMove = vi.fn()
      renderMovable(onMove)
      layOut()
      press(row(/coding/), 250)
      release()
      fireEvent.click(row(/coding/))
      expect(onSelect).toHaveBeenCalledWith(ROWS[2])
      expect(onMove).not.toHaveBeenCalled()
    })

    it('ignores another button and a touch', () => {
      renderMovable(vi.fn())
      layOut()
      press(row(/review/), 50, { button: 2 })
      moveTo(160)
      press(row(/review/), 50, { pointerType: 'touch' })
      moveTo(160)
      expect(slide(/review/)).toBe('')
    })

    it('puts the group back when the row changed under the drag', () => {
      const onMove = vi.fn()
      const { rerender } = renderMovable(onMove)
      layOut()
      press(row(/review/), 50)
      moveTo(160)
      rerender(reordered(onMove))
      release()
      expect(onMove).not.toHaveBeenCalled()
      expect(slide(/review/)).toBe('')
    })

    it('ends a drag in progress when it goes', () => {
      const onMove = vi.fn()
      const { unmount } = renderMovable(onMove)
      layOut()
      press(row(/review/), 50)
      moveTo(160)
      unmount()
      release()
      expect(onMove).not.toHaveBeenCalled()
    })

    it('moves the focused group with Alt+Arrow, within the row', () => {
      const onMove = vi.fn()
      renderMovable(onMove)
      const [review, none, coding] = screen.getAllByRole('tab')
      none.focus()
      fireEvent.keyDown(none, { key: 'ArrowRight', altKey: true })
      expect(onMove).toHaveBeenLastCalledWith(1, 2)
      fireEvent.keyDown(none, { key: 'ArrowLeft', altKey: true })
      expect(onMove).toHaveBeenLastCalledWith(1, 0)
      // The focus stays where it is
      expect(none).toHaveFocus()
      onMove.mockClear()
      review.focus()
      fireEvent.keyDown(review, { key: 'ArrowLeft', altKey: true })
      coding.focus()
      fireEvent.keyDown(coding, { key: 'ArrowRight', altKey: true })
      expect(onMove).not.toHaveBeenCalled()
      expect(coding).toHaveFocus()
    })

    it('does not move with Alt+Arrow without onMove', () => {
      renderRow('review')
      const [review] = screen.getAllByRole('tab')
      review.focus()
      fireEvent.keyDown(review, { key: 'ArrowRight', altKey: true })
      expect(review).toHaveFocus()
    })

    it('gives the focus back to a group its move took it from', () => {
      const onMove = vi.fn()
      const { rerender } = renderMovable(onMove)
      const review = row(/review/)
      review.focus()
      fireEvent.keyDown(review, { key: 'ArrowRight', altKey: true })
      review.blur()
      rerender(reordered(onMove))
      expect(row(/review/)).toHaveFocus()
    })

    it('leaves the focus taken elsewhere meanwhile, and a group gone', () => {
      const onMove = vi.fn()
      const { rerender } = renderMovable(onMove)
      const review = row(/review/)
      review.focus()
      fireEvent.keyDown(review, { key: 'ArrowRight', altKey: true })
      row(/coding/).focus()
      rerender(reordered(onMove))
      expect(row(/coding/)).toHaveFocus()
      const coding = row(/coding/)
      fireEvent.keyDown(coding, { key: 'ArrowLeft', altKey: true })
      coding.blur()
      rerender(
        <TabGroupRows
          rows={[ROWS[1], ROWS[0]]}
          active="review"
          onSelect={onSelect}
          onMove={onMove}
        />,
      )
      expect(document.body).toHaveFocus()
    })
  })
})
