import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { fmt, hh, hhmm, shortZone, dow, dayMonth } from '../data.js'

const STAGGER_MIN = 5     // minimum gap between zones that would otherwise switch on together
const LEAD_MIN = 30       // a crowded start hour is spread over at least this many minutes before it
const HOT_EXTRA_MIN = 15  // extra pre-cooling lead on hot days

// Proposal only: turns the day-ahead forecast into a staggered start-up list.
function buildPlan(rows, hotDay) {
  const bySlot = new Map()
  rows.filter((r) => r.start_hour != null).forEach((r) => {
    if (!bySlot.has(r.start_hour)) bySlot.set(r.start_hour, [])
    bySlot.get(r.start_hour).push(r)
  })
  const plan = []
  for (const [slot, group] of [...bySlot].sort((a, b) => a[0] - b[0])) {
    group.sort((a, b) => b.forecast_peak - a.forecast_peak)   // biggest load starts first
    // Spread the group so the last zone still starts on time: window = max(LEAD, (n-1) x STAGGER).
    const window = Math.max(LEAD_MIN, (group.length - 1) * STAGGER_MIN)
    const step = group.length > 1 ? window / (group.length - 1) : 0
    group.forEach((r, i) => {
      const crowded = group.length > 1
      let start = slot * 60 - (crowded ? window : 0) + Math.round(i * step)
      if (hotDay) start -= HOT_EXTRA_MIN
      const why = [
        crowded ? `${group.length} zones forecast to start at ${hh(slot)}` : null,
        hotDay ? 'hot day: earlier pre-cool' : null,
      ].filter(Boolean).join(' · ') || 'no clash'
      plan.push({ ...r, slot, suggested: start, crowded, why })
    })
  }
  return plan
}

export default function StartupPlan({ daily, building, date, onPickZone, rule }) {
  const hotThreshold = useMemo(() => {
    const temps = [...new Set(daily.map((d) => `${d.date}|${d.temp_avg}`))].map((s) => +s.split('|')[1]).sort((a, b) => a - b)
    return temps[Math.floor(temps.length * 0.75)]
  }, [daily])

  const rows = daily.filter((d) => d.date === date)
  const hotDay = rows[0]?.temp_avg >= hotThreshold
  const plan = buildPlan(rows, hotDay)

  const profile = building.t.map((t, i) => ({ t, h: +t.slice(11, 13), forecast: building.forecast[i], zones: building.zones[i] }))
    .filter((r) => r.t.startsWith(date))
  const peak = profile.reduce((a, b) => (b.forecast > (a?.forecast ?? -1) ? b : a), null)
  const atPeak = rows.filter((r) => peak && r.forecast_peak_hour === peak.h && r.forecast_peak >= 2).length
  const busiestSlot = Math.max(0, ...[...new Set(plan.map((p) => p.slot))].map((s) => plan.filter((p) => p.slot === s).length))

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Start-up &amp; pre-cooling plan · {dow(date)} {dayMonth(date)}</h2>
        <span className="sub">All zones, from the day-ahead forecast. A proposal for the FM to review.</span>
      </div>

      {plan.length === 0 ? (
        <div className="note">No zone is forecast to run AC on this day (weekend, holiday or AC off), so there is nothing to schedule.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 16 }}>
          <div>
            <div className="kpis" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: 12 }}>
              <div className="kpi"><div className="label">Building forecast peak</div>
                <div className="value">{fmt(peak?.forecast, 0)}<small>kW</small></div>
                <div className="foot">at {hh(peak?.h ?? 0)} · {atPeak} zone(s) peak in that hour</div></div>
              <div className="kpi"><div className="label">Zones starting together</div>
                <div className="value">{busiestSlot}</div>
                <div className="foot">largest group in one start hour</div></div>
            </div>
            <div style={{ height: 150 }}>
              <ResponsiveContainer>
                <BarChart data={profile} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                  <XAxis dataKey="h" tick={{ fontSize: 10, fill: 'var(--ink-3)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval={2} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [`${fmt(v)} kW`, 'Building forecast']} labelFormatter={(h) => hh(h)} />
                  <Bar dataKey="forecast" isAnimationActive={false}>
                    {profile.map((p) => <Cell key={p.h} fill={p.h === peak?.h ? 'var(--bad)' : 'var(--forecast)'} fillOpacity={p.h === peak?.h ? 0.9 : 0.55} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              Building total = sum of the 23 zones' forecasts.{hotDay && ` Hot day: daily mean ≥ ${fmt(hotThreshold)} °C (top quarter of the period).`}
            </p>
          </div>

          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table>
              <thead><tr>
                <th>Zone</th><th className="r">Forecast on</th><th className="r">Peak</th>
                <th className="r">Suggested start</th><th>Why</th>
              </tr></thead>
              <tbody>
                {plan.map((p) => (
                  <tr key={p.zone} className="click" onClick={() => onPickZone(p.zone)}>
                    <td>{shortZone(p.zone)}</td>
                    <td className="r num">{hh(p.slot)}</td>
                    <td className="r num">{fmt(p.forecast_peak)} kW <span className="muted">@{String(p.forecast_peak_hour).padStart(2, '0')}</span></td>
                    <td className="r num"><b>{hhmm(p.suggested)}</b></td>
                    <td className="small">{p.crowded ? <span className="chip warn">stagger</span> : <span className="chip plain">ok</span>} <span className="muted">{p.why}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="muted small" style={{ margin: '10px 0 0' }}>
        Rule: {rule} Zones sharing a start hour are spread over the {LEAD_MIN}+ min before it (at least {STAGGER_MIN} min apart), biggest load first, so the last one still starts on time;
        hot days start a further {HOT_EXTRA_MIN} min earlier. Thresholds are placeholders to agree with the group.
      </p>
    </section>
  )
}
