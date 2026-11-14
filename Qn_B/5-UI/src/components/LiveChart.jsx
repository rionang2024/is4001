import { useMemo } from 'react'
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { addDays, dow, dayMonth, fmt } from '../data.js'

function buildRows(series, date, span, actual) {
  const last = addDays(date, span - 1)
  const rows = []
  series.t.forEach((t, i) => {
    const day = t.slice(0, 10)
    if (day < date || day > last) return
    rows.push({
      t, day, h: +t.slice(11, 13),
      forecast: series.forecast[i], typical: series.typical[i],
      band: [series.band_lo[i], series.band_hi[i]], lo: series.band_lo[i], hi: series.band_hi[i],
      temp: series.temp[i], rain: series.rain[i], actual: actual?.[t] ?? null,
    })
  })
  return rows
}

function Tip({ active, payload, actualLabel }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="panel" style={{ padding: '8px 10px', fontSize: 12 }}>
      <b>{dow(r.day)} {dayMonth(r.day)}, {String(r.h).padStart(2, '0')}:00</b>
      <table style={{ marginTop: 4 }}><tbody>
        <tr><td>Forecast</td><td className="r num">{fmt(r.forecast)} kW</td></tr>
        {r.actual != null && <tr><td>{actualLabel}</td><td className="r num">{fmt(r.actual)} kW</td></tr>}
        <tr><td className="muted">Likely range</td><td className="r num muted">{fmt(r.lo)}–{fmt(r.hi)} kW</td></tr>
        <tr><td>Typical {dow(r.day)} (2019)</td><td className="r num">{fmt(r.typical)} kW</td></tr>
        <tr><td className="muted">Outdoor forecast</td><td className="r num muted">{fmt(r.temp)} °C · {fmt(r.rain)} mm</td></tr>
      </tbody></table>
    </div>
  )
}

// Upcoming forecast for one zone: no actuals yet, so it is compared with a typical day.
// actual: optional { 'YYYY-MM-DDTHH:00': kW } from uploaded readings for the forecast days
export default function LiveChart({ series, date, span, bandRule, actual, actualLabel = 'Actual' }) {
  const rows = useMemo(() => series && buildRows(series, date, span, actual), [series, date, span, actual])
  const last = addDays(date, span - 1)
  const hasActual = rows?.some((r) => r.actual != null)

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Hourly forecast · {span === 1 ? `${dow(date)} ${dayMonth(date)}` : `${dayMonth(date)} – ${dayMonth(last)}`}</h2>
        <div className="legend">
          <span><i style={{ borderColor: 'var(--forecast)' }} />Forecast</span>
          <span><i className="box" style={{ background: 'var(--band)' }} />10–90% likely range</span>
          <span><i className="dash" style={{ borderColor: 'var(--baseline)' }} />Typical day of this type (2019)</span>
          {hasActual && <span><i style={{ borderColor: 'var(--actual)' }} />{actualLabel}</span>}
        </div>
      </div>
      {!rows ? <div className="loading">Running the model…</div> : (
        <div style={{ height: 300 }}>
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="var(--line-2)" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }}
                     interval={span === 1 ? 2 : 23} minTickGap={8}
                     tickFormatter={(t) => span === 1 ? t.slice(11, 13) : `${dow(t.slice(0, 10))} ${t.slice(8, 10)}`} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} unit=" kW" width={60} />
              <Tooltip content={<Tip actualLabel={actualLabel} />} />
              <Area dataKey="band" stroke="none" fill="var(--band)" fillOpacity={0.15} isAnimationActive={false} />
              <Line dataKey="typical" stroke="var(--baseline)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line dataKey="forecast" stroke="var(--forecast)" strokeWidth={2} dot={false} isAnimationActive={false} />
              {hasActual && <Line dataKey="actual" stroke="var(--actual)" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="muted small" style={{ margin: '8px 0 0' }}>Range: {bandRule}.</p>
    </section>
  )
}
