// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import { fmtDate, todayISO } from './lib/format.js'
import { startFlow } from './sheets.jsx'

let host, root
const routine = { id: 'r', name: 'Full Body', ex: [{ id: '0025', sets: 1, reps: 8, weight: 20 }] }
const top = () => {
  const sheet = useUI.getState().sheets.at(-1)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
}
const click = label => act(() => [...host.querySelectorAll('button')].find(b => b.textContent === label).click())
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-02-08T12:00:00'))
  useStore.setState({ S: { ...structuredClone(DEF), routines: [routine], active: null, workouts: [], weighIn: false }, user: null })
  useUI.setState({ sheets: [], toastMsg: '' })
  _setLangState('en', null, null, null)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('review before starting a live workout', () => {
  it('waits for confirmation and shows the routine and actual date with weighing disabled', () => {
    act(() => startFlow(['r']))
    expect(useStore.getState().S.active).toBeNull()
    expect(useUI.getState().sheets).toHaveLength(1)
    top()
    expect(host.textContent).toContain('Full Body')
    expect(host.textContent).toContain(fmtDate(todayISO(), true))
    expect(host.textContent).toContain('Start workout')
  })
  it('cancel leaves both the workout and schedule untouched', () => {
    const before = structuredClone(useStore.getState().S)
    act(() => startFlow(['r']))
    top(); click('Cancel')
    expect(useStore.getState().S).toEqual(before)
    expect(useUI.getState().sheets).toHaveLength(0)
  })
  it('starts the timer only when approved', () => {
    act(() => startFlow(['r']))
    top()
    vi.setSystemTime(new Date('2026-02-08T12:05:00'))
    click('Start workout')
    expect(useStore.getState().S.active).toMatchObject({ d: todayISO(), routineIds: ['r'], start: Date.now() })
  })
  it('shows a different planned date without moving the booking when starting today', () => {
    useStore.setState(s => ({ S: { ...s.S, dayPlan: { '2026-02-10': 'r' } } }))
    act(() => startFlow(['r'], { plannedDate: '2026-02-10' }))
    top()
    expect(host.textContent).toContain(fmtDate('2026-02-10', true))
    expect(host.textContent).toContain(fmtDate(todayISO(), true))
    click('Start workout')
    expect(useStore.getState().S.active.d).toBe(todayISO())
    expect(useStore.getState().S.dayPlan['2026-02-10']).toBe('r')
  })
  it('does not overwrite a workout that appeared while confirmation was open', () => {
    act(() => startFlow(['r'])); top()
    const active = { id: 'other', d: todayISO(), entries: [], start: Date.now() }
    act(() => useStore.setState(s => ({ S: { ...s.S, active } })))
    click('Start workout')
    expect(useStore.getState().S.active).toEqual(active)
  })
  it('does not turn a deleted routine into a freestyle workout', () => {
    act(() => startFlow(['r'])); top()
    act(() => useStore.setState(s => ({ S: { ...s.S, routines: [] } })))
    click('Start workout')
    expect(useStore.getState().S.active).toBeNull()
    expect(useUI.getState().sheets).toHaveLength(0)
  })
  it('requires a fresh review when the selected routine changes', () => {
    act(() => startFlow(['r'])); top()
    act(() => useStore.setState(s => ({ S: { ...s.S, routines: [{ ...routine, name: 'Updated routine' }] } })))
    click('Start workout')
    expect(useStore.getState().S.active).toBeNull()
    top()
    expect(host.textContent).toContain('Updated routine')
  })
  it('rechecks the selected routine after the optional weigh-in', () => {
    act(() => useStore.setState(s => ({ S: { ...s.S, weighIn: true } })))
    act(() => startFlow(['r'])); top(); click('Start workout')
    act(() => useStore.setState(s => ({ S: { ...s.S, routines: [] } })))
    top(); click('Start without weighing in')
    expect(useStore.getState().S.active).toBeNull()
  })
  it('asks again if the actual date changes before approval', () => {
    act(() => startFlow(['r'])); top()
    vi.setSystemTime(new Date('2026-02-09T00:01:00'))
    click('Start workout')
    expect(useStore.getState().S.active).toBeNull()
    top()
    expect(host.textContent).toContain(fmtDate(todayISO(), true))
    click('Start workout')
    expect(useStore.getState().S.active.d).toBe('2026-02-09')
  })
})
