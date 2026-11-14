// What a minute snapshot says is wrong, per floor and per zone/load, and how long it has been wrong.
// Pure helpers plus one hook. Nothing here fetches minute data: it reads the same snapshot rows the explorer already has.
// Alert details (start, end, peak) are borrowed from the alerts sidebar's file for the rule on show (alertRule.js).
import { useEffect, useState } from 'react'
import { loadJSON } from '../data.js'
import { LOADS, LOAD_NAME, kw, reasonText } from '../qnaApi.js'
import { num, planOf } from './explorerModel.js'
import { alertFile, useAlertRule } from './alertRule.js'

const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD HH:MM' (the explorer's `when`) or 'YYYY-MM-DDTHH:MM' -> 'YYYY-MM-DDTHH:MM'
export const toStamp = (when) => when.replace(' ', 'T').slice(0, 16)

// Bangkok local clock arithmetic: no timezone, so it is done on a UTC date that is only ever read back as UTC.
export function minusMinutes(stamp, m) {
  const [d, t] = stamp.split('T')
  const [y, mo, da] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const dt = new Date(Date.UTC(y, mo - 1, da, h, mi - m))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`
}
const clockOf = (stamp, ref) => (stamp.slice(0, 10) === ref.slice(0, 10) ? stamp.slice(11, 16) : `${stamp.slice(11, 16)} on ${stamp.slice(8, 10)}/${stamp.slice(5, 7)}`)

// ---------- one zone and load that is amber or red at the selected minute
// The data's exceedance_duration_minutes is the run of consecutive minutes above P99 up to this one, so:
//   above threshold since = T - (duration - 1),  red since = T - (duration - redMin)   (red starts at the redMin-th minute: 5 for P99, 15 for the sd rule)
export function problemsOnFloor(idx, floor, on, when) {
  const T = toStamp(when)
  const out = []
  for (const z of Object.keys(planOf(floor).zones)) {
    for (const e of LOADS) {
      if (!on[e]) continue
      const r = idx.get(`${floor}|${z}|${e}`)
      if (!r || (r.status !== 'red' && r.status !== 'amber')) continue
      const dur = num(r.exceedance_duration_minutes) && r.exceedance_duration_minutes > 0 ? r.exceedance_duration_minutes : null
      out.push({
        floor, zone: Number(z), e, status: r.status,
        power: r.power_kw, threshold: r.upper_threshold_kw, median: r.reference_median_kw, reason: r.status_reason,
        over: num(r.power_kw) && num(r.upper_threshold_kw) ? r.power_kw - r.upper_threshold_kw : null,
        dur,
        aboveSince: dur ? minusMinutes(T, dur - 1) : null,
        redSince: r.status === 'red' && dur ? minusMinutes(T, dur - (r.red_min ?? 5)) : null,
        at: T,
        alert: null,
      })
    }
  }
  // red before amber, then the biggest excess first
  return out.sort((a, b) => (a.status === b.status ? (b.over ?? 0) - (a.over ?? 0) : a.status === 'red' ? -1 : 1))
}

// The sidebar alert (if any) that covers this problem's minute.
// An alert counts from the minute it qualified (passed all three sidebar filters), so the replay never shows it early.
export const findAlert = (alerts, p) =>
  alerts.find((a) => a.floor === p.floor && a.zone === p.zone && a.end_use === p.e && (a.qualified_at ?? a.start) <= p.at && p.at <= a.end) ?? null

// ---------- wording (red means investigate, not a confirmed fault)
export const placeText = (p) => `Floor ${p.floor} · Zone ${p.zone} · ${LOAD_NAME[p.e]}`
export const sinceText = (p) => {
  if (p.status === 'red') return p.redSince ? `red since ${clockOf(p.redSince, p.at)}` : 'red'
  return p.aboveSince ? `amber since ${clockOf(p.aboveSince, p.at)}` : 'amber'
}
export const metricText = (p) => `${LOAD_NAME[p.e]} ${kw(p.power)} kW vs ${kw(p.threshold)} kW threshold`
export const breachText = (p) => [metricText(p), p.dur ? `${p.dur} min above threshold` : null, reasonText(p.reason)].filter(Boolean).join(' · ')
// `at` = the minute on show. While the alert is still running, its end and peak are later minutes, so they are left out.
export const alertText = (a, at) => {
  if (!a) return ''
  if (at && at < a.end) return `Part of an alert running since ${clockOf(a.start, at)}, an alert from ${clockOf(a.qualified_at ?? a.start, at)}`
  const next = a.start.slice(0, 10) === a.end.slice(0, 10) ? '' : ' next day'
  return `Part of a longer alert, ${a.start.slice(11, 16)} to ${a.end.slice(11, 16)}${next}, peak ${kw(a.peak_kw)} kW at ${a.peak_at.slice(11, 16)}`
}

// ---------- one floor
// state: 'red' | 'amber' | 'grey' | 'neutral' | 'ok' | 'none'
//   red / amber   the floor has a problem at this minute and glows
//   grey / neutral every counted reading is unchecked (missing, too little history, excluded, or outside the schedule): muted, never "normal"
//   ok            checked, nothing above P99 (no glow)
//   none          nothing counted (all loads off, or no data)
export function floorAnomaly(idx, floor, on, when, alerts = []) {
  const problems = problemsOnFloor(idx, floor, on, when)
  problems.forEach((p) => { p.alert = findAlert(alerts, p) })
  const n = { green: 0, grey: 0, neutral: 0 }
  const greyReasons = {}
  for (const z of Object.keys(planOf(floor).zones)) {
    for (const e of LOADS) {
      const r = on[e] ? idx.get(`${floor}|${z}|${e}`) : null
      if (!r) continue
      if (r.status === 'green') n.green++
      else if (r.status === 'neutral') n.neutral++
      else if (r.status !== 'red' && r.status !== 'amber') { n.grey++; greyReasons[r.status_reason] = (greyReasons[r.status_reason] ?? 0) + 1 }
    }
  }
  const has = problems.length + n.green + n.grey + n.neutral > 0
  let state = 'none'
  if (problems.length) state = problems[0].status
  else if (has && n.green === 0) state = n.grey ? 'grey' : 'neutral'
  else if (has) state = 'ok'

  const topReason = Object.entries(greyReasons).sort((a, b) => b[1] - a[1])[0]?.[0]
  let summary
  if (problems.length) {
    const top = problems[0]
    summary = [
      `${placeText(top)} · ${sinceText(top)}`,
      breachText(top),
      alertText(top.alert, top.at),
      problems.length > 1 ? `+ ${problems.length - 1} more on Floor ${floor}` : '',
    ].filter(Boolean).join('\n')
  } else if (state === 'grey') {
    summary = `Floor ${floor} · not confirmed normal: a reading is missing, has too little history for a threshold, or was excluded.${topReason ? ` ${reasonText(topReason)}.` : ''}`
  } else if (state === 'neutral') {
    summary = `Floor ${floor} · outside the after-hours alert schedule, so it was not checked. This is not a pass.`
  } else if (state === 'ok') {
    summary = `Floor ${floor} · no reading above its alert threshold${n.grey + n.neutral ? `; ${n.grey + n.neutral} not assessed (no data)` : ''}`
  } else {
    summary = ''
  }
  return { state, problems, summary, counts: n }
}

// ---------- alerts file (shared with the sidebar through loadJSON's cache)
const NONE = []
export function useAlerts() {
  const rule = useAlertRule() // the alert file for the rule on show, so the tags match the colours
  const [alerts, setAlerts] = useState(NONE)
  useEffect(() => {
    let live = true
    setAlerts(NONE)
    loadJSON(alertFile(rule)).then((d) => { if (live) setAlerts(d.alerts ?? NONE) }).catch(() => {})
    return () => { live = false }
  }, [rule])
  return alerts
}
