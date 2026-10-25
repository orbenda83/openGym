// @vitest-environment happy-dom
// Finishing a workout while a timed hold counts down. Discard has stopped the hold since GL!59;
// Finish stopped only the rest timer, so the hold bar (app-wide, App.jsx) went on counting over
// the summary and Home, chimed at zero, and its callback then wrote into a workout that was gone.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkout, finishWorkoutSheet } from './sheets.jsx'
import { EXDB } from './lib/exercises-data.js'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []

// Mounted before the click's own act(): a render nested inside it lands only once it is over.
function tapInTopSheet(text) {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  const target = [...host.querySelectorAll('button, [role=button]')].find(b => b.textContent.trim() === text)
  expect(target, text).toBeTruthy()
  act(() => { target.click() })
}

function install(sets) {
  const st = clone(DEF)
  st.active = {
    id: 'fin', d: '2026-09-28', start: Date.now() - 20 * 60000, routineId: null, name: 'Core', bw: null, cur: 0,
    entries: [{ id: EXDB[0].id, target: { mode: 'reps', sets: sets.length, reps: 5, weight: 40 }, sets }]
  }
  useStore.setState({ S: st, user: null })
}

// Shaped like the row's own callback in views/Workout.jsx: it writes what was held into the set.
const holdInto = set => vi.fn(elapsed => useStore.getState().update(s => { s.active.entries[0].sets[set].sec = elapsed }))

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], timer: null, work: null })
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
  useUI.getState().stopWork()
  vi.useRealTimers()
})

describe('finishing while a timed hold runs', () => {
  it('stops the hold, which then never calls back into the finished workout', () => {
    install([{ w: 40, r: 5, done: true }])
    const held = holdInto(0)
    useUI.getState().startWork(45, 'Plank', held)

    act(() => finishWorkout())
    expect(S().active).not.toBeNull()
    tapInTopSheet('Finish and save')

    expect(S().active).toBeNull()
    expect(S().workouts).toHaveLength(1)
    expect(useUI.getState().work).toBeNull()
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()
    expect(held).not.toHaveBeenCalled()
  })

  it('stops it too when the hold is the set left unchecked and Finish early is confirmed', () => {
    install([{ w: 40, r: 5, done: true }, { w: 40, r: 5 }])
    const held = holdInto(1)
    useUI.getState().startWork(45, 'Plank', held)

    act(() => finishWorkout())
    tapInTopSheet('Finish and save')

    expect(S().active).toBeNull()
    expect(useUI.getState().work).toBeNull()
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()
    expect(held).not.toHaveBeenCalled()
  })
})

