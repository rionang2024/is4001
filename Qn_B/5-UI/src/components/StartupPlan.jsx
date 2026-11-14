import { Fragment, useMemo, useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceArea } from 'recharts'
import { fmt, hh, hhmm, dow, dayMonth } from '../data.js'

// Lowest-energy start: AC energy grows with runtime, so every zone starts as late as it can while still
// being cool when its forecast start hour (office opening) arrives. On 2019 working days indoor
// temperature fell ~4 °C within the first AC hour, so READY_MIN is enough lead. Staggering would lower
// the start-up peak (kW) but lengthen runtime, so it is not used.
const READY_MIN = 30      // every zone starts this long before its forecast start hour
const HOT_EXTRA_MIN = 15  // extra pre-cooling lead on hot days

// Only zones with a start-up: start hour 0 means the zone is forecast to run around the clock
function buildPlan(rows, hotDay) {
  return rows.filter((r) => r.start_hour > 0).map((r) => ({
    ...r, slot: r.start_hour, suggested: r.start_hour * 60 - READY_MIN - (hotDay ? HOT_EXTRA_MIN : 0),
  }))
}

// Floors, each split into lanes of zones that share a start time
function floorsOf(plan) {
  const floors = [...new Set(plan.map((p) => p.zone.slice(0, 2)))].sort()
  return floors.map((f) => {
    const zones = plan.filter((p) => p.zone.startsWith(f)).sort((a, b) => a.zone.localeCompare(b.zone))
    const lanes = [...new Set(zones.map((p) => p.suggested))].sort((a, b) => a - b)
      .map((t) => ({ t, slot: zones.find((p) => p.suggested === t).slot, zones: zones.filter((p) => p.suggested === t) }))
    return { f, label: `Floor ${f.slice(1)}`, zones, lanes }
  })
}

const zLabel = (p) => `Z${p.zone.slice(4)}`

