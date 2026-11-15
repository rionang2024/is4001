import { useRef } from 'react'
import { hhmm, dayMonth } from '../data.js'

const Status = ({ ok, label }) => (
  <span className={`chip ${ok ? 'good' : 'warn'}`} style={{ marginRight: 6 }}>{label ?? (ok ? 'live' : 'stand-in')}</span>
)

// Sidebar: where each model input comes from, and the readings upload.
export default function LiveInputs({ weather, dates, readings, feed, covered, zoneCount, onUpload, onClear, onTemplate, uploadError }) {
  const file = useRef(null)
  const hasReadings = !!readings
  const mock = feed === 'Mock BMS feed'

  return (
    <section className="panel">
      <div className="panel-head"><h2>Forecast inputs</h2></div>
      <table><tbody>
        <tr>
          <td><Status ok label={weather && !weather.fetchedAt ? 'observed' : undefined} />Outdoor weather</td>
        </tr>
        <tr><td className="small muted" style={{ paddingTop: 0 }}>
          {!weather ? 'Open-Meteo forecast for the building, fetching…'
            : weather.fetchedAt ? `Open-Meteo forecast for the building, fetched ${hhmm(weather.fetchedAt.getHours() * 60 + weather.fetchedAt.getMinutes())}`
            : 'Observed weather (Open-Meteo archive), replay'}
          {dates.length > 0 && <> · {dayMonth(dates[0])} – {dayMonth(dates[dates.length - 1])}</>}
        </td></tr>
        <tr><td><Status ok />Calendar</td></tr>
        <tr><td className="small muted" style={{ paddingTop: 0 }}>Weekday, weekend and Thai public holidays</td></tr>
        <tr><td><Status ok={hasReadings && covered === zoneCount} label={hasReadings && mock ? 'mock BMS' : undefined} />AC load, last 7 days</td></tr>
        <tr><td className="small muted" style={{ paddingTop: 0 }}>
          {hasReadings
            ? `${feed ?? 'Uploaded'}: ${readings.rows.toLocaleString()} readings · ${covered} of ${zoneCount} zones covered` + (covered < zoneCount ? '; the rest use the typical week' : '')
            : 'Typical 2019 week: median reading for the zone, day type and hour'}
        </td></tr>
        <tr><td><Status ok={hasReadings && covered === zoneCount} label={hasReadings && mock ? 'mock BMS' : undefined} />Indoor temperature &amp; humidity, last 7 days</td></tr>
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

      <p className="muted small" style={{ margin: '10px 0 0' }}>
        The model uses readings from 1, 2 and 7 days before. Without them, a typical 2019 week stands in.
      </p>
    </section>
  )
}
