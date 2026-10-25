import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button, Row, TextArea, TextField, Switch } from './ui.jsx'
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'
import { todayISO, fmtDate, fmtDur } from '../lib/format.js'
import { appendClassSession, editClassSession, deleteClassSession, CLASS_NOTE_MAX } from '../lib/class-session.js'
import { tappable } from '../lib/use-sheet-keyboard.js'

export function LogClassSession({ initialDate, existing, close, onSaved = close }) {
  const [date, setDate] = useState(existing?.d || initialDate || todayISO())
  const [durationMin, setDuration] = useState(String(existing?.classSession?.durationMin ?? 50))
  const [notes, setNotes] = useState(existing?.note || '')
  const [attended, setAttended] = useState(existing?.classSession?.attendance === 'attended')
  const [error, setError] = useState('')
  const save = () => {
    try {
      useStore.getState().update(S => {
        const input = { date, durationMin, notes, attended }
        if (existing) editClassSession(S, existing, input)
        else appendClassSession(S, input)
      })
      onSaved()
    } catch (e) { setError(e.message) }
  }
  return <>
    <h3>{t(existing ? 'Edit class' : 'Log class')}</h3>
    <p className="muted small">{t('Pilates class · record attendance and actual duration.')}</p>
    <Row icon="calendar" title={t('Date')}><input aria-label={t('Date')} type="date" className="timef" value={date} max={todayISO()} onChange={e => setDate(e.target.value)} /></Row>
    <label className="small" htmlFor="class-duration">{t('Actual duration (minutes)')}</label>
    <TextField id="class-duration" type="number" inputMode="numeric" min="1" max="1440" step="1" value={durationMin} onChange={e => setDuration(e.target.value)} />
    <label className="small" htmlFor="class-notes">{t('Notes (optional)')}</label>
    <TextArea id="class-notes" value={notes} maxLength={CLASS_NOTE_MAX} onChange={e => setNotes(e.target.value)} />
    <Row title={t('I attended this class')}><Switch aria-label={t('I attended this class')} checked={attended} onChange={setAttended} /></Row>
    {error && <p role="alert" style={{ color: 'var(--red)' }}>{t(error)}</p>}
    <Button variant="primary" onClick={save} disabled={!attended}>{t('Save')}</Button>
    <Button variant="ghost" onClick={close}>{t('Cancel')}</Button>
  </>
}

// Accept a day string or {iso} for calendar/plan callers; ignore button click events.
export function logClassSessionSheet(initial) {
  if (useStore.getState().S.active) {
    useUI.getState().toast(t('Finish the current workout first.'))
    return
  }
  const initialDate = typeof initial === 'string' ? initial : initial?.iso
  useUI.getState().openSheet(close => <LogClassSession initialDate={initialDate} close={close} />)
}

export function ClassSessionRow({ w, onClick }) {
  return <div className="item" {...tappable(onClick)}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8 }}><Icon name="calendar" /></span>
    <div className="grow"><div className="tt">{t('Pilates')} · {t('Class')}</div>
      <div className="ss">{fmtDate(w.d, true)} · {fmtDur(w.end - w.start)} · {t('Attended')}</div></div>
    <Icon name="chevronRight" className="chev" />
  </div>
}

export function ClassSessionDetail({ w, close }) {
  // Hold the record as reviewed. A live store change must never silently become
  // permission to overwrite or delete a different version of this class.
  const [snapshot] = useState(() => JSON.parse(JSON.stringify(w)))
  const [mode, setMode] = useState('detail')
  const [error, setError] = useState('')
  const remove = () => {
    try {
      useStore.getState().update(S => { deleteClassSession(S, snapshot) })
      close()
    } catch (e) { setError(e.message) }
  }
  if (mode === 'edit') return <LogClassSession existing={snapshot} close={() => setMode('detail')} onSaved={close} />
  if (mode === 'delete') return <>
    <h3>{t('Delete class?')}</h3>
    <p>{t('This removes the class attendance from your history.')}</p>
    <p>{fmtDate(snapshot.d, true)} · {fmtDur(snapshot.end - snapshot.start)}</p>
    {error && <p role="alert" style={{ color: 'var(--red)' }}>{t(error)}</p>}
    <Button variant="danger" onClick={remove}>{t('Confirm delete')}</Button>
    <Button variant="ghost" onClick={() => { setError(''); setMode('detail') }}>{t('Cancel')}</Button>
  </>
  return <>
    <h3>{t('Pilates')} · {t('Class')}</h3>
    <p>{fmtDate(snapshot.d, true)} · {fmtDur(snapshot.end - snapshot.start)}</p>
    <p className="muted">{t('Attended')}</p>
    {snapshot.note && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{snapshot.note}</p>}
    <Button onClick={() => setMode('edit')}>{t('Edit class')}</Button>
    <Button variant="danger" onClick={() => setMode('delete')}>{t('Delete')}</Button>
    <Button variant="ghost" onClick={close}>{t('Close')}</Button>
  </>
}
export const classSessionDetailSheet = w => useUI.getState().openSheet(close => <ClassSessionDetail w={w} close={close} />)