function Timetable({ plan, onPick }) {
  const box = useRef(null)
  const [tip, setTip] = useState(null)
  const [open, setOpen] = useState(null)
  const floors = floorsOf(plan)

  const first = Math.min(...plan.map((p) => p.suggested)), lastOn = Math.max(...plan.map((p) => p.slot * 60))
  const t0 = Math.floor((first - 30) / 60) * 60
  const t1 = Math.max(t0 + 180, Math.ceil((lastOn + 60) / 60) * 60)
  const x = (m) => `${((m - t0) / (t1 - t0)) * 100}%`
  const ticks = []
  for (let m = t0; m <= t1; m += 30) ticks.push(m)
  const openings = [...new Set(plan.map((p) => p.slot))]
  const grid = { backgroundImage: 'linear-gradient(to right, var(--line-2) 1px, transparent 1px)', backgroundSize: `${(30 / (t1 - t0)) * 100}% 100%` }

  const hover = (lane, title) => (e) => {
    const r = box.current.getBoundingClientRect()
    setTip({ lane, title, left: Math.min(e.clientX - r.left + 14, r.width - 310), top: e.clientY - r.top + 14 })
  }

  const Lane = ({ lane, title, text }) => (
    <div className="tt-lane" onMouseMove={hover(lane, title)}>
      <div className="tt-lead" style={{ left: x(lane.t), width: `calc(${x(lane.slot * 60)} - ${x(lane.t)})` }} />
      <div className="tt-on" style={{ left: x(lane.slot * 60) }}>{text && <span>{text}</span>}</div>
    </div>
  )

  return (
    <div className="tt" ref={box} onMouseLeave={() => setTip(null)}>
      <div className="tt-row tt-axis">
        <span />
        <div className="tt-track">
          {ticks.map((m) => <span key={m} className={`tt-tick ${m % 60 ? 'minor' : ''}`} style={{ left: x(m) }}>{hhmm(m)}</span>)}
        </div>
      </div>

      <div className="tt-body">
        {openings.map((h) => <div key={h} className="tt-open" style={{ left: `calc(72px + (100% - 72px) * ${(h * 60 - t0) / (t1 - t0)})` }} />)}
        {floors.map((fl) => (
          <Fragment key={fl.f}>
            <div className="tt-row tt-floor" style={{ height: 8 + 18 * fl.lanes.length }} onClick={() => setOpen(open === fl.f ? null : fl.f)}>
              <button className="tt-zone"><span className="tt-caret">{open === fl.f ? '▾' : '▸'}</span>{fl.label}</button>
              <div className="tt-track" style={grid}>
                {fl.lanes.map((ln) => <Lane key={ln.t} lane={ln} title={fl.label} text={ln.zones.map(zLabel).join(' ')} />)}
              </div>
            </div>
            {open === fl.f && fl.zones.map((p) => (
              <div key={p.zone} className="tt-row tt-sub" title="Show this zone's detail below" onClick={() => onPick(p.zone)}>
                <button className="tt-zone">{zLabel(p)}</button>
                <div className="tt-track" style={grid}>
                  <Lane lane={{ t: p.suggested, slot: p.slot, zones: [p] }} title={`${fl.label} ${zLabel(p)}`} />
                </div>
              </div>
            ))}
          </Fragment>
        ))}
      </div>

      {tip && (
        <div className="panel tt-tip" style={{ left: Math.max(0, tip.left), top: tip.top }}>
          <b>{tip.title}</b>
          <div className="small">Start cooling <b className="num">{hhmm(tip.lane.t)}</b> · open <b className="num">{hh(tip.lane.slot)}</b></div>
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>Zone</th><th className="r">Highest load<br />(and when)</th><th className="r">AC energy,<br />whole day</th></tr></thead>
            <tbody>
              {tip.lane.zones.map((p) => (
                <tr key={p.zone}>
                  <td>{zLabel(p)}</td>
                  <td className="r num">{fmt(p.forecast_peak)} kW at {hh(p.forecast_peak_hour)}</td>
                  <td className="r num">{p.forecast_kwh != null ? `${fmt(p.forecast_kwh, 0)} kWh` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// hotDayTemp: fixed threshold (live tab, where a week is too short to take a quartile of)
// toolbar: optional controls shown under the title (live tab: day, day type, model)
export default function StartupPlan({ daily, building, date, onPickZone, rule, toolbar, hotDayTemp, hotDayNote = 'top quarter of the period' }) {
  const periodHot = useMemo(() => {
    const temps = [...new Set(daily.map((d) => `${d.date}|${d.temp_avg}`))].map((s) => +s.split('|')[1]).sort((a, b) => a - b)
    return temps[Math.floor(temps.length * 0.75)]
  }, [daily])
  const hotThreshold = hotDayTemp ?? periodHot

  const rows = daily.filter((d) => d.date === date)
  const hotDay = rows[0]?.temp_avg >= hotThreshold
  // Closed days (weekend, holiday, marked closed): nothing to pre-cool, but flag zones forecast to run anyway
  const closed = !!rows[0] && (rows[0].is_holiday || rows[0].is_weekend)
  const plan = closed ? [] : buildPlan(rows, hotDay)
  const runningAnyway = closed ? rows.filter((r) => r.start_hour != null) : []
  const allDay = closed ? [] : rows.filter((r) => r.start_hour === 0)

  const profile = building.t.map((t, i) => ({ t, h: +t.slice(11, 13), forecast: building.forecast[i] }))
    .filter((r) => r.t.startsWith(date))
  const peak = profile.reduce((a, b) => (b.forecast > (a?.forecast ?? -1) ? b : a), null)
  const firstStart = plan.length ? Math.min(...plan.map((p) => p.suggested)) : 0
  const lastSlot = plan.length ? Math.max(...plan.map((p) => p.slot)) : 0

  return (
    <section className="panel plan">
      <div className="panel-head">
        <h2>Start-up &amp; pre-cooling plan · {dow(date)} {dayMonth(date)}</h2>
        <div className="legend">
          <span><i className="box tt-key-lead" />Pre-cooling</span>
          <span><i className="box tt-key-on" />Office hours</span>
          <span><i className="tt-key-open" />Opening</span>
          {hotDay && !closed && <span className="chip warn">Hot day · +{HOT_EXTRA_MIN} min</span>}
        </div>
      </div>
      {toolbar && <div className="plan-toolbar">{toolbar}</div>}

      {closed ? (
        <div className="note">
          <b>Office closed ({rows[0].is_holiday ? 'holiday' : 'weekend'}): no pre-cooling scheduled.</b>
          {runningAnyway.length > 0 && <> {runningAnyway.length} zone{runningAnyway.length > 1 ? 's are' : ' is'} still forecast to draw AC
            (up to {fmt(Math.max(...runningAnyway.map((r) => r.forecast_peak)))} kW). Worth checking nothing is left on.</>}
        </div>
      ) : plan.length === 0 ? (
        <div className="note">No AC forecast on this day.</div>
      ) : (
        <>
          <Timetable plan={plan} onPick={onPickZone} />
          {allDay.length > 0 && (
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              Not shown: {allDay.map((r) => r.zone.replace('_', ' ')).join(', ')} run around the clock (no start-up).
            </p>
          )}

          <h3 className="plan-h" style={{ marginTop: 18 }}>Building load forecast</h3>
          <div style={{ height: 150 }}>
            <ResponsiveContainer>
              <BarChart data={profile} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                <ReferenceArea x1={Math.floor(firstStart / 60)} x2={lastSlot} fill="var(--warn)" fillOpacity={0.12} />
                <XAxis dataKey="h" tick={{ fontSize: 10, fill: 'var(--ink-3)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval={1}
                       tickFormatter={(h) => String(h).padStart(2, '0')} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} unit=" kW" width={58} />
                <Tooltip formatter={(v) => [`${fmt(v)} kW`, 'Building forecast']} labelFormatter={(h) => hh(h)} />
                <Bar dataKey="forecast" isAnimationActive={false}>
                  {profile.map((p) => <Cell key={p.h} fill={p.h === peak?.h ? 'var(--bad)' : 'var(--forecast)'} fillOpacity={p.h === peak?.h ? 0.9 : 0.55} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <details className="plan-rule">
        <summary>How the plan is worked out</summary>
        Lowest energy: every zone starts {READY_MIN} min before its forecast start hour ({rule}), {HOT_EXTRA_MIN} min earlier on hot days
        (daily mean ≥ {fmt(hotThreshold)} °C, {hotDayNote}). Indoor temperature fell ~4 °C within the first AC hour in 2019, so {READY_MIN} min is enough.
        Starting zones at different times would lower the start-up peak but add runtime (≈ +200 kWh/day for floor batches), so all zones start together.
      </details>
    </section>
  )
}
