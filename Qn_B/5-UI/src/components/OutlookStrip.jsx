import { addDays, dow, dayMonth, fmt } from '../data.js'
import { ACTIVE_DAY_PEAK_KW } from '../live/forecast.js'

// 7-day outlook for the selected zone: weather inputs and forecast peak per day.
export default function OutlookStrip({ days, date, onPick, note }) {
  const list = Array.from({ length: 7 }, (_, i) => addDays(date, i))
  const maxPeak = Math.max(1, ...list.map((d) => days[d]?.forecast_peak ?? 0))

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>7-day outlook</h2>
        <span className="sub">Forecast peak for this zone</span>
      </div>
      <div className="outlook">
        {list.map((d, i) => {
          const x = days[d]
          return (
            <button key={d} className={`day ${i === 0 ? 'sel' : ''}`} onClick={() => onPick(d)} disabled={!x}>
              <div className="d">{dow(d)} {dayMonth(d)}</div>
              {!x ? <div className="muted small" style={{ marginTop: 6 }}>No data</div> : (
                <>
                  <div className="pk">{fmt(x.forecast_peak)}<small> kW</small></div>
                  <div className="wx"><span>{fmt(x.temp_max)}°C</span><span>{fmt(x.rain_mm)} mm</span></div>
                  <div style={{ marginTop: 4 }}>
                    {x.is_holiday ? <span className="chip plain">Holiday</span>
                      : x.is_weekend ? <span className="chip plain">Weekend</span>
                      : x.forecast_peak < ACTIVE_DAY_PEAK_KW ? <span className="small muted">AC off</span> : null}
                  </div>
                  <div className="bar"><span style={{ width: `${(x.forecast_peak / maxPeak) * 100}%` }} /></div>
                </>
              )}
            </button>
          )
        })}
      </div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        {note ?? <>Observed weather stands in for a forecast.</>}
      </p>
    </section>
  )
}
