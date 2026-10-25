// @vitest-environment happy-dom
import { beforeEach, it, expect, vi } from 'vitest'
import { chooseScheduledWorkout } from './start-choice.js'
import { useStore } from '../store/useStore.js'
import { menuSheet } from '../sheets.jsx'
vi.mock('../sheets.jsx', () => ({ menuSheet: vi.fn() }))
beforeEach(() => { menuSheet.mockClear(); useStore.setState(s => ({ S: { ...s.S, active: null, routines: [{ id: 'a', name: 'Full Body' }, { id: 'b', name: 'Pilates' }] } })) })
it('does not silently combine scheduled activities', () => {
  const start = vi.fn(); chooseScheduledWorkout(['a', 'b'], start)
  expect(start).not.toHaveBeenCalled()
  const menu = menuSheet.mock.calls[0][0]
  expect(menu.sections[0].items.map(i => i.label)).toEqual(['Full Body', 'Pilates'])
  menu.sections[0].items[1].onClick()
  expect(start).toHaveBeenCalledWith(['b'])
})
it('combines only through the explicit secondary action', () => {
  const start = vi.fn(); chooseScheduledWorkout(['a', 'b'], start)
  menuSheet.mock.calls[0][0].sections[1].items[0].onClick()
  expect(start).toHaveBeenCalledWith(['a', 'b'])
})
it('keeps single-workout start direct and refuses to replace an active session', () => {
  const start = vi.fn(); chooseScheduledWorkout(['a'], start)
  expect(start).toHaveBeenCalledWith(['a'])
  start.mockClear(); useStore.setState(s => ({ S: { ...s.S, active: { id: 'live' } } }))
  chooseScheduledWorkout(['a', 'b'], start)
  expect(start).not.toHaveBeenCalled()
})
