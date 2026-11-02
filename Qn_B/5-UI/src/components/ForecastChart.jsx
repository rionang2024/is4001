import { useMemo } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot,
} from 'recharts'
import { addDays, dow, dayMonth, fmt, modelName } from '../data.js'

const ALERT_COLOR = { 'Above forecast': 'var(--bad)', 'Below forecast': 'var(--warn)', 'After-hours running': 'var(--violet)' }

// Builds a full hourly index so missing hours show as gaps, not joined lines.
function buildRows(series, date, span, model, compare) {
  const idx = new Map(series.t.map((t, i) => [t, i]))
  const rows = []
  for (let d = 0; d < span; d++) {
    const day = addDays(date, d)
    for (let h = 0; h < 24; h++) {
      const t = `${day}T${String(h).padStart(2, '0')}:00`
      const i = idx.get(t)
      rows.push(i == null
        ? { t, day, h }
        : {
            t, day, h,
            actual: series.actual[i],
            forecast: series.models[model]?.[i],
            compare: series.models[compare]?.[i],
            band: [series.band_lo[i], series.band_hi[i]],
            temp: series.temp[i], rain: series.rain[i],
          })
    }
  }
  return rows
}

function Tip({ active, payload, model, compare }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="panel" style={{ padding: '8px 10px', fontSize: 12 }}>
      <b>{dow(r.day)} {dayMonth(r.day)}, {String(r.h).padStart(2, '0')}:00</b>
      {r.actual == null ? <div className="muted">No reading this hour</div> : (
        <table style={{ marginTop: 4 }}><tbody>
          <tr><td>Actual</td><td className="r num">{fmt(r.actual)} kW</td></tr>
          <tr><td>{modelName(model)}</td><td className="r num">{fmt(r.forecast)} kW</td></tr>
          <tr><td>{modelName(compare)}</td><td className="r num">{fmt(r.compare)} kW</td></tr>
          <tr><td className="muted">Outdoor</td><td className="r num muted">{fmt(r.temp)} °C · {fmt(r.rain)} mm</td></tr>
        </tbody></table>
      )}
    </div>
  )
}

export default function ForecastChart({ series, date, span, model, compare, alerts, bandFor, bandRule }) {
  const rows = useMemo(() => series && buildRows(series, date, span, model, compare), [series, date, span, model, compare])
  const showBand = model === bandFor
  const last = addDays(date, span - 1)
  const marks = alerts.filter((a) => a.date >= date && a.date <= last)
  const missing = rows ? rows.filter((r) => r.actual == null).length : 0

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Forecast vs actual · {span === 1 ? `${dow(date)} ${dayMonth(date)}` : `${dayMonth(date)} – ${dayMonth(last)}`}</h2>
        <div className="legend">
          <span><i style={{ borderColor: 'var(--actual)' }} />Actual</span>
          <span><i style={{ borderColor: 'var(--forecast)' }} />{modelName(model)}</span>
          {showBand && <span><i className="box" style={{ background: 'var(--band)' }} />10–90% error band</span>}
          <span><i className="dash" style={{ borderColor: 'var(--baseline)' }} />{modelName(compare)}</span>
        </div>
      </div>
      {!rows ? <div className="loading">Loading zone…</div> : (
        <div style={{ height: 300 }}>
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="var(--line-2)" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }}
                     interval={span === 1 ? 2 : 23} minTickGap={8}
                     tickFormatter={(t) => span === 1 ? t.slice(11, 13) : `${dow(t.slice(0, 10))} ${t.slice(8, 10)}`} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} unit=" kW" width={60} />
              <Tooltip content={<Tip model={model} compare={compare} />} />
              {showBand && <Area dataKey="band" stroke="none" fill="var(--band)" fillOpacity={0.15} isAnimationActive={false} connectNulls={false} />}
              <Line dataKey="compare" stroke="var(--baseline)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line dataKey="forecast" stroke="var(--forecast)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="actual" stroke="var(--actual)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
              {marks.map((a) => (
                <ReferenceDot key={a.t} x={a.t} y={a.actual} r={4} fill={ALERT_COLOR[a.type]} stroke="var(--panel)" />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        Dots mark deviation alerts (see sidebar).{missing > 0 && ` ${missing} hour(s) in this window have no scored reading and show as gaps.`}
        {showBand && ` Band: ${bandRule}.`}
      </p>
    </section>
  )
}
