// Hooks for the rest of the app (the alert sidebar, work orders) to drive the Question A page and to hear about its events.
// The page binds itself on mount, so these calls do nothing while the Question A tab is closed.
//
//   window.QA_BUILDING.setTime('2018-10-03T20:35')   move the building, the floor plan and the chart to that minute
//   window.QA_BUILDING.selectEvent(alert)            same as clicking that alert in the sidebar
//   window.QA_BUILDING.onEventSelect(fn)             fn(alert) runs whenever an alert is picked; returns an unsubscribe function
//   window.QA_BUILDING.getTime()                     'YYYY-MM-DDTHH:MM', the minute on show
//
// An "event" is an entry of public/data/qa_alerts.json (see Qn_A/README.md for its fields).
const listeners = new Set()
let impl = null

export const QA_BUILDING = {
  /** ts: 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DD HH:MM', Bangkok local time. Returns false if it is not a valid minute in the data. */
  setTime: (ts) => (impl ? impl.setTime(ts) : false),
  selectEvent: (event) => { if (impl && event) impl.selectEvent(event) },
  getTime: () => (impl ? impl.getTime() : null),
  onEventSelect: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
}

export const emitEventSelect = (event) => listeners.forEach((fn) => { try { fn(event) } catch (e) { console.error(e) } })

export function bindQaBuilding(api) {
  impl = api
  if (typeof window !== 'undefined') window.QA_BUILDING = QA_BUILDING
  return () => { if (impl === api) impl = null }
}
