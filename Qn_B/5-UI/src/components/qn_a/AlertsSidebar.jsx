// Sidebar for Question A: after-hours alert events and mock work tickets.
// Events come from public/data/qa_alerts.json, built by Qn_A/scripts/build_alerts.py from the minute data.
// Leads to investigate, not confirmed faults. Tickets live in memory only and reset on reload.
import { useEffect, useState } from 'react'
import { dayMonth, dow, loadJSON } from '../../data.js'
import { LOAD_NAME } from '../../qnaApi.js'

const GROUPS = [
  { id: 'Recurring', priority: 'High' },
  { id: 'Intermittent', priority: 'Medium' },
  { id: 'Occasional', priority: 'Low' },
]
const ACTIONS = {
  AC: ['Verify meter mapping on site', 'Confirm no 24/7 equipment in this zone', 'Check BMS AC schedule and setback'],
  Lighting: ['Verify meter mapping on site', 'Confirm no security or 24/7 lighting', 'Check lighting schedule or occupancy sensor'],
  Plug: ['Verify meter mapping on site', 'Inspect after-hours plug loads'],
}
const NEXT = { Open: 'Verified on site', 'Verified on site': 'Closed' }
const NEXT_LABEL = { Open: 'Mark verified', 'Verified on site': 'Close ticket' }

const day = (ts) => ts.slice(0, 10)
const time = (ts) => ts.slice(11, 16)
const where = (a) => `F${a.floor} Z${a.zone} · ${LOAD_NAME[a.end_use] ?? a.end_use}`
const when = (a) => {
  const sameDay = day(a.start) === day(a.end)
  return `${dow(day(a.start))} ${dayMonth(day(a.start))}, ${time(a.start)} to ${time(a.end)}${sameDay ? '' : ' next day'}`
}

