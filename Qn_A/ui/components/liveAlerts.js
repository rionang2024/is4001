// What the alerts sidebar knows at the minute on the replay clock: nothing after it.
// - An alert shows from its qualified_at minute (when it first passed all three filters), never earlier.
// - Problems (one per floor, zone and load), their priority, usual pattern and next best action are rebuilt
//   from the alerts known by then, with the same rules as Qn_A/scripts/build_alerts.py (sent in meta).
// - "Watching" = loads that are amber or red right now but have not become an alert yet, with how close they are.
// Times are 'YYYY-MM-DDTHH:MM' strings (Bangkok local time), so plain string comparison orders them.
import { useEffect, useState } from 'react'
import { apiGet, LOADS } from '../qnaApi.js'

export const keyOf = (x) => `F${x.floor}-Z${x.zone}-${x.end_use ?? x.e}`
const RANK = { High: 0, Medium: 1, Low: 2 }
const PRIORITY = { Recurring: 'High', Intermittent: 'Medium', Occasional: 'Low' }

const minutesOf = (ts) => Number(ts.slice(11, 13)) * 60 + Number(ts.slice(14, 16))
const weekday = (ts) => new Date(Date.UTC(+ts.slice(0, 4), +ts.slice(5, 7) - 1, +ts.slice(8, 10))).getUTCDay() // 0 = Sun
export const patternOf = (ts) => (weekday(ts) === 0 || weekday(ts) === 6 ? 'Weekend' : minutesOf(ts) < 480 ? 'Early morning' : 'Weeknight')
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const clock = (mins) => {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
export const knownAt = (a) => a.qualified_at ?? a.start

// Same wording as build_alerts.py's next_action(), read from the rules the script writes into meta.
function nextAction(actions, endUse, usual, recurrence, start, end) {
  if (!actions) return null
  let pick = recurrence === 'Occasional' ? actions.occasional
    : actions.rules.find((r) => r.end_use === endUse && r.pattern === usual) ?? actions.fallback
  return {
    lever: pick.lever,
    text: pick.text.replace('{start}', start).replace('{end}', end),
    first_check: actions.first_check[endUse] ?? 'Verify meter mapping on site',
  }
}

// Every problem as it stood at `now`. Active alerts (started, not yet over) count towards the alert total but not the
// energy totals, because their end, peak and kWh are not known yet.
export function problemsAt(data, now) {
  const { alerts, issues = [], meta } = data
  const rule = meta.rule
  const checked = new Map(issues.map((p) => [p.id, p]))
  const nowMonth = now.slice(0, 7)
  const groups = new Map()
  for (const a of alerts) {
    if (knownAt(a) > now) continue
    const k = keyOf(a)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(a)
  }
  const out = []
  for (const [id, g] of groups) {
    const first = g[0]
    const ended = g.filter((a) => a.end < now)
    const active = g.filter((a) => a.end >= now)
    const months = new Set(g.map((a) => a.start.slice(0, 7))).size
    const issue = checked.get(id)
    const assessed = issue?.months_checked ? Math.max(months, issue.months_checked.filter((m) => m <= nowMonth).length) : (issue?.months_assessed ?? months)
    let recurrence = 'Occasional'
    if (months >= 2) recurrence = 'Intermittent'
    if (months >= rule.recurring_min_months && months / assessed >= rule.recurring_share) recurrence = 'Recurring'

    const byPattern = {}
    g.forEach((a) => { const p = patternOf(a.start); byPattern[p] = (byPattern[p] ?? 0) + 1 })
    const usual = Object.entries(byPattern).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0][0]
    const u = g.filter((a) => patternOf(a.start) === usual)
    // an alert still running has no end yet: its usual window uses the finished ones, or the start alone
    const uEnded = u.filter((a) => a.end < now)
    const startMed = median(u.map((a) => minutesOf(a.start)))
    const endMed = uEnded.length
      ? median(uEnded.map((a) => minutesOf(a.end) + (a.end.slice(0, 10) === a.start.slice(0, 10) ? 0 : 1440)))
      : null
    const usualStart = clock(startMed)
    const usualEnd = endMed == null ? null : clock(endMed)
    const nextDay = endMed != null && endMed >= 1440
    const sum = (xs, f) => xs.reduce((n, a) => n + f(a), 0)
    out.push({
      id, floor: first.floor, zone: first.zone, end_use: first.end_use,
      recurrence, priority: PRIORITY[recurrence],
      months_with_alerts: months, months_assessed: assessed,
      alerts: g.length, active: active.length,
      usual_pattern: usual, usual_count: u.length, usual_start: usualStart, usual_end: usualEnd, usual_end_next_day: nextDay,
      kw_above: ended.length ? Math.round(sum(ended, (a) => a.kw_above) / ended.length * 10) / 10 : null,
      kwh_above: Math.round(sum(ended, (a) => a.kwh_above) * 10) / 10,
      peak_kw: ended.length ? Math.max(...ended.map((a) => a.peak_kw)) : null,
      first: g.reduce((m, a) => (a.start < m ? a.start : m), first.start),
      last: g.reduce((m, a) => (a.start > m ? a.start : m), first.start),
      next_action: nextAction(meta.actions, first.end_use, usual, recurrence, usualStart,
        usualEnd ? usualEnd + (nextDay ? ' next day' : '') : 'later'),
    })
  }
  out.sort((x, y) => RANK[x.priority] - RANK[y.priority] || y.kwh_above - x.kwh_above || y.alerts - x.alerts)
  const visible = alerts.filter((a) => knownAt(a) <= now)
  return { problems: out, visible, active: visible.filter((a) => a.start <= now && now <= a.end) }
}

