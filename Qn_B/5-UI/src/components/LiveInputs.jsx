import { useRef } from 'react'
import { hhmm, dayMonth } from '../data.js'

const Status = ({ ok }) => (
  <span className={`chip ${ok ? 'good' : 'warn'}`} style={{ marginRight: 6 }}>{ok ? 'live' : 'stand-in'}</span>
)

// Sidebar: where each model input comes from, and the readings upload.
export default function LiveInputs({ weather, dates, readings, covered, zoneCount, onUpload, onClear, onTemplate, uploadError }) {
  const file = useRef(null)
  const hasReadings = !!readings

  return (
    <section className="panel">
      <div className="panel-head"><h2>Forecast inputs</h2></div>
      <table><tbody>
        <tr>
          <td><Status ok />Outdoor weather</td>
        </tr>
        <tr><td className="small muted" style={{ paddingTop: 0 }}>
          Open-Meteo forecast for the building, fetched {weather ? hhmm(weather.fetchedAt.getHours() * 60 + weather.fetchedAt.getMinutes()) : '…'}
          {dates.length > 0 && <> · {dayMonth(dates[0])} – {dayMonth(dates[dates.length - 1])}</>}
        </td></tr>
        <tr><td><Status ok />Calendar</td></tr>
        <tr><td className="small muted" style={{ paddingTop: 0 }}>Weekday, weekend and Thai public holidays</td></tr>
        <tr><td><Status ok={hasReadings && covered === zoneCount} />AC load, last 7 days</td></tr>
        <tr><td className="small muted" style={{ paddingTop: 0 }}>
          {hasReadings
            ? `${readings.rows.toLocaleString()} uploaded readings · ${covered} of ${zoneCount} zones covered; the rest use the typical week`
            : 'Typical 2019 week: median reading for the zone, day type and hour'}
        </td></tr>
        <tr><td><Status ok={hasReadings && covered === zoneCount} />Indoor temperature, last 7 days</td></tr>
        <tr><td className="small muted" style={{ paddingTop: 0, borderBottom: 0 }}>
          {hasReadings ? 'From the upload where given, otherwise the typical week' : 'Typical 2019 week, as above'}
        </td></tr>
      </tbody></table>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        <input ref={file} type="file" accept=".csv,text/csv" hidden
               onChange={(e) => { const f = e.target.files[0]; if (f) onUpload(f); e.target.value = '' }} />
        <button className="btn" onClick={() => file.current.click()}>Upload recent readings (CSV)</button>
        {hasReadings && <button className="btn" onClick={onClear}>Use typical week</button>}
        <button className="btn" onClick={onTemplate}>Download template</button>
      </div>
      {uploadError && <div className="note" style={{ marginTop: 8, color: 'var(--bad)' }}>{uploadError}</div>}

      <div className="note" style={{ marginTop: 12 }}>
        <b>Why this matters.</b> The model forecasts each hour from the same hour 1, 2 and 7 days earlier.
        The CU-BEMS record ends in Dec 2019, so until the building's meters feed this page those readings are stood in by a typical week.
        The template has the columns <span className="num">zone_id, timestamp, ac_load_kw, indoor_temp_c</span> for the 7 days before today.
      </div>
    </section>
  )
}