// The header's Finish pill (v1.3.11): a sheet with Finish and save and Discard workout, the
// unchecked-sets warning as its subtitle, and no second question after Finish and save.
describe('the Finish sheet', () => {
  const sheetText = () => {
    const sheet = useUI.getState().sheets.at(-1)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push(root)
    act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
    return host
  }
  const tapItem = (host, text) => act(() => { [...host.querySelectorAll('.menu-item')].find(el => el.textContent.includes(text)).click() })

  it('all sets done: Finish workout? and a save that needs no confirm', () => {
    install([{ w: 40, r: 5, done: true }])
    act(() => finishWorkoutSheet({ onDiscard: vi.fn() }))
    const host = sheetText()
    expect(host.querySelector('h3').textContent).toBe('Finish workout?')
    expect(host.textContent).toContain('Duration: 20 min')
    expect(host.textContent).toContain('1 set logged')
    expect(host.textContent).toContain('0 sets unchecked')
    expect([...host.querySelectorAll('.menu-item .tt')].map(e => e.textContent)).toEqual(['Finish and save', 'Discard workout', 'Cancel'])
    expect(host.querySelector('.menu-item.danger').textContent).toContain('Discard workout')
    tapItem(host, 'Finish and save')
    expect(S().active).toBeNull()
    expect(S().workouts).toHaveLength(1)
  })

  it('keeps the early-finish wording as its message, and Discard calls the screen\'s own discard', () => {
    install([{ w: 40, r: 5, done: true }, { w: 40, r: 5 }, { w: 40, r: 5 }])
    const onDiscard = vi.fn()
    act(() => finishWorkoutSheet({ onDiscard }))
    const host = sheetText()
    expect(host.querySelector('h3').textContent).toBe('Finish early?')
    expect(host.textContent).toContain('2 sets still unchecked. Finish the workout now?')
    tapItem(host, 'Discard workout')
    expect(onDiscard).toHaveBeenCalledOnce()
    expect(S().active).not.toBeNull()
  })

  it('closing review leaves the active session unchanged', () => {
    install([{ w: 40, r: 5, done: true }])
    const before = clone(S().active)
    act(() => finishWorkout())
    act(() => useUI.getState().closeSheet(useUI.getState().sheets.at(-1).id))
    expect(S().active).toEqual(before)
    expect(S().workouts).toHaveLength(0)
  })

  it('a delayed save cannot finish a replacement session', () => {
    install([{ w: 40, r: 5, done: true }])
    act(() => finishWorkoutSheet())
    const host = sheetText()
    useStore.getState().update(s => { s.active.id = 'replacement' })
    tapItem(host, 'Finish and save')
    expect(S().active.id).toBe('replacement')
    expect(S().workouts).toHaveLength(0)
  })

  it('saves the same session after a normal store object replacement', () => {
    install([{ w: 40, r: 5, done: true }])
    act(() => finishWorkoutSheet())
    const host = sheetText()
    useStore.getState().update(s => { s.active.name = 'Renamed' })
    tapItem(host, 'Finish and save')
    expect(S().active).toBeNull()
    expect(S().workouts[0].name).toBe('Renamed')
  })

  it('does not dispatch discard for a replacement session', () => {
    install([{ w: 40, r: 5, done: true }])
    const onDiscard = vi.fn()
    act(() => finishWorkoutSheet({ onDiscard }))
    const host = sheetText()
    useStore.getState().update(s => { s.active.id = 'replacement' })
    tapItem(host, 'Discard workout')
    expect(onDiscard).not.toHaveBeenCalled()
    expect(S().active.id).toBe('replacement')
  })

  it('shows the declared duration for a backfilled session', () => {
    install([{ w: 40, r: 5, done: true }])
    useStore.getState().update(s => { s.active.backfill = { durationMin: 45 } })
    act(() => finishWorkoutSheet())
    expect(sheetText().textContent).toContain('Duration: 45 min')
  })

  it('reviews the effective duration of a forgotten session without changing its saved end', () => {
    install([{ w: 40, r: 5, done: true, at: Date.now() - 5 * 60000 }])
    const lastSetAt = S().active.entries[0].sets[0].at
    vi.advanceTimersByTime(24 * 60 * 60000)
    act(() => finishWorkoutSheet())
    const host = sheetText()
    expect(host.textContent).toContain('Duration: 15 min')
    tapItem(host, 'Finish and save')
    expect(S().workouts[0].end).toBe(lastSetAt)
  })

  it('default discard still confirms and cannot discard a replaced session', () => {
    install([{ w: 40, r: 5, done: true }])
    act(() => finishWorkout())
    tapItem(sheetText(), 'Discard workout')
    expect(S().active).not.toBeNull()
    const host = sheetText()
    expect(host.textContent).toContain('The sets you logged in this session will be lost.')
    useStore.getState().update(s => { s.active.id = 'replacement' })
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Discard').click())
    expect(S().active.id).toBe('replacement')
  })

  it('nothing checked: says so', () => {
    install([{ w: 40, r: 5 }])
    act(() => finishWorkoutSheet({ onDiscard: vi.fn() }))
    const host = sheetText()
    expect(host.querySelector('h3').textContent).toBe('Nothing logged yet')
    expect(host.textContent).toContain('You haven’t checked off any sets.')
  })
})
