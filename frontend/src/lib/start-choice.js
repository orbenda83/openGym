import { useStore } from '../store/useStore.js'
import { menuSheet } from '../sheets.jsx'
import { t } from './i18n.js'

// Recurring weekdays can hold several activities. Combining them is a choice,
// never a side effect of tapping the main Start action.
export function chooseScheduledWorkout(ids, onStart) {
  const S = useStore.getState().S
  if (S.active) return false
  const routines = [...new Set(ids)].map(id => S.routines.find(r => r.id === id)).filter(Boolean)
  if (!routines.length) return false
  if (routines.length === 1) { onStart([routines[0].id]); return true }
  menuSheet({
    title: t('Choose a workout'),
    sections: [
      { items: routines.map(r => ({ icon: 'play', label: r.name, onClick: () => onStart([r.id]) })) },
      { items: [{ icon: 'link', label: t('Combine routines'), onClick: () => onStart(routines.map(r => r.id)) }] },
    ],
  })
  return true
}
