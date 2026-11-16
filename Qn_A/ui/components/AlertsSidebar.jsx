// Sidebar for Question A: after-hours problems (one per floor, zone and load), live status and mock work tickets.
// Data comes from public/data/qa_alerts_sd.json or qa_alerts.json (one per alert rule, picked through
// alertRule.js: the page always uses median + 3 SD unless the API has no sd rule files), built by Qn_A/scripts/build_alerts.py from the minute data.
// It follows the page's replay clock (`now`): it only knows what had happened by then, like a live dashboard.
//   Active now  alerts running at `now`
//   Watching    loads amber or red at `now` that have not become an alert yet, with how close they are
//   Tabs        problems known by `now`, by how often they come back
// Leads to investigate, not confirmed faults. Tickets are kept in this browser (localStorage).
import { useEffect, useState } from 'react'
import { dayMonth, dow, loadJSON } from '../data.js'
import { LOAD_NAME } from '../qnaApi.js'
import { QA_BUILDING } from '../qaBuilding.js'
import { keyOf, knownAt, problemsAt, useWatching } from './liveAlerts.js'
import { checkFix, FIX_VERDICT, SEG_TEXT, WeekChart } from './fixCheck.jsx'
import { alertFile, useAlertRule } from './alertRule.js'

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
// Ticket flow: Open -> Visited (checked on site; "Did it work?" compares from that day) -> optional change date
// -> Closed, or back to Open. The check itself is in fixCheck.jsx.
const PATTERN = { Weeknight: 'weeknights', Weekend: 'weekends', 'Early morning': 'early mornings' }
const SHOW_ALERTS = 8 // alerts listed inside an opened problem before "show all"

