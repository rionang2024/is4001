// Text versions of what the glow and the red zone show, so nothing depends on colour alone and phones get a readable list.
import { alertText, breachText, placeText, sinceText } from './anomaly.js'
import { emitLoadSelect } from '../qaBuilding.js'

export const STATE_ICON = { red: '▲', amber: '◆', grey: '', neutral: '' }
const STATE_WORD = { red: 'Red', amber: 'Amber', grey: 'No data', neutral: 'Neutral' }

function Problem({ p }) {
  return (
    <>
      <span className={`qa-now-head ${p.status}`}>
        <span className="qa-ico" aria-hidden="true">{STATE_ICON[p.status]}</span>
        <span className="visually-hidden">{STATE_WORD[p.status]}: </span>
        {placeText(p)} · {sinceText(p)}
        {p.alert && <span className="qa-alert-tag on">Alert</span>}
      </span>
      <span className={`qa-breach ${p.status}`}>{breachText(p)}</span>
      {p.alert && <span className="qa-now-alert">{alertText(p.alert, p.at)}</span>}
    </>
  )
}

// Above the building: every floor with a problem at the chosen minute, worst first. Click one to open its plan.
export function AnomalyNow({ anom, floors, when, onOpen }) {
  const flagged = floors.filter((f) => anom[f].problems.length)
    .sort((a, b) => (anom[a].state === anom[b].state ? a - b : anom[a].state === 'red' ? -1 : 1))
  const unchecked = floors.filter((f) => anom[f].state === 'grey')
  if (!flagged.length) {
    const any = floors.some((f) => anom[f].state !== 'none')
    return (
      <div className="qa-now none" role="status">
        <b>{any ? `No amber or red readings at ${when}.` : `Nothing to show at ${when}.`}</b>
        {unchecked.length > 0 && (
          <span> Floor{unchecked.length > 1 ? 's' : ''} {unchecked.join(', ')} could not be checked (no data), which is not the same as normal.</span>
        )}
      </div>
    )
  }
  return (
    <div className="qa-now" role="status" aria-label="Problems at this minute">
      <b>At {when}: {flagged.length} floor{flagged.length > 1 ? 's' : ''} to look at</b>
      <span className="qa-now-note"> (red means investigate, not a confirmed fault)</span>
      <ul>
        {flagged.map((f) => (
          <li key={f}>
            <button type="button" className="qa-now-item" onClick={() => onOpen(f)} title={anom[f].summary}>
              <Problem p={anom[f].problems[0]} />
              {anom[f].problems.length > 1 && <span className="qa-now-more">+ {anom[f].problems.length - 1} more on this floor</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Inside the floor plan: each breached load with its numbers in red, or why the floor shows nothing red.
export function BreachList({ an, floor, when }) {
  if (!an.problems.length) {
    return <p className={`qa-breach-none ${an.state}`} role="status">{an.state === 'none' ? `No reading for the selected loads at ${when}.` : an.summary}</p>
  }
  const n = an.problems.length
  return (
    <div className="qa-breach-box">
      <p className={`qa-breach-head ${an.state}`} role="status">
        <span className="qa-ico" aria-hidden="true">{STATE_ICON[an.state]}</span>
        Needs a check on site: {n} load{n > 1 ? 's are' : ' is'} above threshold at {when}
        <small> (investigate, not a confirmed fault)</small>
      </p>
      <ul className="qa-breaches" aria-label={`Problems on Floor ${floor} at ${when}`}>
        {an.problems.map((p) => (
          <li key={`${p.zone}|${p.e}`} className={p.status}>
            <button type="button" className="qa-breach-pick" title="Show this load in the alerts sidebar"
                    onClick={() => emitLoadSelect({ floor: p.floor, zone: p.zone, end_use: p.e, at: p.at })}>
              <Problem p={p} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
