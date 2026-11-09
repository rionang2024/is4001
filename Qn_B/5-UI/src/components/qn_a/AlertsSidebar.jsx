// Sidebar for Question A: after-hours problems (one per floor, zone and load) and mock work tickets.
// Data comes from public/data/qa_alerts.json, built by Qn_A/scripts/build_alerts.py from the minute data.
// Each problem groups its alert events; open one to see them. Leads to investigate, not confirmed faults.
// Tickets are kept in this browser (localStorage) and can be cleared from the Tickets tab.
import { useEffect, useState } from 'react'
import { addDays, dayMonth, dow, loadJSON } from '../../data.js'
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
// Ticket flow: Open -> Verified on site -> Change made (verify before vs after) -> Closed, or back to Open.
const VERIFY_DAYS = 28 // compare this many days before and after the change
const PATTERN = { Weeknight: 'weeknights', Weekend: 'weekends', 'Early morning': 'early mornings' }
const SHOW_ALERTS = 8 // alerts listed inside an opened problem before "show all"

const day = (ts) => ts.slice(0, 10)
const time = (ts) => ts.slice(11, 16)
const kwh = (v) => Math.round(v).toLocaleString('en-US')
const where = (a) => `F${a.floor} Z${a.zone} · ${LOAD_NAME[a.end_use] ?? a.end_use}`
const when = (a) => `${dow(day(a.start))} ${dayMonth(day(a.start))}, ${time(a.start)} to ${time(a.end)}${day(a.start) === day(a.end) ? '' : ' next day'}`
const monthYear = (ts) => new Date(day(ts) + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
// The ticket's action list: the problem's next best action and first check, then the general checks for its load.
const OTHER = 'Other (type your own)'
const actionsFor = (p) => [...new Set([p.next_action?.text, p.next_action?.first_check, ...(ACTIONS[p.end_use] ?? ACTIONS.Plug)].filter(Boolean))]
const usual = (p) => `Usually ${PATTERN[p.usual_pattern] ?? p.usual_pattern}, ${p.usual_start} to ${p.usual_end}${p.usual_end_next_day ? ' next day' : ''}`

// Older alert files have no problem list: build a plain one so the page still works until the script is re-run.
function fallbackIssues(alerts) {
  const byKey = new Map()
  for (const a of alerts) {
    const id = `F${a.floor}-Z${a.zone}-${a.end_use}`
    if (!byKey.has(id)) byKey.set(id, { id, floor: a.floor, zone: a.zone, end_use: a.end_use, priority: a.priority, recurrence: a.recurrence, alerts: 0, kwh_above: 0, biggest_alert: a.id })
    const p = byKey.get(id)
    p.alerts += 1
    p.kwh_above += a.kwh_above
  }
  return [...byKey.values()]
}

// Before vs after a change: this problem's alerts in VERIFY_DAYS before the change day and VERIFY_DAYS from it.
// If the data ends sooner, both windows shrink to the days available after the change, so the two sides stay comparable.
function verify(issueAlerts, changeDay, dataStart, dataEnd) {
  const span = (x, y) => Math.round((new Date(y) - new Date(x)) / 864e5)
  const days = Math.max(0, Math.min(VERIFY_DAYS, span(changeDay, day(dataEnd)) + 1, span(day(dataStart), changeDay)))
  const from = addDays(changeDay, -days), to = addDays(changeDay, days)
  const sum = (xs) => Math.round(xs.reduce((n, a) => n + a.kwh_above, 0))
  const before = issueAlerts.filter((a) => day(a.start) >= from && day(a.start) < changeDay)
  const after = issueAlerts.filter((a) => day(a.start) >= changeDay && day(a.start) < to)
  const daysAfter = days
  let verdict = 'still'
  if (days === 0) verdict = 'nodata'
  else if (before.length === 0 && after.length === 0) verdict = 'empty'
  else if (before.length === 0) verdict = 'new'
  else if (after.length === 0 && before.length > 0) verdict = 'stopped'
  else if (sum(after) < sum(before) * 0.5) verdict = 'fewer'
  return { before: before.length, beforeKwh: sum(before), after: after.length, afterKwh: sum(after), daysAfter, verdict }
}
const VERDICT = {
  stopped: { cls: 'good', text: 'No alerts since the change. The fix looks like it worked.' },
  fewer: { cls: 'good', text: 'Less than half the kWh above P99 since the change, but still some alerts. Keep watching.' },
  still: { cls: 'bad', text: 'Still happening, without a clear drop (less than half). Reopen and check again.' },
  nodata: { cls: 'plain', text: 'No data after this date to check against.' },
  empty: { cls: 'plain', text: 'No alerts either side of this date, so there is nothing to compare. Pick a change date close to this problem\'s alerts.' },
  new: { cls: 'bad', text: 'Alerts appear after the change but none before it. Check whether the change caused them.' },
}

// Tickets are saved in this browser only (localStorage), so they survive a refresh on the demo laptop.
// Storage can be blocked (private windows, some previews), so every read and write is guarded and the page works without it.
const TICKETS_KEY = 'qa-tickets-v1'
function loadTickets() {
  try {
    const raw = window.localStorage.getItem(TICKETS_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch { return [] }
}
function saveTickets(list) {
  try { window.localStorage.setItem(TICKETS_KEY, JSON.stringify(list)) } catch { /* storage unavailable: keep in memory only */ }
}

export default function AlertsSidebar({ selectedId, onPick, date }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('Recurring')
  const [floor, setFloor] = useState('All')
  const [use, setUse] = useState('All')
  const [openId, setOpenId] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [tickets, setTicketsState] = useState(loadTickets)
  const setTickets = (list) => { setTicketsState(list); saveTickets(list) }
  const [draft, setDraft] = useState(null) // { issue, action, custom, note }

  useEffect(() => {
    loadJSON('qa_alerts.json').then(setData).catch(() =>
      setError('No alert file yet. From the repo root run: python Qn_A/scripts/build_alerts.py'))
  }, [])

  if (error) return <section className="panel"><div className="panel-head"><h2>Alerts</h2></div><div className="note">{error}</div></section>
  if (!data) return <section className="panel"><div className="panel-head"><h2>Alerts</h2></div><div className="muted small">Loading alerts…</div></section>

  const { meta, alerts } = data
  const issues = data.issues ?? fallbackIssues(alerts)
  const byId = new Map(alerts.map((a) => [a.id, a]))
  const alertsOf = (p) => alerts.filter((a) => a.floor === p.floor && a.zone === p.zone && a.end_use === p.end_use)
    .sort((x, y) => (x.start < y.start ? 1 : -1))
  const groupOf = (p) => p.recurrence ?? GROUPS.find((g) => g.priority === p.priority)?.id ?? 'Occasional'

  const ticketed = new Set(tickets.map((t) => t.issue.id))
  const open = issues.filter((p) => !ticketed.has(p.id))
  const filtered = open.filter((p) => (floor === 'All' || p.floor === Number(floor)) && (use === 'All' || p.end_use === use))
  const counts = filtered.reduce((m, p) => ({ ...m, [groupOf(p)]: (m[groupOf(p)] ?? 0) + 1 }), {})
  const list = filtered.filter((p) => groupOf(p) === tab)
  const openAlerts = open.reduce((n, p) => n + p.alerts, 0)
  const r = meta.rule
  const partial = meta.floors_in_data.length < 7

  const pickTab = (t) => { setTab(t); setOpenId(null) }
  const toggle = (p) => { setOpenId(openId === p.id ? null : p.id); setShowAll(false) }
  const createTicket = () => {
    const id = `T-${String(tickets.length + 1).padStart(3, '0')}`
    const action = draft.action === OTHER ? draft.custom.trim() : draft.action
    setTickets([...tickets, { id, issue: draft.issue, action, note: draft.note.trim(), status: 'Open' }])
    setDraft(null)
    setOpenId(null)
  }
  const update = (id, patch) => setTickets(tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  return (
    <section className="panel qa-alerts" aria-labelledby="qa-alerts-title">
      <div className="panel-head">
        <h2 id="qa-alerts-title">Alerts</h2>
        <span className="sub">{open.length} problems · {openAlerts} alerts</span>
      </div>
      <div className="qa-tabs" role="tablist" aria-label="Alert groups">
        {GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={tab === g.id}
                  className={`qa-tab ${g.priority.toLowerCase()}${tab === g.id ? ' on' : ''}`} onClick={() => pickTab(g.id)}>
            <span>{g.id}</span>
            <span className="qa-tab-sub">{g.priority} priority · {counts[g.id] ?? 0}</span>
          </button>
        ))}
        <button type="button" role="tab" aria-selected={tab === 'tickets'} className={`qa-tab ticket${tab === 'tickets' ? ' on' : ''}`} onClick={() => pickTab('tickets')}>
          <span>Tickets</span>
          <span className="qa-tab-sub">{tickets.length}</span>
        </button>
      </div>

      {draft && (
        <div className="qa-ticket-form">
          <div className="qa-alert-top"><b>New work ticket</b><span className={`chip qa-pri ${draft.issue.priority.toLowerCase()}`}>{draft.issue.priority}</span></div>
          <div className="meta">{where(draft.issue)} · {draft.issue.alerts} alert{draft.issue.alerts === 1 ? '' : 's'}</div>
          {draft.issue.usual_pattern && <div className="meta">{usual(draft.issue)}. A lead to check, not a confirmed fault.</div>}
          <label className="field">
            <span className="qa-label">Action</span>
            <select value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
              {actionsFor(draft.issue).map((a) => <option key={a}>{a}</option>)}
              <option>{OTHER}</option>
            </select>
          </label>
          {draft.action === OTHER && (
            <label className="field">
              <span className="qa-label">Your action</span>
              <input type="text" value={draft.custom} autoFocus placeholder="e.g. Ask tenant about the late Thursday meeting"
                     onChange={(e) => setDraft({ ...draft, custom: e.target.value })} />
            </label>
          )}
          <label className="field">
            <span className="qa-label">Note for the team (optional)</span>
            <textarea rows="2" value={draft.note} placeholder="Anything the person on site should know"
                      onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </label>
          <div className="row">
            <button type="button" className="btn qa-primary" onClick={createTicket}
                    disabled={draft.action === OTHER && !draft.custom.trim()}>Create ticket</button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      {tab !== 'tickets' && (
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

          {list.length === 0 ? <div className="note">No {tab.toLowerCase()} problems match these filters.</div> : (
            <div className="alert-list">
              {list.map((p) => {
                const isOpen = openId === p.id
                const inside = isOpen ? alertsOf(p) : []
                const shown = showAll ? inside : inside.slice(0, SHOW_ALERTS)
                const biggest = byId.get(p.biggest_alert)
                const holdsSel = selectedId && selectedId.startsWith(p.id + '-')
                return (
                  <div key={p.id} className={`qa-alert ${p.priority.toLowerCase()}${holdsSel ? ' sel' : ''}`}>
                    <button type="button" className="qa-alert-main" onClick={() => biggest && onPick(biggest)}
                            title="Show this problem's biggest alert on the page">
                      <span className="qa-alert-top"><span>{where(p)}</span><span className="num">{p.alerts} alert{p.alerts === 1 ? '' : 's'}</span></span>
                      {p.usual_pattern && <span className="meta">{usual(p)} <span className="muted">({p.usual_count} of {p.alerts})</span></span>}
                      {p.months_with_alerts != null && (
                        <span className="meta">Alerts in {p.months_with_alerts} of {p.months_assessed} months · {monthYear(p.first)} to {monthYear(p.last)}</span>
                      )}
                      {p.kw_above != null && <span className="meta">Average <span className="num">+{p.kw_above}</span> kW above P99 · peak <span className="num">{p.peak_kw}</span> kW</span>}
                    </button>
                    {p.next_action && (
                      <div className="qa-nba">
                        <div className="qa-nba-head"><span className="qa-label">Next best action</span>
                          {p.next_action.lever !== 'None' && <span className="chip plain">Fix type: {p.next_action.lever}</span>}</div>
                        <div className="qa-nba-text"><span className="qa-step">1</span>{p.next_action.first_check}</div>
                        <div className="qa-nba-text"><span className="qa-step">2</span>{p.next_action.text}</div>
                      </div>
                    )}
                    <div className="qa-alert-foot">
                      <span className={`chip qa-pri ${p.priority.toLowerCase()}`}>{p.priority}</span>
                      <span className="muted small num">{kwh(p.kwh_above)} kWh above P99</span>
                    </div>
                    <div className="qa-alert-foot">
                      <button type="button" className="btn small" aria-expanded={isOpen} onClick={() => toggle(p)}>
                        {isOpen ? 'Hide alerts' : `Show alerts (${p.alerts})`}
                      </button>
                      <button type="button" className="btn small" onClick={() => setDraft({ issue: p, action: actionsFor(p)[0], custom: '', note: '' })}>Create ticket</button>
                    </div>
                    {isOpen && (
                      <ul className="qa-events">
                        {shown.map((a) => (
                          <li key={a.id}>
                            <button type="button" className={`qa-event${a.id === selectedId ? ' sel' : ''}`} onClick={() => onPick(a)}
                                    aria-pressed={a.id === selectedId} title="Show this alert on the page">
                              <span>{when(a)}</span>
                              <span className="num">+{a.kw_above} kW · {a.minutes_above} min</span>
                            </button>
                          </li>
                        ))}
                        {inside.length > SHOW_ALERTS && (
                          <li><button type="button" className="btn small" onClick={() => setShowAll(!showAll)}>
                            {showAll ? 'Show fewer' : `Show all ${inside.length}`}
                          </button></li>
                        )}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'tickets' && (
        tickets.length === 0 ? <div className="note">No tickets yet. Create one from a problem.</div> : (
          <div className="alert-list">
            <div className="qa-tickets-head">
              <span className="muted small">Saved in this browser</span>
              <button type="button" className="btn small" onClick={() => setTickets([])}>Clear tickets</button>
            </div>
            {tickets.map((t) => (
              <div key={t.id} className="qa-alert ticket">
                <div className="qa-alert-main static">
                  <span className="qa-alert-top"><span>{t.id} · {where(t.issue)}</span><span className="small">{t.status}</span></span>
                  <span className="meta">{t.action}</span>
                  {t.note && <span className="meta qa-note">Note: {t.note}</span>}
                  <span className="meta">{t.issue.alerts} alert{t.issue.alerts === 1 ? '' : 's'}{t.issue.usual_pattern ? ` · ${usual(t.issue).toLowerCase()}` : ''}</span>
                </div>
                {t.status === 'Open' && (
                  <div className="qa-alert-foot"><button type="button" className="btn small" onClick={() => update(t.id, { status: 'Verified on site' })}>Mark verified</button></div>
                )}
                {t.status === 'Verified on site' && (
                  <div className="qa-alert-foot qa-change">
                    <label className="field">
                      <span className="qa-label">Change made on</span>
                      <input type="date" value={t.changeDay ?? date} min={day(meta.period[0])} max={day(meta.period[1])}
                             onChange={(e) => e.target.value && update(t.id, { changeDay: e.target.value })} />
                    </label>
                    <button type="button" className="btn small qa-primary" onClick={() => update(t.id, { status: 'Change made', changeDay: t.changeDay ?? date })}>Mark change made</button>
                  </div>
                )}
                {(t.status === 'Change made' || t.status === 'Closed') && (() => {
                  const v = verify(alertsOf(t.issue), t.changeDay, meta.period[0], meta.period[1])
                  return (
                    <div className="qa-verify">
                      <div className="qa-nba-head"><span className="qa-label">Did it work?</span><span className="muted small">change on {dayMonth(t.changeDay)} {t.changeDay.slice(0, 4)}</span></div>
                      {t.issue.first && <span className="muted small">This problem's alerts run from {dayMonth(day(t.issue.first))} {t.issue.first.slice(0, 4)} to {dayMonth(day(t.issue.last))} {t.issue.last.slice(0, 4)}.</span>}
                      <div className="qa-verify-grid">
                        <div><span className="muted small">{v.daysAfter} day{v.daysAfter === 1 ? '' : 's'} before</span><b className="num">{v.before} alerts</b><span className="muted small num">{v.beforeKwh} kWh above P99</span></div>
                        <div><span className="muted small">{v.daysAfter} day{v.daysAfter === 1 ? '' : 's'} after</span><b className="num">{v.after} alerts</b><span className="muted small num">{v.afterKwh} kWh above P99</span></div>
                      </div>
                      {v.daysAfter > 0 && v.daysAfter < VERIFY_DAYS && <span className="muted small">Shortened to {v.daysAfter} day{v.daysAfter === 1 ? '' : 's'} each side, because the data runs out.</span>}
                      <div className={`chip ${VERDICT[v.verdict].cls}`} style={{ whiteSpace: 'normal' }}>{VERDICT[v.verdict].text}</div>
                      {t.status === 'Change made' && (
                        <div className="row">
                          <button type="button" className="btn small qa-primary" onClick={() => update(t.id, { status: 'Closed' })}>Close ticket</button>
                          <button type="button" className="btn small" onClick={() => update(t.id, { status: 'Open', changeDay: undefined })}>Reopen</button>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>
        )
      )}

      <div className="note qa-lead">
        <b>Every alert is a lead to check, not a confirmed fault.</b> This panel has no occupancy or booking data,
        so always confirm on site before changing anything.
      </div>

      <details className="qa-guide">
        <summary>How to use this panel</summary>

        <h3>What an alert means</h3>
        <p>
          Each zone's AC, lighting and plug load has its own <b>normal upper limit</b> for every hour of the week, worked out from the
          last 8 weeks of readings. It is the level that zone stays under 99% of the time at that hour and weekday (shown as "P99").
          An alert means the load went well above that limit outside office hours:
        </p>
        <ul>
          <li>above the limit for at least 5 minutes in a row at some point,</li>
          <li>above it for at least {r.min_minutes_above} minutes in total, and</li>
          <li>on average at least {r.min_kw_above} kW above it, so tiny loads are left out.</li>
        </ul>
        <p>
          Short dips of {r.gap_minutes} minutes or less are joined, so equipment switching on and off through one evening counts as one alert.
          Office hours are weekdays 08:00 to 17:00. Public holidays are not checked.
        </p>

        <h3>Problems, not single alerts</h3>
        <p>
          Each card is one <b>problem</b>: every alert for one floor, zone and load, such as "F1 Z2 · AC". You fix a problem once,
          so tickets are made per problem. The card shows when it usually happens, how many months it appeared in, and how much
          energy went above the normal limit (kWh above P99). Click the card to see its biggest alert on the building and chart,
          or <b>Show alerts</b> to pick a specific one.
        </p>

        <h3>Which tab to start with</h3>
        <dl>
          <dt><span className="chip qa-pri high">High</span> Recurring</dt>
          <dd>Comes back in at least half of the months, and in 3 or more. Most likely a setting or habit, and usually where the
            biggest savings are. Start here.</dd>
          <dt><span className="chip qa-pri medium">Medium</span> Intermittent</dt>
          <dd>Comes back in 2 or more months, but not most of them. Look for what triggers it, such as certain days or events.</dd>
          <dt><span className="chip qa-pri low">Low</span> Occasional</dt>
          <dd>Seen in one month only. Often a one-off, such as an event or late work. Check before acting.</dd>
        </dl>
        <p>Within each tab, problems are ranked by energy above the normal limit, biggest first. Use the floor and load filters to narrow the list.</p>

        <h3>Next best action</h3>
        <p>
          Each card suggests two steps, picked by fixed rules from the load and when the problem usually happens.
          <b> Step 1 is always a check</b>: confirm the meter reads the right equipment, and that the zone has nothing that must run
          around the clock, such as a server room, or security lighting. Only then do step 2.
        </p>
        <p>The tag on each card says what kind of fix step 2 is:</p>
        <dl>
          <dt>Fix type: Schedule</dt>
          <dd>Change when equipment switches on or off in the building management system. For example, stop the AC at 18:00 instead of
            letting it run to 23:00, turn the weekend AC schedule off, or start lighting later in the morning. Often quick and low-cost.</dd>
          <dt>Fix type: Lighting</dt>
          <dd>Add lighting controls, such as a timer, an occupancy sensor that switches lights off when nobody is there, or daylight
            dimming. Best when lights are on in empty spaces at night or weekends.</dd>
          <dt>Fix type: Behaviour</dt>
          <dd>Change how the space is used. For example, ask tenants to switch off equipment, put chargers on timers, or confirm whether
            an event or booking explains the load.</dd>
        </dl>
        <p>
          If no rule fits, the card says to investigate on site. Any change should still respect comfort, safety, tenant needs and
          equipment limits. You can also type your own action when creating a ticket.
        </p>

        <h3>Tickets</h3>
        <ol>
          <li><b>Create ticket</b> on a problem, choose or type the action, and add a note for whoever goes on site.</li>
          <li><b>Mark verified</b> once the on-site check is done.</li>
          <li><b>Mark change made</b> and enter the date the fix went in.</li>
          <li><b>Did it work?</b> compares the problem's alerts in the {VERIFY_DAYS} days before and after that date.
            Close the ticket if the alerts stop, or reopen it if they continue.</li>
        </ol>
      </details>

      <div className="muted small qa-demo">
        Demo: historical CU-BEMS data, {day(meta.period[0])} to {day(meta.period[1])}{partial ? `, Floor${meta.floors_in_data.length > 1 ? 's' : ''} ${meta.floors_in_data.join(', ')} only` : ''}.
        Tickets are saved in this browser only, so other people will not see them. No change was really made, so "Did it work?" shows how the check works, not a real result.
      </div>
    </section>
  )
}
