import { useState } from 'react'
import { addDays, fmt, shortZone, dow, dayMonth } from '../data.js'

const KIND = { 'Above forecast': 'above', 'Below forecast': 'below', 'After-hours running': 'after' }

// Sidebar: deviation alerts. Leads for inspection, not confirmed faults.
export default function AlertsPanel({ alerts, date, span, zoneId, rule, onPick }) {
  const [scope, setScope] = useState('window')   // window = selected day/week, all zones; zone = this zone, whole period
  const last = addDays(date, span - 1)
  const list = scope === 'window'
    ? alerts.filter((a) => a.date >= date && a.date <= last)
    : alerts.filter((a) => a.zone === zoneId)
  const counts = list.reduce((m, a) => ({ ...m, [a.type]: (m[a.type] ?? 0) + 1 }), {})

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Alerts</h2>
        <div className="seg small">
          <button className={scope === 'window' ? 'on' : ''} onClick={() => setScope('window')}>{span === 1 ? 'This day' : 'These 7 days'}</button>
          <button className={scope === 'zone' ? 'on' : ''} onClick={() => setScope('zone')}>{shortZone(zoneId)}</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <span className="chip bad">{counts['Above forecast'] ?? 0} above</span>
        <span className="chip warn">{counts['Below forecast'] ?? 0} below</span>
        <span className="chip violet">{counts['After-hours running'] ?? 0} after-hours</span>
      </div>

      {list.length === 0 ? <div className="note">No alerts in this window.</div> : (
        <div className="alert-list">
          {list.slice(0, 150).map((a) => (
            <button key={a.zone + a.t} className={`alert ${KIND[a.type]}`} onClick={() => onPick(a.zone, a.date)}>
              <div className="top"><span>{shortZone(a.zone)} · {a.type}</span><span className="num">{a.dev > 0 ? '+' : ''}{fmt(a.dev)} kW</span></div>
              <div className="meta">
                {dow(a.date)} {dayMonth(a.date)}, {a.t.slice(11)} · forecast <span className="num">{fmt(a.forecast)}</span> → actual <span className="num">{fmt(a.actual)}</span> kW
              </div>
            </button>
          ))}
          {list.length > 150 && <div className="muted small">Showing the largest 150 of {list.length}.</div>}
        </div>
      )}

      <details className="plan-rule">
        <summary>Leads to check, not confirmed faults</summary>
        {rule}
      </details>
    </section>
  )
}
