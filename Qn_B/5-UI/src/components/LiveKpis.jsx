import { fmt, hh, hhmm, dow } from '../data.js'
import { ACTIVE_DAY_PEAK_KW } from '../live/forecast.js'

// Headline numbers for one zone on one upcoming day, plus how far to trust them.
// acOn: the zone's planned AC-on minute (schedule), 'overnight', or null.
export default function LiveKpis({ day, series, date, accuracy, mode, acOn }) {
  if (!day) return null
  const typicalKwh = series.t.reduce((s, t, i) => (t.startsWith(date) ? s + (series.typical[i] ?? 0) : s), 0)
  const err = accuracy?.operating?.[mode]?.WAPE
  const workday = !day.is_holiday && !day.is_weekend
  const dayKind = day.is_holiday ? 'holiday' : dow(date)
  const on = !workday || day.forecast_peak < ACTIVE_DAY_PEAK_KW ? 'Off' : acOn === 'overnight' ? 'All night' : acOn == null ? '–' : hhmm(acOn)

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
        <div className="foot">typical {dayKind}: {fmt(typicalKwh, 0)} kWh</div>
      </div>
      <div className="kpi">
        <div className="label">AC on</div>
        <div className="value">{on}</div>
        <div className="foot">{day.is_holiday ? 'Holiday' : day.is_weekend ? 'Weekend' : 'Working day'} · {fmt(day.temp_max)} °C max</div>
      </div>
      <div className="kpi">
        <div className="label">Expected error (WAPE)</div>
        <div className="value">{fmt(err)}<small>%</small></div>
        <div className="foot">{mode === 'typical' ? 'typical-week inputs' : 'with real readings'}, operating hours</div>
      </div>
    </section>
  )
}