export default function AlertsSidebar({ selectedId, onPick }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('Recurring')
  const [floor, setFloor] = useState('All')
  const [use, setUse] = useState('All')
  const [tickets, setTickets] = useState([])
  const [draft, setDraft] = useState(null) // { alert, action }

  useEffect(() => {
    loadJSON('qa_alerts.json').then(setData).catch(() =>
      setError('No alert file yet. From the repo root run: python Qn_A/scripts/build_alerts.py'))
  }, [])

  if (error) return <section className="panel"><div className="panel-head"><h2>Alerts</h2></div><div className="note">{error}</div></section>
  if (!data) return <section className="panel"><div className="panel-head"><h2>Alerts</h2></div><div className="muted small">Loading alerts…</div></section>

  const { meta, alerts } = data
  const ticketed = new Set(tickets.map((t) => t.alert.id))
  const open = alerts.filter((a) => !ticketed.has(a.id))
  const filtered = open.filter((a) => (floor === 'All' || a.floor === Number(floor)) && (use === 'All' || a.end_use === use))
  // Older alert files have no recurrence field: fall back to the priority they carry.
  const groupOf = (a) => a.recurrence ?? GROUPS.find((g) => g.priority === a.priority)?.id ?? 'Occasional'
  const counts = filtered.reduce((m, a) => ({ ...m, [groupOf(a)]: (m[groupOf(a)] ?? 0) + 1 }), {})
  const isAlerts = tab !== 'tickets'
  const list = filtered.filter((a) => groupOf(a) === tab)
  const r = meta.rule
  const partial = meta.floors_in_data.length < 7

  const createTicket = () => {
    const id = `T-${String(tickets.length + 1).padStart(3, '0')}`
    setTickets([...tickets, { id, alert: draft.alert, action: draft.action, status: 'Open' }])
    setDraft(null)
  }
  const advance = (id) => setTickets(tickets.map((t) => (t.id === id ? { ...t, status: NEXT[t.status] } : t)))

  return (
    <section className="panel qa-alerts" aria-labelledby="qa-alerts-title">
      <div className="panel-head">
        <h2 id="qa-alerts-title">Alerts</h2>
        <span className="sub">{open.length} open</span>
      </div>
      <div className="qa-tabs" role="tablist" aria-label="Alert groups">
        {GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={tab === g.id}
                  className={`qa-tab ${g.priority.toLowerCase()}${tab === g.id ? ' on' : ''}`} onClick={() => setTab(g.id)}>
            <span>{g.id}</span>
            <span className="qa-tab-sub">{g.priority} priority · {counts[g.id] ?? 0}</span>
          </button>
        ))}
        <button type="button" role="tab" aria-selected={tab === 'tickets'} className={`qa-tab ticket${tab === 'tickets' ? ' on' : ''}`} onClick={() => setTab('tickets')}>
          <span>Tickets</span>
          <span className="qa-tab-sub">{tickets.length}</span>
        </button>
      </div>

      {draft && (
        <div className="qa-ticket-form">
          <div className="qa-alert-top"><b>New work ticket</b><span className={`chip qa-pri ${draft.alert.priority.toLowerCase()}`}>{draft.alert.priority}</span></div>
          <div className="meta">{where(draft.alert)} · {when(draft.alert)}</div>
          <div className="meta">{draft.alert.avg_kw} kW average vs {draft.alert.p99_kw} kW P99. A lead to check, not a confirmed fault.</div>
          <label className="field">
            <span className="qa-label">Action</span>
            <select value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
              {(ACTIONS[draft.alert.end_use] ?? ACTIONS.Plug).map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <div className="row">
            <button type="button" className="btn qa-primary" onClick={createTicket}>Create ticket</button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      {isAlerts && (
        <>
          <div className="qa-alert-filters">
            <label className="field">
              <span className="qa-label">Floor</span>
              <select value={floor} onChange={(e) => setFloor(e.target.value)}>
                <option value="All">All floors</option>
                {meta.floors_in_data.map((f) => <option key={f} value={f}>Floor {f}</option>)}
              </select>
            </label>
            <div className="field">
              <span className="qa-label">Load</span>
              <div className="seg small" role="group" aria-label="Load type">
                {['All', 'AC', 'Lighting', 'Plug'].map((u) => (
                  <button key={u} type="button" className={use === u ? 'on' : ''} aria-pressed={use === u} onClick={() => setUse(u)}>{u}</button>
                ))}
              </div>
            </div>
          </div>

          {list.length === 0 ? <div className="note">No {tab.toLowerCase()} alerts match these filters.</div> : (
            <div className="alert-list">
              {list.map((a) => (
                <div key={a.id} className={`qa-alert ${a.priority.toLowerCase()}${a.id === selectedId ? ' sel' : ''}`}>
                  <button type="button" className="qa-alert-main" onClick={() => onPick(a)} aria-pressed={a.id === selectedId}
                          title="Show this alert's floor and time on the page">
                    <span className="qa-alert-top"><span>{where(a)}</span><span className="num">+{a.kw_above} kW</span></span>
                    <span className="meta">{when(a)}</span>
                    <span className="meta">Above P99 for {a.minutes_above} of {a.span_minutes} min · peak <span className="num">{a.peak_kw}</span> kW at {time(a.peak_at)}</span>
                    {a.recurrence && <span className="meta">Alerts in {a.months_with_alerts} of {a.months_assessed} months for this zone and load</span>}
                  </button>
                  <div className="qa-alert-foot">
                    <span className={`chip qa-pri ${a.priority.toLowerCase()}`}>{a.priority}</span>
                    <span className="muted small num">{a.kwh_above} kWh above P99</span>
                    <button type="button" className="btn small" onClick={() => setDraft({ alert: a, action: (ACTIONS[a.end_use] ?? ACTIONS.Plug)[0] })}>Create ticket</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'tickets' && (
        tickets.length === 0 ? <div className="note">No tickets yet. Create one from an alert.</div> : (
          <div className="alert-list">
            {tickets.map((t) => (
              <div key={t.id} className="qa-alert ticket">
                <div className="qa-alert-main static">
                  <span className="qa-alert-top"><span>{t.id} · {where(t.alert)}</span><span className="small">{t.status}</span></span>
                  <span className="meta">{t.action}</span>
                  <span className="meta">{when(t.alert)}</span>
                </div>
                {NEXT[t.status] && (
                  <div className="qa-alert-foot"><button type="button" className="btn small" onClick={() => advance(t.id)}>{NEXT_LABEL[t.status]}</button></div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      <div className="note" style={{ marginTop: 12 }}>
        <b>Leads to investigate, not confirmed faults.</b> There is no occupancy data behind them.
        <div style={{ marginTop: 4 }}>
          An alert is red P99 time in one zone and load, with gaps of {r.gap_minutes} min or less joined, at least {r.min_minutes_above} min above P99
          and {r.min_kw_above} kW or more above it on average. {meta.events} of {meta.events_before_filter} events pass.
          {r.priority
            ? <> Priority is how often that zone and load comes back: <b>high</b> = recurring, alerts in at least {Math.round(r.recurring_share * 100)}% of its months
              (and {r.recurring_min_months}+ months); <b>medium</b> = intermittent, 2+ months; <b>low</b> = occasional, one month. Ranked by kWh above P99 within each.</>
            : ' Re-run the alert script to add recurrence-based priority.'}
        </div>
        {partial && <div style={{ marginTop: 4 }}>Built from Floor{meta.floors_in_data.length > 1 ? 's' : ''} {meta.floors_in_data.join(', ')} only, {day(meta.period[0])} to {day(meta.period[1])}. Re-run the script with the full minute data for all floors.</div>}
        <div style={{ marginTop: 4 }}>Tickets are a mock-up and reset when the page reloads.</div>
      </div>
    </section>
  )
}
