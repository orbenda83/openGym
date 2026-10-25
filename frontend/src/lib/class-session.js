// An attended variable class is activity history, with no fabricated strength sets.
import { isoOf, uid } from './format.js'
import { insertChronological } from './backfill.js'
import { stampWorkout } from './sync-merge.js'

export const isClassSession = w => w?.classSession?.type === 'pilates' && w.classSession.attendance === 'attended'
export const CLASS_NOTE_MAX = 2000

export function buildClassSession({ date, durationMin = 50, attended, notes = '' }, { now = Date.now(), id = uid() } = {}) {
  const day = new Date(String(date) + 'T12:00:00')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(day.getTime()) || isoOf(day) !== date || date > isoOf(new Date(now))) {
    throw new Error('Pick a day up to today')
  }
  const minutes = Number(durationMin)
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error('Enter how long it took (at least 1 minute).')
  if (minutes > 1440) throw new Error('That’s more than a day. Keep it to 24 hours or less.')
  if (attended !== true) throw new Error('Confirm that you attended the class.')
  // Date and duration are known; the clock time is not. Anchor at local midnight,
  // and explicitly mark that time as unspecified instead of presenting it as actual.
  day.setHours(0, 0, 0, 0)
  const start = day.getTime()
  const note = String(notes || '').trim().slice(0, CLASS_NOTE_MAX)
  return {
    id, d: date, name: 'Pilates', start, end: start + minutes * 60000,
    vol: 0, entries: [], prs: [],
    classSession: { type: 'pilates', durationMin: minutes, attendance: 'attended', timeUnspecified: true },
    ...(note ? { note } : {}),
  }
}

// Check at the write boundary too: another tab may start a workout while the dialog is open.
export function appendClassSession(S, input, options) {
  if (S.active) throw new Error('Finish the current workout first.')
  const workout = buildClassSession(input, options)
  S.workouts = insertChronological(S.workouts || [], workout)
  return workout
}

// Compare the complete reviewed snapshot, including sync stamps and unknown fields.
// Store updates clone state, so reference equality cannot detect concurrent changes.
function reviewedClass(S, expected) {
  if (S.active) throw new Error('Finish the current workout first.')
  const current = expected?.id && (S.workouts || []).find(w => w.id === expected.id)
  if (!current || !isClassSession(current)) throw new Error('This class is no longer available. Reopen History.')
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('This class changed. Reopen it before making changes.')
  return current
}

export function editClassSession(S, expected, input, options) {
  const current = reviewedClass(S, expected)
  const corrected = buildClassSession(input, { ...options, id: current.id })
  const updated = {
    ...current,
    d: corrected.d, start: corrected.start, end: corrected.end,
    classSession: { ...current.classSession, durationMin: corrected.classSession.durationMin },
  }
  if (corrected.note) updated.note = corrected.note
  else delete updated.note
  stampWorkout(updated, options?.now ?? Date.now())
  S.workouts = insertChronological(S.workouts.filter(w => w.id !== current.id), updated)
  return updated
}

export function deleteClassSession(S, expected) {
  const current = reviewedClass(S, expected)
  S.workouts = S.workouts.filter(w => w.id !== current.id)
}
