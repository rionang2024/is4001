// "Did it work?" for a ticket: after-hours power of the problem's zone and load, before vs after the visit (or the change).
// Energy, not alert counts: P99 is re-set from the last 56 days, so a load that stays high stops raising alerts
// without any fix, and a fixed load can raise new small ones. Alerts are shown too, but only as extra information.
// Data: public/data/qa_energy.json (Qn_A/scripts/build_alerts.py): daily average kW per zone load for each part of the
// after-hours schedule, holidays left out. Only days before the replay clock are used.
import { addDays, dayMonth } from '../data.js'

export const WINDOW_DAYS = 28  // baseline: the 4 weeks before; result: 4 weeks after
export const SETTLE_DAYS = 7   // the week from the visit is skipped while the change settles in
export const MIN_DAYS = 3      // days with data needed on each side before giving a verdict
export const THRESHOLD = 0.2   // a 20% drop or rise counts as a change (team's choice)
const SEG = { Weeknight: 'ev', 'Early morning': 'em', Weekend: 'we' }
export const SEG_TEXT = { ev: 'weeknights (17:00 to midnight)', em: 'weekday early mornings (before 08:00)', we: 'weekends' }

const dayIndex = (start, d) => Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10))) / 864e5)
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

// Daily values for [from, to] inclusive, only days strictly before `today`.
function values(energy, rec, seg, from, to, today) {
  const out = []
  for (let d = from; d <= to && d < today; d = addDays(d, 1)) {
    const i = dayIndex(energy.start, d)
    const v = i >= 0 && i < energy.days ? rec[seg][i] : null
    if (v != null) out.push(v)
  }
  return out
}

export function checkFix(energy, issue, anchor, now, alerts) {
  const seg = SEG[issue.usual_pattern] ?? 'ev'
  const rec = energy?.channels?.[issue.id]
  const today = now.slice(0, 10)
  const bFrom = addDays(anchor, -WINDOW_DAYS), bTo = addDays(anchor, -1)
  const aFrom = addDays(anchor, SETTLE_DAYS), aTo = addDays(anchor, SETTLE_DAYS + WINDOW_DAYS - 1)
  const inWin = (a, f, t) => a.start.slice(0, 10) >= f && a.start.slice(0, 10) <= t && a.start < now
  const alertsBefore = alerts.filter((a) => inWin(a, bFrom, bTo)).length
  const alertsAfter = alerts.filter((a) => inWin(a, aFrom, aTo)).length
  if (!rec) return { seg, verdict: 'nodata', alertsBefore, alertsAfter, weeks: [] }
  const before = values(energy, rec, seg, bFrom, bTo, today)
  const after = values(energy, rec, seg, aFrom, aTo, today)
  const base = mean(before), aft = mean(after)
  let verdict = 'wait', change = null
  if (before.length < MIN_DAYS) verdict = 'nobase'
  else if (after.length >= MIN_DAYS) {
    change = base > 0 ? (aft - base) / base : null
    verdict = change == null ? 'nochange' : change <= -THRESHOLD ? 'better' : change >= THRESHOLD ? 'worse' : 'nochange'
  }
  // one bar per week, from 4 weeks before to 5 weeks after (week 0 = the settling week)
  const weeks = []
  for (let k = -4; k <= 4; k++) {
    const f = addDays(anchor, 7 * k), t = addDays(f, 6)
    weeks.push({ k, from: f, v: mean(values(energy, rec, seg, f, t, today)), settle: k === 0 })
  }
  return { seg, base, after: aft, change, verdict, nBefore: before.length, nAfter: after.length, alertsBefore, alertsAfter, weeks, aFrom, aTo }
}

export const FIX_VERDICT = {
  better: { cls: 'good', text: (c) => `After-hours power down ${Math.round(-c * 100)}% against the 4 weeks before. The fix looks like it worked.` },
  nochange: { cls: 'plain', text: (c) => `After-hours power ${c == null ? 'about the same' : `${c < 0 ? 'down' : 'up'} ${Math.abs(Math.round(c * 100))}%`}, within ${THRESHOLD * 100}% of before: no clear change. Check the fix, or reopen.` },
  worse: { cls: 'bad', text: (c) => `After-hours power up ${Math.round(c * 100)}% against before. Reopen and check what changed.` },
  wait: { cls: 'plain', text: () => `Not enough days after the visit yet. The check starts ${SETTLE_DAYS} days after it: move the time forward.` },
  nobase: { cls: 'plain', text: () => 'Too few days with data in the 4 weeks before to set a baseline.' },
  nodata: { cls: 'plain', text: () => 'No after-hours power data for this zone and load.' },
}

// Weekly bars of average after-hours kW, a dashed baseline line and a marker at the visit (or change).
export function WeekChart({ check, anchorLabel }) {
  const W = 300, H = 128, left = 30, right = 8, top = 14, bottom = 26
  const vals = check.weeks.map((w) => w.v).filter((v) => v != null)
  if (!vals.length) return null
  const max = Math.max(...vals, check.base ?? 0) * 1.15 || 1
  const n = check.weeks.length, slot = (W - left - right) / n, bw = slot * 0.62
  const y = (v) => top + (H - top - bottom) * (1 - v / max)
  const x0 = left + slot * 4 // the anchor is at the start of week 0
  const tone = check.verdict === 'better' ? 'var(--good)' : check.verdict === 'worse' ? 'var(--st-red)' : 'var(--ink-2)'
  return (
    <svg className="qa-fix-chart" viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label={`Average after-hours kW per week, 4 weeks before and after the ${anchorLabel.toLowerCase()}`}>
      <text x={left} y={9} className="qa-fix-axis">avg kW</text>
      <text x={4} y={y(max / 1.15) + 3} className="qa-fix-axis">{Math.round(max / 1.15)}</text>
      <line x1={left} x2={W - right} y1={H - bottom} y2={H - bottom} stroke="var(--line)" />
      <rect x={x0} y={top} width={slot} height={H - top - bottom} fill="var(--line-2)" />
      {check.weeks.map((w, i) => w.v == null ? null : (
        <rect key={w.k} x={left + slot * i + (slot - bw) / 2} y={y(w.v)} width={bw} height={H - bottom - y(w.v)} rx="2"
              fill={w.k < 0 ? 'var(--ink-3)' : w.settle ? 'var(--line)' : tone} opacity={w.settle ? 0.9 : 1}>
          <title>{`Week of ${dayMonth(w.from)}: ${w.v.toFixed(1)} kW${w.settle ? ' (settling week, not counted)' : ''}`}</title>
        </rect>
      ))}
      {check.base != null && (
        <>
          <line x1={left} x2={W - right} y1={y(check.base)} y2={y(check.base)} stroke="var(--ink)" strokeDasharray="4 3" />
          <text x={W - right} y={y(check.base) - 4} textAnchor="end" className="qa-fix-axis">baseline {check.base.toFixed(1)} kW</text>
        </>
      )}
      <line x1={x0} x2={x0} y1={top - 4} y2={H - bottom + 4} stroke="var(--accent)" strokeWidth="2" />
      <text x={x0} y={H - 8} textAnchor="middle" className="qa-fix-axis strong">{anchorLabel}</text>
      <text x={left} y={H - 8} className="qa-fix-axis">4 wk before</text>
      <text x={W - right} y={H - 8} textAnchor="end" className="qa-fix-axis">after</text>
    </svg>
  )
}
