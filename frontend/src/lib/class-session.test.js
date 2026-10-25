import { describe, expect, it } from 'vitest'
import { buildClassSession, appendClassSession, isClassSession, editClassSession, deleteClassSession } from './class-session.js'
import { mergeStates, stampChange } from './sync-merge.js'

const now = new Date('2026-10-25T15:00:00').getTime()
const input = { date: '2026-10-24', durationMin: 50, attended: true, notes: '  Different instructor  ' }
describe('variable class attendance', () => {
  it('records actual duration and notes without inventing strength work', () => {
    const w = buildClassSession(input, { now, id: 'class1' })
    expect(w).toMatchObject({ id: 'class1', d: input.date, name: 'Pilates', vol: 0, entries: [], prs: [], note: 'Different instructor', classSession: { type: 'pilates', durationMin: 50, attendance: 'attended' } })
    expect(w.end - w.start).toBe(50 * 60000)
    expect(new Date(w.start).getDate()).toBe(24)
    expect(isClassSession(w)).toBe(true)
  })
  it('rejects impossible/future dates, invalid duration and unconfirmed attendance', () => {
    for (const bad of [{ date: '2026-02-30' }, { date: '2026-10-26' }, { durationMin: 0 }, { durationMin: 1441 }, { durationMin: 1.5 }, { durationMin: Infinity }, { attended: false }]) {
      expect(() => buildClassSession({ ...input, ...bad }, { now })).toThrow()
    }
  })
  it('adds alongside same-day workouts and never replaces a running session', () => {
    const first = { id: 'strength', d: input.date, start: 1, entries: [] }
    const s = { workouts: [first], active: null, exWeights: { bench: { w: 100 } } }
    appendClassSession(s, input, { now, id: 'class1' })
    expect(s.workouts).toHaveLength(2)
    expect(s.workouts[0]).toBe(first)
    expect(s.exWeights).toEqual({ bench: { w: 100 } })
    s.active = { id: 'running' }
    expect(() => appendClassSession(s, input, { now })).toThrow('Finish the current workout first.')
    expect(s.active).toEqual({ id: 'running' })
    expect(s.workouts).toHaveLength(2)
  })
  it('keeps class metadata through JSON export and sync merge', () => {
    const w = buildClassSession(input, { now, id: 'class1' })
    const state = { workouts: [w], routines: [], customEx: [], bodyweight: [], exWeights: {} }
    const exported = JSON.parse(JSON.stringify(state))
    expect(mergeStates(exported, { ...state, workouts: [] }).workouts[0]).toEqual(w)
  })
})

describe('class corrections', () => {
  const saved = () => ({ ...buildClassSession(input, { now, id: 'class1' }), media: [{ hash: 'keep' }], classSession: { ...buildClassSession(input, { now }).classSession, source: 'manual' } })
  it('corrects date/duration/note with stable id and unrelated metadata preserved', () => {
    const w = saved(), other = { id: 'other', d: '2026-10-23', start: 1, entries: [] }
    const S = { workouts: [other, structuredClone(w)], active: null }
    editClassSession(S, w, { ...input, date: '2026-10-22', durationMin: 40, notes: '' }, { now })
    expect(S.workouts.map(w => w.id)).toEqual(['class1', 'other'])
    const edited = S.workouts[0]
    expect(edited).toMatchObject({ id: 'class1', d: '2026-10-22', media: w.media, classSession: { ...w.classSession, durationMin: 40 } })
    expect(edited.note).toBeUndefined()
    expect(edited.end - edited.start).toBe(40 * 60000)
  })
  it('refuses stale edits/deletes and never resurrects a deleted record', () => {
    const expected = saved()
    for (const records of [[], [{ ...expected, note: 'newer' }], [{ ...expected, classSession: undefined }]]) {
      const S = { workouts: records }
      expect(() => editClassSession(S, expected, input, { now })).toThrow()
      expect(() => deleteClassSession(S, expected)).toThrow()
      expect(S.workouts).toBe(records)
    }
  })
  it('deletes only the reviewed class and protects active strength workouts', () => {
    const w = saved(), other = { id: 'other' }, active = { id: 'running' }
    const S = { workouts: [w, other], active }
    expect(() => editClassSession(S, w, input, { now })).toThrow('Finish the current workout first.')
    expect(() => deleteClassSession(S, w)).toThrow('Finish the current workout first.')
    expect(S.active).toBe(active)
    S.active = null
    deleteClassSession(S, w)
    expect(S.workouts).toEqual([other])
  })
})

it('keeps a 50→35 minute correction when a later unrelated remote setting merges in either direction', () => {
  const original = buildClassSession(input, { now, id: 'class-sync' })
  const before = { _ts: now, workouts: [original], routines: [], customEx: [], bodyweight: [], exWeights: {}, sound: true }
  const edited = structuredClone(before)
  editClassSession(edited, original, { ...input, durationMin: 35 }, { now: now + 1000 })
  edited._ts = stampChange(before, edited, now + 1000)
  const remote = structuredClone(before)
  remote.sound = false
  remote._ts = stampChange(before, remote, now + 2000)
  for (const merged of [mergeStates(edited, remote), mergeStates(remote, edited)]) {
    expect(merged.workouts[0].classSession.durationMin).toBe(35)
    expect(merged.workouts[0].end - merged.workouts[0].start).toBe(35 * 60000)
    expect(merged.sound).toBe(false)
  }
})
