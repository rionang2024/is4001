import { fmt, hh, dow } from '../data.js'

// Headline numbers for one zone on one upcoming day, plus how far to trust them.
export default function LiveKpis({ day, series, date, accuracy, mode }) {
  if (!day) return null
  const typicalKwh = series.t.reduce((s, t, i) => (t.startsWith(date) ? s + (series.typical[i] ?? 0) : s), 0)
  const op = accuracy?.operating
  const err = op?.[mode]?.WAPE
  const other = mode === 'typical' ? op?.readings?.WAPE : op?.typical?.WAPE
  const b2 = op?.B2?.WAPE
  const workday = !day.is_holiday && !day.is_weekend
  const dayKind = day.is_holiday ? 'holiday' : dow(date)

  return (
    <section className="kpis compact">
      <div className="kpi">
        <div className="label">Forecast peak</div>
        <div className="value">{fmt(day.forecast_peak)}<small>kW</small></div>
        <div className="foot">at {hh(day.forecast_peak_hour)}</div>
      </div>
      <div className="kpi">
        <div className="label">AC energy for the day</div>
        <div className="value">{fmt(day.forecast_kwh, 0)}<small>kWh</small></div>
        <div className="foot">vs {fmt(typicalKwh, 0)} kWh on a typical {dayKind}</div>
      </div>
      <div className="kpi">
        <div className="label">AC expected on from</div>
        {/* On closed days the start rule only picks up overnight base load, so no start time is shown */}
        <div className="value">{!workday ? '–' : day.start_hour == null ? 'Off' : hh(day.start_hour)}</div>
        <div className="foot">{day.is_holiday ? 'Holiday' : day.is_weekend ? 'Weekend' : 'Working day'} · {fmt(day.temp_max)} °C max</div>
      </div>
      <div className="kpi">
        <div className="label">Expected error · operating hours</div>
        <div className="value">{fmt(err)}<small>% WAPE</small></div>
        <div className="foot">
          {mode === 'typical'
            ? <>{fmt(other)}% once real readings are connected</>
            : <>{fmt(other)}% with the typical-week stand-in</>}
          {b2 != null && err != null && (
            <> · <span className={`chip ${err < b2 ? 'good' : 'bad'}`}>{err < b2 ? 'beats' : 'does not beat'} typical-profile {fmt(b2)}%</span></>
          )}
        </div>
      </div>
    </section>
  )
}
