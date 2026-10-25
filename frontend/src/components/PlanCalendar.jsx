import { useState } from 'react'
import { DAYS, isoOf, todayISO, fmtDate, weekStartOf, weekOrder, exCount } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { effectiveRoutines } from '../lib/history.js'
import { queueOf } from '../lib/queue.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import './PlanCalendar.css'

// A queue's floating next session is a suggestion, not a booking on a specific date.
// A pin and the user's own recurring weekdays still represent dated plans.
export function datedRoutines(S, iso) {
  const queueIds = queueOf(S)?.ids || []
  return effectiveRoutines(S, iso).filter(r => !queueIds.includes(r.id) || S.dayPlan[iso] === r.id)
}
export default function PlanCalendar({ S, onEdit, onStart, onLogClass, onHistory }) {
  const today = todayISO()
  const [selected, setSelected] = useState(today)
  const [month, setMonth] = useState(() => today.slice(0, 7) + '-01')
  const first = new Date(month + 'T12:00:00')
  const ws = weekStartOf(S)
  const offset = (first.getDay() - ws + 7) % 7
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const cells = Math.ceil((offset + count) / 7) * 7
  const planned = datedRoutines(S, selected)
  const completed = S.workouts.filter(w => w.d === selected)
  const changeMonth = delta => {
    const d = new Date(first.getFullYear(), first.getMonth() + delta, 1, 12)
    const iso = isoOf(d)
    setMonth(iso); setSelected(iso)
  }
  const reset = () => { setMonth(today.slice(0, 7) + '-01'); setSelected(today) }
  return <section className="plan-calendar" aria-label={t('Calendar')}>
    <div className="row between calendar-heading">
      <button className="iconbtn" data-previous-month aria-label={t('Previous month')} onClick={() => changeMonth(-1)}><Icon name="chevronLeft" /></button>
      <h2 aria-live="polite">{first.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })}</h2>
      <button className="iconbtn" data-next-month aria-label={t('Next month')} onClick={() => changeMonth(1)}><Icon name="chevronRight" /></button>
    </div>
    <div className="calendar-grid">
      {weekOrder(ws).map(d => <span key={'day-' + d} className="calendar-weekday">{t(DAYS[d])}</span>)}
      {Array.from({ length: cells }, (_, i) => {
        const n = i - offset + 1
        if (n < 1 || n > count) return <span key={i} aria-hidden="true" />
        const iso = isoOf(new Date(first.getFullYear(), first.getMonth(), n, 12))
        const rs = datedRoutines(S, iso)
        const done = S.workouts.some(w => w.d === iso)
        const label = [fmtDate(iso, true, true), rs.map(r => r.name).join(', '), done ? t('Done') : ''].filter(Boolean).join(' · ')
        return <button key={i} className={'calendar-date' + (selected === iso ? ' selected' : '')} data-date={iso}
          aria-label={label} aria-pressed={selected === iso} aria-current={iso === today ? 'date' : undefined} onClick={() => setSelected(iso)}>
          <span>{n}</span><span className="calendar-markers" aria-hidden="true">{rs.length > 0 && <i className="planned" />}{done && <i className="completed" />}</span>
        </button>
      })}
    </div>
    <div className="row between calendar-legend">
      <span><i className="planned" /> {t('Planned')} <i className="completed" /> {t('Done')}</span>
      <Button size="sm" variant="ghost" onClick={reset}>{t('Today')}</Button>
    </div>
    <div className="calendar-selected">
      <div className="row between" style={{ gap: 8 }}>
        <h3>{fmtDate(selected, true, true)}</h3>
        <Button size="sm" variant="tinted" data-edit-date onClick={() => onEdit(selected)}>{t('Edit date')}</Button>
      </div>
      {!planned.length && <p className="small dim">{t('Nothing scheduled')}</p>}
      {planned.map(r => <div key={r.id} className="calendar-booking">
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {completed.some(w => (w.routineIds || [w.routineId]).includes(r.id)) ? <span className="tag">{t('Done')}</span> : selected >= today && <Button size="sm" variant="tinted" data-start-routine={r.id} onClick={() => onStart(r.id, selected)}>{t('Start')}</Button>}
      </div>)}
      {completed.map(w => <div key={w.id} className="calendar-booking">
        <Icon name="checkCircle" /><div className="grow"><div className="tt">{w.name || t('Workout')}</div><div className="ss">{t('Done')}</div></div>
        {onHistory && <Button size="sm" variant="ghost" onClick={() => onHistory(w)}>{t('View')}</Button>}
      </div>)}
      {onLogClass && selected <= today && <Button size="sm" variant="ghost" onClick={() => onLogClass(selected)}>{t('Log class')}</Button>}
    </div>
  </section>
}
