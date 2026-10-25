// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import PlanCalendar from './PlanCalendar.jsx'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const routine = { id: 'full', name: 'Full Body', ex: [] }
const base = { routines: [routine], workouts: [], dayPlan: {}, week: { 1: ['full'] }, weekStart: 0 }
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 25, 12)); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const mount = (S = base, props = {}) => act(() => root.render(<PlanCalendar S={S} onEdit={vi.fn()} onStart={vi.fn()} {...props} />))
const click = selector => act(() => host.querySelector(selector).click())
describe('dated Plan calendar', () => {
  it('opens on the current month with today selected and real date markers', () => {
    mount()
    expect(host.querySelector('[aria-current="date"]').dataset.date).toBe('2026-10-25')
    expect(host.querySelector('[data-date="2026-10-26"]').textContent).toContain('26')
    expect(host.querySelector('[data-date="2026-10-26"]').getAttribute('aria-label')).toContain('Full Body')
    expect(host.querySelector('[aria-pressed="true"]').dataset.date).toBe('2026-10-25')
  })
  it('changes only the selected dated plan, never the recurring weekday', () => {
    const onEdit = vi.fn(); mount(base, { onEdit })
    click('[data-date="2026-10-26"]'); click('[data-edit-date]')
    expect(onEdit).toHaveBeenCalledWith('2026-10-26')
    expect(base.week).toEqual({ 1: ['full'] })
  })
  it('starts only the chosen routine and preserves the selected planned date', () => {
    const onStart = vi.fn(); mount(base, { onStart })
    click('[data-date="2026-10-26"]'); click('[data-start-routine="full"]')
    expect(onStart).toHaveBeenCalledWith('full', '2026-10-26')
  })
  it('navigates months and years without overflowing dates', () => {
    mount(); click('[data-next-month]'); click('[data-next-month]'); click('[data-next-month]')
    expect(host.querySelector('[data-date="2027-01-01"]')).not.toBeNull()
    click('[data-previous-month]')
    expect(host.querySelector('[data-date="2026-12-01"]')).not.toBeNull()
  })
  it('distinguishes completed workouts from planned routines and empty days', () => {
    mount({ ...base, workouts: [{ id: 'done', d: '2026-10-25', name: 'Pilates', entries: [] }] })
    expect(host.querySelector('[data-date="2026-10-25"]').getAttribute('aria-label')).toContain('Done')
    expect(host.textContent).toContain('Pilates')
    expect(host.textContent).toContain('Nothing scheduled')
  })
  it('does not fabricate a dated booking from a floating rotation', () => {
    mount({ ...base, week: {}, queue: { ids: ['full'], since: 1, startsOn: '2026-10-25' } })
    expect(host.querySelector('[data-date="2026-10-25"]').getAttribute('aria-label')).not.toContain('Full Body')
    expect(host.querySelector('[data-start-routine]')).toBeNull()
  })
  it('honours explicit rest and a future pin', () => {
    mount({ ...base, dayPlan: { '2026-10-26': 'rest', '2026-10-27': 'full' } })
    expect(host.querySelector('[data-date="2026-10-26"]').getAttribute('aria-label')).not.toContain('Full Body')
    expect(host.querySelector('[data-date="2026-10-27"]').getAttribute('aria-label')).toContain('Full Body')
  })
})


it('does not offer an already completed planned routine as outstanding', () => {
  mount({ ...base, week: { 0: ['full'] }, workouts: [{ id: 'done-full', d: '2026-10-25', routineId: 'full', name: 'Full Body', entries: [] }] })
  expect(host.querySelector('[data-start-routine="full"]')).toBeNull()
})


it('starts the grid on the configured weekday', () => {
  mount({ ...base, weekStart: 1 })
  expect(host.querySelector('.calendar-weekday').textContent).toBe('Mo')
  mount({ ...base, weekStart: 0 })
  expect(host.querySelector('.calendar-weekday').textContent).toBe('Su')
})
