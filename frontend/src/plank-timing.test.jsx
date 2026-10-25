// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig, modeOf, workoutVolume } from './lib/history.js'
import { EXIDX } from './lib/exercises.js'
import { routineFromSession } from './lib/session-routines.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exerciseDetailSheet, exConfigSheet } from './sheets.jsx'
import { _setLangState } from './lib/i18n-core.js'

let root, host
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useStore.setState({ S: structuredClone(DEF), user: null, config: null })
  useUI.setState({ sheets: [], toastMsg: '' })
  _setLangState('en', null, null, null)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const topSheet = () => {
  const sheet = useUI.getState().sheets.at(-1)
  act(() => root.render(sheet.render(() => {})))
}

describe('new elbow plank entries', () => {
  it.each(['0463', '0465', '0715'])('defaults %s to a bodyweight hold in seconds', id => {
    expect(defaultConfig(id)).toMatchObject({ mode: 'time', sec: 45, weight: 0, bodyweight: true })
    expect(defaultConfig(id)).not.toHaveProperty('reps')
  })
  it('preserves explicit rep configurations and legacy logged metrics', () => {
    expect(defaultConfig('0463', 'reps')).toMatchObject({ mode: 'reps', reps: 10 })
    expect(modeOf({ id: '0463' })).toBe('reps')
    expect(workoutVolume({ entries: [{ id: '0463', sets: [{ w: 5, r: 10, done: true }] }] })).toBe(50)
  })
  it.each([undefined, { reps: 8 }])('copies legacy reps without changing them into seconds (%j)', target => {
    const saved = { entries: [{ id: '0463', target, sets: [{ w: 0, r: 8, done: true }] }] }
    expect(routineFromSession(saved).ex[0]).toMatchObject({ mode: 'reps', reps: 8 })
  })
  it('keeps cardio details free of strength-only controls', () => {
    act(() => exerciseDetailSheet(Object.values(EXIDX).find(e => e.bp === 'cardio')))
    topSheet()
    expect(host.textContent).not.toContain('Estimated 1RM')
    expect(host.textContent).not.toContain('Plate loading')
  })
  it('opens the new plank editor with seconds rather than rep targets', () => {
    act(() => exConfigSheet(EXIDX['0463'], null, () => {}))
    topSheet()
    expect(host.textContent).toContain('Seconds')
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Time')
  })
  it.each(['0463', '0715'])('hides weight-only detail controls for %s', id => {
    act(() => exerciseDetailSheet(EXIDX[id]))
    topSheet()
    expect(host.textContent).not.toContain('Estimated 1RM')
    expect(host.textContent).not.toContain('Plate loading')
    expect(host.textContent).toContain('Add to my plan')
  })
  it('keeps strength detail controls on a normal barbell lift', () => {
    act(() => exerciseDetailSheet(EXIDX['0025']))
    topSheet()
    expect(host.textContent).toContain('Estimated 1RM')
    expect(host.textContent).toContain('Plate loading')
  })
})
