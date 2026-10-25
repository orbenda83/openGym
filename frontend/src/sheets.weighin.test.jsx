// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { startFlow } from './sheets.jsx'

// Date confirmation always comes first. The optional weigh-in follows approval only
// when Settings → During a workout → "Weigh in before workouts" is on.

let root, host
const approveStart = () => {
  const sheet = useUI.getState().sheets.at(-1)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Start workout').click())
}
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the weigh-in before a workout is a setting', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({ S: { ...s.S, active: null, routines: [], workouts: [], bodyweight: [], weighIn: true } }))
  })

  it('on (the default): Start opens the weigh-in and the session waits for it', () => {
    act(() => startFlow([]))
    expect(useStore.getState().S.active).toBeNull()
    approveStart()
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useUI.getState().sheets[0].locked).toBe(true)   // the required weigh-in, not a plain sheet
    expect(useStore.getState().S.active).toBeNull()
  })

  it('a profile written before the setting existed still asks', () => {
    useStore.setState(s => { const S = { ...s.S }; delete S.weighIn; return { S } })
    act(() => startFlow([]))
    expect(useStore.getState().S.active).toBeNull()
    approveStart()
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useUI.getState().sheets[0].locked).toBe(true)
    expect(useStore.getState().S.active).toBeNull()
  })

  it('off: approval begins the session without a weigh-in or body weight', () => {
    useStore.setState(s => ({ S: { ...s.S, weighIn: false } }))
    act(() => startFlow([]))
    expect(useStore.getState().S.active).toBeNull()
    approveStart()
    expect(useUI.getState().sheets).toHaveLength(0)
    const { active } = useStore.getState().S
    expect(active).not.toBeNull()
    expect(active.bw).toBeNull()
    expect(active.routineIds).toEqual([])
  })
})