const day = (ts) => ts.slice(0, 10)
const time = (ts) => ts.slice(11, 16)
const kwh = (v) => Math.round(v).toLocaleString('en-US')
const where = (a) => `F${a.floor} Z${a.zone} · ${LOAD_NAME[a.end_use] ?? a.end_use}`
const stampText = (ts) => `${dow(day(ts))} ${dayMonth(day(ts))} ${ts.slice(0, 4)}, ${time(ts)}`
const sinceText = (ts, now) => (day(ts) === day(now) ? time(ts) : `${time(ts)} on ${dayMonth(day(ts))}`)
const when = (a) => `${dow(day(a.start))} ${dayMonth(day(a.start))}, ${time(a.start)} to ${time(a.end)}${day(a.start) === day(a.end) ? '' : ' next day'}`
const monthYear = (ts) => new Date(day(ts) + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
// The ticket's action list: the problem's next best action and first check, then the general checks for its load.
const OTHER = 'Other (type your own)'
const actionsFor = (p) => [...new Set([p.next_action?.text, p.next_action?.first_check, ...(ACTIONS[p.end_use] ?? ACTIONS.Plug)].filter(Boolean))]
const usual = (p) => `Usually ${PATTERN[p.usual_pattern] ?? p.usual_pattern}, ${p.usual_end ? `${p.usual_start} to ${p.usual_end}${p.usual_end_next_day ? ' next day' : ''}` : `from ${p.usual_start}`}`
// Replaying a finished alert moves the clock to its peak, or to the minute it became an alert if that came later,
// so the alert is still on the list at the minute you land on.
const replayAt = (a) => ((a.qualified_at ?? a.start) > a.peak_at ? a.qualified_at : a.peak_at)

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

// What still stops a watched load from being an alert, in words.
function needsText(pr, rule, ar) {
  const out = []
  if (pr.needs.red) out.push(`a red run (${ar.red_min}+ min in a row)`)
  if (pr.needs.minutes) out.push(`${rule.min_minutes_above - pr.minutes} more min above ${ar.threshold}`)
  if (pr.needs.kw) out.push(`${rule.min_kw_above}+ kW above ${ar.threshold} on average`)
  return out
}

function WatchRow({ w, rule, now, ar }) {
  const pr = w.progress
  if (!pr) {
    return (
      <span className="meta">{w.error ? 'Could not load its recent minutes.' : w.status
        ? `${w.status === 'green' ? 'At or below' : 'Not checked against'} its limit at this minute, so there is nothing building up.`
        : 'No reading at this minute.'}</span>
    )
  }
  const needs = needsText(pr, rule, ar)
  const pct = Math.min(100, Math.round((pr.minutes / rule.min_minutes_above) * 100))
  return (
    <>
      <span className="meta">
        {pr.cut ? 'Since before ' : 'Since '}{sinceText(pr.since, now)} · <span className="num">{pr.minutes}</span>
        {pr.minutes < rule.min_minutes_above ? ` of ${rule.min_minutes_above}` : ''} min above {ar.threshold} ·
        avg <span className="num">{pr.avgOver >= 0 ? '+' : ''}{pr.avgOver.toFixed(1)}</span> kW above it
      </span>
      <span className="qa-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <span className="meta">{needs.length ? `Not an alert yet. Needs ${needs.join(', ')}.` : 'Meets all three filters: it becomes an alert on its next counted minute.'}</span>
    </>
  )
}

export default function AlertsSidebar({ selectedId, onPick, now, rows, onSetTime, playing }) {
  const [data, setData] = useState(null)
  const [energy, setEnergy] = useState(null) // daily after-hours power, for "Did it work?"
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('Recurring')
  const [floor, setFloor] = useState('All')
  const [use, setUse] = useState('All')
  const [openId, setOpenId] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [tickets, setTicketsState] = useState(loadTickets)
  const setTickets = (list) => { setTicketsState(list); saveTickets(list) }
  const [draft, setDraft] = useState(null) // { issue, action, custom, note }
  const [returnTo, setReturnTo] = useState(null) // the minute to go back to after replaying an older alert
  const [picked, setPicked] = useState(null) // { floor, zone, end_use } clicked on the building
  const [flash, setFlash] = useState(0) // bumps each time something is picked, to replay the highlight and scroll

  const alertRule = useAlertRule() // 'sd' (median + 3 SD); 'p99' only if the API has no sd rule files
  useEffect(() => {
    let on = true
    setData(null)
    setError(null)
    loadJSON(alertFile(alertRule)).then((d) => { if (on) setData(d) }).catch(() => {
      if (on) setError(`No alert file for this rule yet (${alertFile(alertRule)}). From the repo root run: python Qn_A/scripts/build_alerts.py`)
    })
    return () => { on = false }
  }, [alertRule])
  useEffect(() => { loadJSON('qa_energy.json').then(setEnergy).catch(() => {}) }, [])
  useEffect(() => QA_BUILDING.onLoadSelect((load) => { setPicked({ floor: load.floor, zone: load.zone, end_use: load.end_use }); setFlash((n) => n + 1) }), [])
  useEffect(() => { if (returnTo && now >= returnTo) setReturnTo(null) }, [now, returnTo])

  const live = data ? problemsAt(data, now) : null
  const covered = new Set((live?.active ?? []).map(keyOf))
  // Only the load clicked on the building is followed: the building's own lists already show every load above its limit.
  const watching = useWatching(rows, now, data?.meta.rule, covered, picked, playing, true, alertRule)
  // the rule's threshold name and red length, for the wording (older files without it are P99)
  const ar = data?.meta.alert_rule ?? { id: 'p99', threshold: 'P99', red_min: 5 }

  // A load picked on the building: open its problem card if it has one by now.
  const pickedKey = picked ? keyOf(picked) : null
  const pickedProblem = live && pickedKey ? live.problems.find((p) => p.id === pickedKey) : null
  useEffect(() => {
    if (!pickedProblem) return
    setTab(tickets.some((t) => t.issue.id === pickedProblem.id) ? 'tickets' : pickedProblem.recurrence)
    setOpenId(null)
    setFloor('All'); setUse('All')
    setFlash((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey, pickedProblem?.id])
  // after the card has rendered: bring it to the middle of the screen
  useEffect(() => {
    if (!flash) return
    const id = pickedProblem ? `qa-p-${pickedProblem.id}` : 'qa-picked'
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash])

  if (error) return <section className="panel"><div className="panel-head"><h2>Alerts</h2></div><div className="note">{error}</div></section>
  if (!data) return <section className="panel"><div className="panel-head"><h2>Alerts</h2></div><div className="muted small">Loading alerts…</div></section>

  const { meta } = data
  const { problems, visible, active } = live
  const r = meta.rule
  const partial = meta.floors_in_data.length < 7
  const live_ok = Boolean(visible.length === 0 || visible[0].qualified_at)
  const alertsOf = (p) => visible.filter((a) => keyOf(a) === keyOf(p)).sort((x, y) => (x.start < y.start ? 1 : -1))
  const byKey = new Map(problems.map((p) => [p.id, p]))
  const date = day(now)

  const ticketed = new Set(tickets.map((t) => t.issue.id))
  const open = problems.filter((p) => !ticketed.has(p.id))
  const filtered = open.filter((p) => (floor === 'All' || p.floor === Number(floor)) && (use === 'All' || p.end_use === use))
  const counts = filtered.reduce((m, p) => ({ ...m, [p.recurrence]: (m[p.recurrence] ?? 0) + 1 }), {})
  // problems with an alert running now go first, then the usual order (energy above the limit)
  const list = filtered.filter((p) => p.recurrence === tab).sort((x, y) => (y.active > 0) - (x.active > 0))
  const openAlerts = open.reduce((n, p) => n + p.alerts, 0)
  const pickedWatch = (watching ?? []).find((w) => w.key === pickedKey)

  const pickTab = (t) => { setTab(t); setOpenId(null) }
  const toggle = (p) => { setOpenId(openId === p.id ? null : p.id); setShowAll(false) }
  // Point the building and chart at an alert. A finished one is replayed (the clock moves back to it);
  // a running one is shown at the current minute.
  // `to`: where the page scrolls afterwards. An alert in a list goes to the chart (when it happened);
  // a problem card goes to the building, with its floor open and zone highlighted (where it is).
  const show = (a, to = 'chart') => {
    if (to === 'building') QA_BUILDING.openFloor({ floor: a.floor, zone: a.zone })
    else requestAnimationFrame(() => document.querySelector('.qa-chart')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    if (a.end < now) {
      const at = replayAt(a)
      if (at < now) setReturnTo(returnTo ?? now)
      onPick({ ...a, peak_at: at })
    } else {
      onPick({ ...a, peak_at: now })
    }
  }
  const createTicket = () => {
    const id = `T-${String(tickets.length + 1).padStart(3, '0')}`
    const action = draft.action === OTHER ? draft.custom.trim() : draft.action
    setTickets([...tickets, { id, issue: draft.issue, action, note: draft.note.trim(), status: 'Open', created: now }])
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
      <div className="qa-asof">
        <span>As of <b>{stampText(now)}</b></span>
        <span className="muted small">Only what was known by this minute. Move the time to see more.</span>
        {returnTo && (
          <button type="button" className="btn small" onClick={() => { onSetTime(returnTo); setReturnTo(null) }}>
            Back to {stampText(returnTo)}
          </button>
        )}
        {!live_ok && <span className="muted small">This alert file is from an older script: re-run it to hide alerts until they qualify.</span>}
      </div>

      {picked && !pickedProblem && (
        <div id="qa-picked" key={`picked-${flash}`} className="qa-picked qa-flash" role="status">
          <div className="qa-alert-top"><b>Selected on the building: {where(picked)}</b>
            <button type="button" className="btn small" onClick={() => setPicked(null)} aria-label="Clear the selected load">Clear</button></div>
          {pickedProblem ? (
            <span className="meta">
              {covered.has(pickedKey) ? 'An alert is running now. ' : ''}
              It is a {pickedProblem.priority.toLowerCase()} priority problem with {pickedProblem.alerts} alert{pickedProblem.alerts === 1 ? '' : 's'} so far, opened below.
            </span>
          ) : (
            <span className="meta">No alert for this load by {time(now)}. The building shows every minute above {ar.threshold}; an alert needs all three filters.</span>
          )}
          {!covered.has(pickedKey) && pickedWatch && <WatchRow w={pickedWatch} rule={r} now={now} ar={ar} />}
          {!covered.has(pickedKey) && !pickedWatch && watching === null && <span className="meta muted">Checking its recent minutes…</span>}
        </div>
      )}

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

          {list.length === 0 ? (
            <div className="note">
              {floor !== 'All' || use !== 'All'
                ? `No ${tab.toLowerCase()} problems match these filters by ${time(now)}.`
                : `No ${tab.toLowerCase()} problems yet by ${stampText(now)}.`}
              {GROUPS.filter((g) => g.id !== tab && counts[g.id]).length > 0 && (
                <> See {GROUPS.filter((g) => g.id !== tab && counts[g.id]).map((g) => `${g.id} (${counts[g.id]})`).join(' or ')}{tab === 'Recurring' ? ', or move the time forward: a problem becomes recurring once it comes back in 3 or more months' : ''}.</>
              )}
            </div>
          ) : (
            <div className="alert-list">
              {list.map((p) => {
                const isOpen = openId === p.id
                const inside = isOpen ? alertsOf(p) : []
                const shown = showAll ? inside : inside.slice(0, SHOW_ALERTS)
                const latest = alertsOf(p)[0]
                const holdsSel = (selectedId && selectedId.startsWith(p.id + '-')) || p.id === pickedKey
                const isPicked = p.id === pickedKey
                return (
                  <div key={isPicked ? `${p.id}-${flash}` : p.id} id={`qa-p-${p.id}`}
                       className={`qa-alert ${p.priority.toLowerCase()}${holdsSel ? ' sel' : ''}${isPicked ? ' picked qa-flash' : ''}`}>
                    {isPicked && (
                      <span className="qa-picked-tag">
                        Selected on the building{covered.has(p.id) ? ' · alert running now' : ''}
                        <button type="button" onClick={() => setPicked(null)} aria-label="Clear the selected load">Clear</button>
                      </span>
                    )}
                    <button type="button" className="qa-alert-main" onClick={() => latest && show(latest, 'building')}
                            title={p.active ? 'Open this zone on the building' : 'Open this zone on the building and replay its latest alert'}>
                      <span className="qa-alert-top"><span>{where(p)}</span><span className="num">{p.alerts} alert{p.alerts === 1 ? '' : 's'}</span></span>
                      {p.active > 0 && <span className="meta qa-running"><span className="qa-dot red" aria-hidden="true" />Alert running now</span>}
                      {p.usual_pattern && <span className="meta">{usual(p)} <span className="muted">({p.usual_count} of {p.alerts})</span></span>}
                      <span className="meta">Alerts in {p.months_with_alerts} of {p.months_assessed} month{p.months_assessed === 1 ? '' : 's'} so far · {monthYear(p.first)}{p.first.slice(0, 7) === p.last.slice(0, 7) ? '' : ` to ${monthYear(p.last)}`}</span>
                      {p.kw_above != null && <span className="meta">Average <span className="num">+{p.kw_above}</span> kW above {ar.threshold} · peak <span className="num">{p.peak_kw}</span> kW</span>}
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
                      <span className="muted small num">{p.kwh_above > 0 ? `${kwh(p.kwh_above)} kWh above ${ar.threshold}` : 'kWh known when the alert ends'}</span>
                    </div>
                    <div className="qa-alert-foot">
                      <button type="button" className="btn small" aria-expanded={isOpen} onClick={() => toggle(p)}>
                        {isOpen ? 'Hide alerts' : `Show alerts (${p.alerts})`}
                      </button>
                      <button type="button" className="btn small" onClick={() => setDraft({ issue: p, action: actionsFor(p)[0], custom: '', note: '' })}>Create ticket</button>
                    </div>
                    {isOpen && (
                      <ul className="qa-events">
                        {shown.map((a) => {
                          const running = a.end >= now
                          return (
                            <li key={a.id}>
                              <button type="button" className={`qa-event${running ? ' active' : ''}${a.id === selectedId ? ' sel' : ''}`} onClick={() => show(a)}
                                      aria-pressed={a.id === selectedId} title={running ? 'Show this running alert' : 'Replay this alert: the time moves back to it'}>
                                {running
                                  ? <><span>Running now, since {sinceText(a.start, now)}</span><span className="num">an alert since {sinceText(knownAt(a), now)}</span></>
                                  : <><span>{when(a)}</span><span className="num">+{a.kw_above} kW · {a.minutes_above} min</span></>}
                              </button>
                            </li>
                          )
                        })}
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
              <div key={t.id} id={`qa-p-${t.issue.id}`} className={`qa-alert ticket${t.issue.id === pickedKey ? ' sel' : ''}`}>
                <div className="qa-alert-main static">
                  <span className="qa-alert-top"><span>{t.id} · {where(t.issue)}</span><span className="small">{t.status}</span></span>
                  <span className="meta">{t.action}</span>
                  {t.note && <span className="meta qa-note">Note: {t.note}</span>}
                  <span className="meta">{t.issue.alerts} alert{t.issue.alerts === 1 ? '' : 's'}{t.issue.usual_pattern ? ` · ${usual(t.issue).toLowerCase()}` : ''}</span>
                  {covered.has(t.issue.id) && <span className="meta qa-running"><span className="qa-dot red" aria-hidden="true" />Alert running now</span>}
                </div>
                {t.status === 'Open' && (
                  <div className="qa-alert-foot">
                    <button type="button" className="btn small qa-primary" onClick={() => update(t.id, { status: 'Visited', visitDay: date })}>Mark visited (checked on site)</button>
                  </div>
                )}
                {t.status !== 'Open' && (() => {
                  // The comparison point: the day a change went in if one was recorded, else the visit day.
                  const visit = t.visitDay ?? t.changeDay ?? (t.created ? day(t.created) : date)
                  const anchor = t.changeDay ?? visit
                  const label = t.changeDay ? 'Change' : 'Visit'
                  const c = checkFix(energy, t.issue, anchor, now, alertsOf(t.issue))
                  const v = FIX_VERDICT[c.verdict]
                  return (
                    <div className="qa-verify">
                      <div className="qa-nba-head"><span className="qa-label">Did it work?</span>
                        <span className="muted small">visited {dayMonth(visit)} {visit.slice(0, 4)}{t.changeDay ? ` · change ${dayMonth(t.changeDay)}` : ''}</span></div>
                      <span className="muted small">Average after-hours power on {SEG_TEXT[c.seg]}, this problem's usual time, holidays left out.</span>
                      {energy ? <WeekChart check={c} anchorLabel={label} /> : <span className="muted small">Loading power data…</span>}
                      <div className="qa-verify-grid">
                        <div><span className="muted small">4 weeks before</span><b className="num">{c.base != null ? `${c.base.toFixed(1)} kW` : '–'}</b>
                          <span className="muted small num">{c.alertsBefore} alert{c.alertsBefore === 1 ? '' : 's'}</span></div>
                        <div><span className="muted small">After{c.nAfter ? ` (${c.nAfter} day${c.nAfter === 1 ? '' : 's'} so far)` : ''}</span><b className="num">{c.after != null && c.nAfter ? `${c.after.toFixed(1)} kW` : '–'}</b>
                          <span className="muted small num">{c.nAfter ? `${c.alertsAfter} alert${c.alertsAfter === 1 ? '' : 's'}` : 'from ' + dayMonth(c.aFrom ?? anchor)}</span></div>
                      </div>
                      <div className={`chip ${v.cls}`} style={{ whiteSpace: 'normal' }}>{v.text(c.change)}</div>
                      <span className="muted small">Alert counts are extra information only: the alert limit is reset from the last 8 weeks, so alerts can fade without a fix.</span>
                      {t.status === 'Visited' && (
                        <div className="qa-alert-foot qa-change" style={{ padding: 0 }}>
                          <label className="field">
                            <span className="qa-label">Change made later? (optional)</span>
                            <input type="date" value={t.changeDraft ?? visit} min={visit} max={date}
                                   onChange={(e) => e.target.value && update(t.id, { changeDraft: e.target.value })} />
                          </label>
                          <button type="button" className="btn small" onClick={() => update(t.id, { changeDay: t.changeDraft ?? visit, status: 'Change made' })}>Compare from this date</button>
                        </div>
                      )}
                      {t.status !== 'Closed' ? (
                        <div className="row">
                          <button type="button" className="btn small qa-primary" onClick={() => update(t.id, { status: 'Closed' })}>Close ticket</button>
                          <button type="button" className="btn small" onClick={() => update(t.id, { status: 'Open', visitDay: undefined, changeDay: undefined, changeDraft: undefined })}>Reopen</button>
                        </div>
                      ) : <span className="muted small">Closed.</span>}
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

        <h3>A live view of the building</h3>
        <p>
          The panel follows the date and time at the top of the page, as if you were watching the building at that minute.
          It only shows what was known by then: an alert appears from the minute it qualified, and problems, priorities and
          totals are counted from the alerts so far. Move the time forward, or press play, to see more.
        </p>
        <p>
          A card marked <b>Alert running now</b> has an alert happening at this minute and is listed first in its tab.
          The building shows every load above its limit at this minute, and tags the ones that are already alerts with <b>Alert</b>:
          many never become alerts because they are too short or too small. Floors with high priority problems so far
          carry a "recurring" badge.
        </p>
        <p>
          Click a load in a floor's problem list on the building to find it here: its problem card is highlighted, or the panel says
          why it is not an alert yet and what it still needs. Clicking an alert here shows it on the chart. Clicking an older alert
          replays it: the time moves back to it, and <b>Back to</b> returns you.
        </p>

        <h3>What an alert means</h3>
        <p>
          Each zone's AC, lighting and plug load has its own <b>normal upper limit</b> for every hour of the week, worked out from the
          last 8 weeks of readings at that hour and weekday.{' '}
          {ar.id === 'sd'
            ? <>The limit is the usual level plus 3 times its usual spread, and always at least 0.5 kW above the usual level (shown as "median + 3 SD").</>
            : <>It is the level that zone stays under 99% of the time (shown as "P99").</>}
          Something becomes an alert as soon as, outside office hours, it has been:
        </p>
        <ul>
          <li>above the limit for at least {ar.red_min} minutes in a row at some point (red on the building),</li>
          <li>above it for at least {r.min_minutes_above} minutes in total, and</li>
          <li>on average at least {r.min_kw_above} kW above it, so tiny loads are left out.</li>
        </ul>
        <p>
          Short dips of {r.gap_minutes} minutes or less are joined, so equipment switching on and off through one evening counts as one alert.
          Office hours are weekdays 08:00 to 17:00. Public holidays are not checked.
        </p>

        <h3>Problems, not single alerts</h3>
        <p>
          Each card is one <b>problem</b>: every alert so far for one floor, zone and load, such as "F1 Z2 · AC". You fix a problem once,
          so tickets are made per problem. The card shows when it usually happens, how many months it appeared in, and how much
          energy went above the normal limit (kWh above {ar.threshold}) in alerts that have ended. Click the card to open its floor on the
          building with the zone highlighted; the time moves to its latest alert if that has ended. Or click <b>Show alerts</b>
          and pick one to see it on the chart.
        </p>

        <h3>Which tab to start with</h3>
        <dl>
          <dt><span className="chip qa-pri high">High</span> Recurring</dt>
          <dd>Has come back in at least half of the months so far, and in 3 or more. Most likely a setting or habit, and usually where the
            biggest savings are. Start here.</dd>
          <dt><span className="chip qa-pri medium">Medium</span> Intermittent</dt>
          <dd>Has come back in 2 or more months, but not most of them. Look for what triggers it, such as certain days or events.</dd>
          <dt><span className="chip qa-pri low">Low</span> Occasional</dt>
          <dd>Seen in one month so far. Often a one-off, such as an event or late work. Check before acting.</dd>
        </dl>
        <p>Priorities can rise as time passes: a problem seen again next month moves up. Within each tab, problems are ranked by energy
          above the normal limit, biggest first. Use the floor and load filters to narrow the list.</p>

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
          <li><b>Mark visited</b> when someone has checked on site. The date on show is saved as the visit.</li>
          <li><b>Did it work?</b> compares the zone's average after-hours power at its usual time (for example weeknights) in the
            4 weeks before the visit with the weeks after, skipping the first week while the change settles. A drop of 20% or more
            counts as working. Move the time forward to see the weeks after. If the fix went in later, enter that date instead.</li>
          <li>It uses power, not alert counts, because the alert limit is reset from the last 8 weeks: a load that stays high
            stops raising alerts on its own. Season and holidays still affect power, so treat it as a first check, not proof.</li>
          <li><b>Close ticket</b> if it worked, or <b>Reopen</b> to send it back to Open and check again. Tickets are kept in this browser.</li>
        </ol>
      </details>

      <div className="muted small qa-demo">
        Demo: historical CU-BEMS data, {day(meta.period[0])} to {day(meta.period[1])}{partial ? `, Floor${meta.floors_in_data.length > 1 ? 's' : ''} ${meta.floors_in_data.join(', ')} only` : ''}.
        Tickets are saved in this browser only, so other people will not see them. No change was really made, so "Did it work?" shows how the check works, not a real result.
      </div>
    </section>
  )
}
