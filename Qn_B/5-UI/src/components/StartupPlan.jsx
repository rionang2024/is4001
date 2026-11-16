import { useMemo, useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceArea } from 'recharts'
import { fmt, hh, hhmm, dow, dayMonth } from '../data.js'
import { ACTIVE_DAY_PEAK_KW } from '../live/forecast.js'
import { acOnFor } from '../schedule.js'

// The building's AC switches on on a schedule, not zone by zone: in the minute data Floors 3–7 come on
// together at about 07:45 and Floor 2 at about 08:00 (schedule.json, scripts/build_schedule.py).
// The plan starts pre-cooling READY_MIN before that. Indoor temperature fell ~4 °C within the first
// AC hour in 2019, so READY_MIN is enough lead; hot days get HOT_EXTRA_MIN more.
const READY_MIN = 30
const HOT_EXTRA_MIN = 15

const Snowflake = () => (
  <svg className="tt-flake" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M6 1v10M1.7 3.5l8.6 5M1.7 8.5l8.6-5M4.6 1.8 6 3l1.4-1.2M4.6 10.2 6 9l1.4 1.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

const zoneList = (zones) => zones.map((z) => z.replace('_', ' ')).join(', ')

function Timetable({ groups, seenLabel }) {
  const box = useRef(null)
  const [tip, setTip] = useState(null)

  const t0 = Math.floor((Math.min(...groups.map((g) => g.start)) - 30) / 60) * 60
  const t1 = Math.max(t0 + 180, Math.ceil((Math.max(...groups.map((g) => g.on)) + 45) / 60) * 60)
  const pos = (m) => (m - t0) / (t1 - t0)
  const x = (m) => `${pos(m) * 100}%`
  const ticks = []
  for (let m = t0; m <= t1; m += 30) ticks.push(m)
  const hover = (g) => (e) => {
    const r = box.current.getBoundingClientRect()
    setTip({ g, left: Math.min(e.clientX - r.left + 14, r.width - 290), top: e.clientY - r.top + 14 })
  }

  return (
    <div className="tt" ref={box} onMouseLeave={() => setTip(null)}>
      <div className="tt-row tt-axis">
        <span />
        <div className="tt-track">
          {ticks.map((m) => <span key={m} className={`tt-tick ${m % 60 ? 'minor' : ''}`} style={{ left: x(m) }}>{hhmm(m)}</span>)}
        </div>
      </div>
      <div className="tt-body">
        {groups.map((g) => (
          <div key={g.id} className="tt-row tt-floor" style={{ height: 46 }}>
            <div className="tt-zone">{g.label}<span className="tt-sub-label">{g.zones.length} zone{g.zones.length > 1 ? 's' : ''}</span></div>
            <div className="tt-track">
              <div className="tt-lane" onMouseMove={hover(g)}>
                <div className="tt-lead" style={{ left: x(g.start), width: `calc(${x(g.on)} - ${x(g.start)})` }}>
                  <Snowflake /><span className="num">{hhmm(g.start)}</span>
                </div>
                <div className="tt-on" style={{ left: x(g.on) }}><span>AC on {hhmm(g.on)}</span></div>
                {g.actualAt != null && <i className="tt-mark actual" style={{ left: x(g.actualAt) }} />}
              </div>
            </div>
          </div>
        ))}
      </div>

      {tip && (
        <div className="panel tt-tip" style={{ left: Math.max(0, tip.left), top: tip.top }}>
          <div className="tt-tip-head"><b>{tip.g.label}</b><span className="tt-chip">Pre-cooling</span></div>
          <dl className="tt-kv">
            <dt>Start cooling</dt><dd className="num">{hhmm(tip.g.start)}</dd>
            <dt>AC on</dt><dd className="num">{hhmm(tip.g.on)}</dd>
            <dt>Lead time</dt><dd className="num">{tip.g.on - tip.g.start} min</dd>
          </dl>
          <dl className="tt-kv muted-kv">
            <dt>AC on time from</dt><dd>{tip.g.seenAt != null ? `meters, ${seenLabel} (${hhmm(tip.g.seenAt)})` : 'typical 2019 day'}</dd>
            {tip.g.actualAt != null && <><dt>Meters, this day</dt><dd className="num">{hhmm(tip.g.actualAt)}</dd></>}
            <dt>AC energy, whole day</dt><dd className="num">{fmt(tip.g.kwh, 0)} kWh</dd>
          </dl>
          <div className="small muted" style={{ marginTop: 6 }}>{zoneList(tip.g.zones)}</div>
        </div>
      )}
    </div>
  )
}

// schedule: switch-on times from the minute data (schedule.json). seenDay: the last working day the
// forecast could see, whose metered AC-on times set the plan (typical times when there is none).
// showActual: also mark the metered AC-on time of the plan day itself (replays, test period).
// hotDayTemp: fixed hot-day threshold (live tab); otherwise the period's top quarter. qaLink: same morning in Question A.
export default function StartupPlan({ daily, building, date, schedule, seenDay, showActual, toolbar, hotDayTemp,
                                      hotDayNote = 'top quarter of the period', qaLink }) {
  const periodHot = useMemo(() => {
    const temps = [...new Set(daily.map((d) => `${d.date}|${d.temp_avg}`))].map((s) => +s.split('|')[1]).sort((a, b) => a - b)
    return temps[Math.floor(temps.length * 0.75)]
  }, [daily])
  const hotThreshold = hotDayTemp ?? periodHot

  const rows = daily.filter((d) => d.date === date)
  const hotDay = rows[0]?.temp_avg >= hotThreshold
  const closed = !!rows[0] && (rows[0].is_holiday || rows[0].is_weekend)
  const running = rows.filter((r) => r.forecast_peak >= ACTIVE_DAY_PEAK_KW)
  const lead = READY_MIN + (hotDay ? HOT_EXTRA_MIN : 0)

  // One row per group of zones that switch on together, from the forecast's running zones
  const seen = seenDay ? schedule.days[seenDay] : null
  const actual = showActual ? schedule.days[date] : null
  const groups = closed ? [] : schedule.groups.map((g) => {
    const zones = g.zones.filter((z) => running.some((r) => r.zone === z))
    const seenAt = seen?.[g.id] ?? null
    const on = acOnFor(schedule, seenDay, g.zones[0])
    return { ...g, zones, on, start: on - lead, seenAt, actualAt: actual?.[g.id] ?? null,
             kwh: rows.filter((r) => zones.includes(r.zone)).reduce((s, r) => s + r.forecast_kwh, 0) }
  }).filter((g) => g.zones.length)
  const overnight = schedule.overnight.filter((z) => running.some((r) => r.zone === z))
  const main = groups[0]

  const profile = building.t.map((t, i) => ({ t, h: +t.slice(11, 13), forecast: building.forecast[i] }))
    .filter((r) => r.t.startsWith(date))
  const peak = profile.reduce((a, b) => (b.forecast > (a?.forecast ?? -1) ? b : a), null)
  const seenLabel = seenDay && `${dow(seenDay)} ${dayMonth(seenDay)}`

  return (
    <section className="panel plan">
      <div className="panel-head">
        <h2>Pre-cooling plan · {dow(date)} {dayMonth(date)}</h2>
        {hotDay && !closed && <span className="chip warn">Hot day · +{HOT_EXTRA_MIN} min</span>}
      </div>
      {toolbar && <div className="plan-toolbar">{toolbar}</div>}

      {closed ? (
        <div className="note">
          <b>Office closed ({rows[0].is_holiday ? 'holiday' : 'weekend'}): no pre-cooling.</b>
          {running.length > 0 && <> {running.length} zone{running.length > 1 ? 's' : ''} still forecast to run AC (up to {fmt(Math.max(...running.map((r) => r.forecast_peak)))} kW): check nothing is left on.</>}
        </div>
      ) : !main ? (
        <div className="note">No AC forecast on this day.</div>
      ) : (
        <>
          <div className={`plan-kpis ${main.actualAt != null ? 'four' : ''}`}>
            <div className="plan-kpi"><div className="label">Start pre-cooling</div><div className="value num">{hhmm(main.start)}</div></div>
            <div className="plan-kpi"><div className="label">Building AC on</div><div className="value num">{hhmm(main.on)}</div></div>
            <div className="plan-kpi"><div className="label">Lead time</div><div className="value num">{lead} min</div></div>
            {main.actualAt != null && (
              <div className="plan-kpi"><div className="label">Meters, this day</div><div className="value num">{hhmm(main.actualAt)}</div></div>
            )}
          </div>
          <div className="plan-meters">
            {seen
              ? <>AC on times from the meters on <b>{seenLabel}</b>{groups.map((g) => g.seenAt != null && <span key={g.id}> · {g.label} <b className="num">{hhmm(g.seenAt)}</b></span>)}</>
              : <>AC on times: typical 2019 working day (minute data)</>}
            {qaLink && <> · <a href={qaLink}>See this morning in Question A →</a></>}
          </div>
          <div className="legend plan-legend">
            <span><i className="tt-key-lead" />Pre-cooling</span>
            <span><i className="tt-key-on" />AC on</span>
            {groups.some((g) => g.actualAt != null) && <span><i className="tt-key-mark actual" />Meters, this day</span>}
          </div>
          <Timetable groups={groups} seenLabel={seenLabel} />
          {overnight.length > 0 && <p className="muted small" style={{ margin: '6px 0 0' }}>{zoneList(overnight)} runs overnight: no start-up.</p>}

          <h3 className="plan-h" style={{ marginTop: 18 }}>Building load forecast</h3>
          <div style={{ height: 150 }}>
            <ResponsiveContainer>
              <BarChart data={profile} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                <ReferenceArea x1={Math.floor(main.start / 60)} x2={Math.ceil(main.on / 60)} fill="var(--precool)" fillOpacity={0.15} />
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
        In the minute data the building switches AC on at one time: Floors 3–7 at about 07:45, Floor 2 at about 08:00.
        The plan takes the last working day's metered time and starts cooling {READY_MIN} min before it
        ({READY_MIN + HOT_EXTRA_MIN} min on hot days, daily mean ≥ {fmt(hotThreshold)} °C, {hotDayNote}).
        LightGBM decides which zones run and how much energy they use.
      </details>
    </section>
  )
}