// ---------- watching: amber or red now, not an alert (yet)
// The event so far is walked back from `now` the way the script joins it: flagged minutes no more than
// gap_minutes apart. Its numbers are then checked against the same three filters.
export function progressOf(rows, now, rule) {
  const flagged = rows
    .filter((r) => (r.status === 'amber' || r.status === 'red') && r.power_kw != null && r.upper_threshold_kw != null)
    .map((r) => ({ t: r.timestamp.replace(' ', 'T').slice(0, 16), over: r.power_kw - r.upper_threshold_kw, red: r.status === 'red' }))
    .filter((r) => r.t <= now)
  if (!flagged.length) return null
  const ms = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16))
  const run = [flagged.at(-1)]
  for (let i = flagged.length - 2; i >= 0; i--) {
    if ((ms(run[0].t) - ms(flagged[i].t)) / 60000 > rule.gap_minutes + 1) break
    run.unshift(flagged[i])
  }
  if ((ms(now) - ms(run.at(-1).t)) / 60000 > rule.gap_minutes + 1) return null
  const minutes = run.length
  const avgOver = run.reduce((n, r) => n + r.over, 0) / minutes
  const firstRow = rows[0]?.timestamp?.replace(' ', 'T').slice(0, 16)
  return {
    since: run[0].t, minutes, avgOver, red: run.some((r) => r.red),
    // the window fetched may start inside the event; then "since" is a lower bound
    cut: firstRow != null && run[0].t <= firstRow,
    needs: {
      minutes: minutes < rule.min_minutes_above,
      kw: avgOver < rule.min_kw_above,
      red: !run.some((r) => r.red),
    },
  }
}

const WATCH_WINDOW = 360 // minutes of history fetched per watched load
const WATCH_MAX = 12     // loads followed at once, red first
const pad = (n) => String(n).padStart(2, '0')

// Fetches a short series for each load that is amber or red at `now` and not covered by an active alert.
// `extra` adds one more load (the one clicked on the building), whatever its colour; `onlyExtra` follows that load alone.
export function useWatching(snapshotRows, now, rule, coveredKeys, extra, paused, onlyExtra = false) {
  const [state, setState] = useState({ at: null, items: [] })
  const candidates = (onlyExtra ? [] : snapshotRows ?? [])
    .filter((r) => LOADS.includes(r.end_use) && (r.status === 'amber' || r.status === 'red') && !coveredKeys.has(keyOf(r)))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'red' ? -1 : 1))
    .slice(0, WATCH_MAX)
  if (extra && !candidates.some((r) => keyOf(r) === keyOf(extra))) {
    const row = (snapshotRows ?? []).find((r) => keyOf(r) === keyOf(extra))
    candidates.push(row ?? { floor: extra.floor, zone: extra.zone, end_use: extra.end_use, status: null })
  }
  const sig = `${now}|${candidates.map(keyOf).join(',')}|${paused ? 'p' : ''}`

  useEffect(() => {
    if (paused || !rule) return undefined
    if (!candidates.length) { setState({ at: now, items: [] }); return undefined }
    const ctrl = new AbortController()
    const nowMin = minutesOf(now)
    const from = Math.max(0, nowMin - WATCH_WINDOW)
    const timer = setTimeout(() => {
      Promise.all(candidates.map((r) =>
        apiGet('series', {
          floor: r.floor, zone: r.zone, end_use: r.end_use, date: now.slice(0, 10),
          start: `${pad(Math.floor(from / 60))}:${pad(from % 60)}`, end: now.slice(11, 16),
        }, ctrl.signal)
          .then((s) => ({ ...r, key: keyOf(r), progress: progressOf(s.rows ?? [], now, rule) }))
          .catch((e) => (e.name === 'AbortError' ? null : { ...r, key: keyOf(r), progress: null, error: true }))))
        .then((items) => setState({ at: now, items: items.filter(Boolean) }))
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, rule])

  return state.at === now ? state.items : null
}
