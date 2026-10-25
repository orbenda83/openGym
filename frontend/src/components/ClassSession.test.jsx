// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { LogClassSession, ClassSessionRow, ClassSessionDetail, logClassSessionSheet } from './ClassSession.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { buildClassSession } from '../lib/class-session.js'

let host, root, closed
const render = node => act(() => root.render(node))
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent === label)
const change = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); closed = false
  useStore.setState(s => ({ S: { ...s.S, workouts: [], active: null } }))
  useUI.setState({ sheets: [] })
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('class attendance dialog', () => {
  it('requires attendance and saves the entered date, actual minutes and optional notes', () => {
    render(<LogClassSession initialDate="2026-01-02" close={() => { closed = true }} />)
    expect(host.querySelector('#class-duration').value).toBe('50')
    expect(button('Save').disabled).toBe(true)
    change(host.querySelector('#class-duration'), '45')
    change(host.querySelector('textarea'), 'Reformer class')
    act(() => host.querySelector('[role="switch"]').click())
    act(() => button('Save').click())
    expect(closed).toBe(true)
    expect(useStore.getState().S.workouts[0]).toMatchObject({ d: '2026-01-02', note: 'Reformer class', entries: [], classSession: { durationMin: 45 } })
  })
  it('cancel writes nothing', () => {
    render(<LogClassSession close={() => { closed = true }} />)
    change(host.querySelector('textarea'), 'Unsaved')
    act(() => button('Cancel').click())
    expect(closed).toBe(true)
    expect(useStore.getState().S.workouts).toEqual([])
  })
  it('validates duration and prevents save when a session starts after opening', () => {
    render(<LogClassSession initialDate="2026-01-02" close={() => { closed = true }} />)
    act(() => host.querySelector('[role="switch"]').click())
    change(host.querySelector('#class-duration'), '0')
    act(() => button('Save').click())
    expect(host.querySelector('[role="alert"]').textContent).toContain('at least 1 minute')
    change(host.querySelector('#class-duration'), '50')
    useStore.setState(s => ({ S: { ...s.S, active: { id: 'running' } } }))
    act(() => button('Save').click())
    expect(host.querySelector('[role="alert"]').textContent).toContain('Finish the current workout first.')
    expect(useStore.getState().S.active.id).toBe('running')
    expect(useStore.getState().S.workouts).toEqual([])
    expect(closed).toBe(false)
  })
  it('offers a plan date and blocks opening over an active workout', () => {
    logClassSessionSheet({ iso: '2026-01-02' })
    const sheet = useUI.getState().sheets[0]
    render(sheet.render(() => {}))
    expect(host.querySelector('input[type="date"]').value).toBe('2026-01-02')
    useStore.setState(s => ({ S: { ...s.S, active: { id: 'running' } } }))
    logClassSessionSheet()
    expect(useUI.getState().sheets).toHaveLength(1)
  })
  it('shows class and duration without strength sets or volume', () => {
    render(<ClassSessionRow w={{ d: '2026-01-02', start: 1, end: 3000001 }} onClick={() => {}} />)
    expect(host.textContent).toContain('Pilates')
    expect(host.textContent).toContain('50 min')
    expect(host.textContent).not.toMatch(/sets|kg|PR/)
  })
})

describe('saved class controls', () => {
  const setup = () => {
    const w = buildClassSession({ date: '2026-01-02', durationMin: 50, attended: true, notes: 'Original' }, { id: 'class1' })
    useStore.setState(s => ({ S: { ...s.S, workouts: [w] } }))
    render(<ClassSessionDetail w={w} close={() => { closed = true }} />)
    return w
  }
  it('edits the prefilled class while preserving its identity', () => {
    const w = setup()
    act(() => button('Edit class').click())
    expect(host.querySelector('input[type="date"]').value).toBe(w.d)
    expect(host.querySelector('#class-duration').value).toBe('50')
    expect(host.querySelector('textarea').value).toBe('Original')
    expect(host.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true')
    change(host.querySelector('#class-duration'), '35')
    change(host.querySelector('textarea'), 'Corrected')
    act(() => button('Save').click())
    expect(closed).toBe(true)
    expect(useStore.getState().S.workouts).toHaveLength(1)
    expect(useStore.getState().S.workouts[0]).toMatchObject({ id: w.id, note: 'Corrected', classSession: { durationMin: 35 } })
  })
  it('cancel editing or deletion leaves the original unchanged', () => {
    const w = setup()
    act(() => button('Edit class').click())
    change(host.querySelector('textarea'), 'Not saved')
    act(() => button('Cancel').click())
    expect(useStore.getState().S.workouts[0]).toEqual(w)
    act(() => button('Delete').click())
    expect(useStore.getState().S.workouts[0]).toEqual(w)
    act(() => button('Cancel').click())
    expect(useStore.getState().S.workouts[0]).toEqual(w)
    expect(closed).toBe(false)
  })
  it('deletes only after explicit confirmation, with a sync removal stamp', () => {
    const w = setup()
    act(() => button('Delete').click())
    expect(useStore.getState().S.workouts).toHaveLength(1)
    act(() => button('Confirm delete').click())
    expect(closed).toBe(true)
    expect(useStore.getState().S.workouts).toEqual([])
    expect(useStore.getState().S.deleted.workouts[w.id]).toBeGreaterThan(0)
  })
  it('refuses an edit after concurrent replacement and a delete after concurrent removal', () => {
    const w = setup()
    act(() => button('Edit class').click())
    change(host.querySelector('textarea'), 'Stale change')
    useStore.setState(s => ({ S: { ...s.S, workouts: [{ ...w, note: 'Another device' }] } }))
    act(() => button('Save').click())
    expect(host.querySelector('[role="alert"]').textContent).toContain('This class changed.')
    expect(useStore.getState().S.workouts[0].note).toBe('Another device')
    act(() => button('Cancel').click())
    act(() => button('Delete').click())
    useStore.setState(s => ({ S: { ...s.S, workouts: [] } }))
    act(() => button('Confirm delete').click())
    expect(host.querySelector('[role="alert"]').textContent).toContain('no longer available')
    expect(useStore.getState().S.workouts).toEqual([])
    expect(closed).toBe(false)
  })
})
