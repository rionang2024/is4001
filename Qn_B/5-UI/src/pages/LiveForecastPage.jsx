import { useEffect, useMemo, useRef, useState } from 'react'
import { loadJSON, addDays, zoneLabel, shortZone, dow, dayMonth } from '../data.js'
import { fetchWeather, parseReadings, templateCsv, readingsCover, isHoliday, today,
         START_SHARE, START_MIN_KW, ACTIVE_DAY_PEAK_KW } from '../live/forecast.js'
import ZonePicker from '../components/ZonePicker.jsx'
import LiveKpis from '../components/LiveKpis.jsx'
import LiveChart from '../components/LiveChart.jsx'
import LiveInputs from '../components/LiveInputs.jsx'
import OutlookStrip from '../components/OutlookStrip.jsx'
import StartupPlan from '../components/StartupPlan.jsx'

const DAYS = 8   // today + the next 7

const START_RULE = `First hour the forecast reaches ${START_SHARE * 100}% of that day's forecast peak (and ≥ ${START_MIN_KW} kW). ` +
  `Days with forecast peak < ${ACTIVE_DAY_PEAK_KW} kW count as AC off.`

const modelUrl = (file) => new URL((import.meta.env.BASE_URL ?? '/') + 'data/live/' + file, document.baseURI).href

function download(name, text) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function LiveForecastPage() {
  const start = useMemo(today, [])
  const [inputs, setInputs] = useState(null)
  const [weather, setWeather] = useState(null)
  const [error, setError] = useState(null)
  const [zoneId, setZoneId] = useState('F2_Z2')
  const [date, setDate] = useState(addDays(start, 1))
  const [view, setView] = useState('day')
  const [modelId, setModelId] = useState('lgbm')
  const [readings, setReadings] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [overrides, setOverrides] = useState({})
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const worker = useRef(null)
  const runId = useRef(0)

  useEffect(() => {
    loadJSON('live/inputs.json').then((inp) => {
      setInputs(inp)
      return fetchWeather(inp.location, start, DAYS)
    }).then(setWeather).catch((e) => setError(e.message))
  }, [start])

  useEffect(() => {
    worker.current = new Worker(new URL('../live/worker.js', import.meta.url), { type: 'module' })
    worker.current.onmessage = ({ data }) => {
      if (data.id !== runId.current) return
      setRunning(false)
      if (data.error) setError(data.error)
      else setResult(data.out)
    }
    return () => worker.current.terminate()
  }, [])

  useEffect(() => {
    if (!inputs || !weather) return
    const m = inputs.models.find((x) => x.id === modelId)
    setRunning(true)
    worker.current.postMessage({ id: ++runId.current, modelUrl: modelUrl(m.file), bands: m.bands, inputs, weather,
                                 start, days: DAYS, readings, overrides })
  }, [inputs, weather, readings, overrides, start, modelId])

  const dailyByZone = useMemo(() => {
    const m = {}
    for (const d of result?.daily ?? []) (m[d.zone] ??= {})[d.date] = d
    return m
  }, [result])

  if (error) return <main className="page"><div className="loading">{error}</div></main>
  if (!inputs) return <main className="page"><div className="loading">Loading the model…</div></main>

  const last = addDays(start, DAYS - 1)
  const span = view === 'day' ? 1 : 7
  const series = result?.zones[zoneId]
  const mode = readingsCover(readings, zoneId, start) ? 'readings' : 'typical'
  const covered = readings ? inputs.zones.filter((z) => readingsCover(readings, z.id, start)).length : 0
  const hol = isHoliday(date, inputs, overrides)
  const holName = inputs.holidays[date]
  const model = inputs.models.find((m) => m.id === modelId)
  const opWape = (m, mode) => m.accuracy.overall.operating[mode].WAPE

  const onUpload = (f) => f.text().then((text) => {
    setUploadError(null)
    setReadings(parseReadings(text, inputs.zones.map((z) => z.id)))
  }).catch((e) => setUploadError(e.message))

  // Day and model change the whole-building plan, so they sit with it; floor/zone only change the detail below.
  const planControls = (
    <div className="controls">
      <div className="field">
        <label>Day</label>
        <div className="date-row">
          <button className="btn" disabled={date <= start} onClick={() => setDate(addDays(date, -1))}>‹</button>
          <input type="date" value={date} min={start} max={last} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button className="btn" disabled={date >= last} onClick={() => setDate(addDays(date, 1))}>›</button>
        </div>
      </div>
      <div className="field">
        <label>Day type</label>
        <div className="date-row">
          <span className="small">{hol ? `Holiday${holName ? `: ${holName}` : ''}` : ['Sat', 'Sun'].includes(dow(date)) ? 'Weekend' : 'Working day'}</span>
          <button className="btn small" onClick={() => setOverrides({ ...overrides, [date]: !hol })}>
            {hol ? 'Treat as working day' : 'Mark as office closed'}
          </button>
        </div>
      </div>
      <div className="field">
        <label>Model</label>
        <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
          {inputs.models.map((m) => (
            <option key={m.id} value={m.id}>{m.name} · {opWape(m, mode)}% WAPE</option>
          ))}
        </select>
      </div>
    </div>
  )

  return (
    <main className="page">
      <div className="hero">
        <div className="page-head">
          <div>
            <h1>Upcoming AC demand</h1>
            <p>Today and the next 7 days, from the trained {model.name} model and today's weather forecast for Bangkok.</p>
          </div>
          {running && <span className="chip plain">Running the model…</span>}
        </div>

        {result ? (
          <StartupPlan daily={result.daily} building={result.building} date={date} rule={START_RULE}
                       hotDayTemp={inputs.hot_day_temp} hotDayNote="hotter than three-quarters of 2019 days"
                       onPickZone={setZoneId} toolbar={planControls} />
        ) : (
          <section className="panel plan">{planControls}<div className="loading">Running the model…</div></section>
        )}
      </div>

      <section className="panel controls-panel zone-bar">
        <div className="controls">
          <div className="field">
            <label>Zone detail</label>
            <h2 className="zone-title">{zoneLabel(zoneId)}</h2>
          </div>
          <ZonePicker zones={inputs.zones} value={zoneId} onChange={setZoneId} />
          <div className="field">
            <label>View</label>
            <div className="seg">
              <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>One day</button>
              <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>7 days</button>
            </div>
          </div>
        </div>
      </section>

      <div className="layout">
        <div className="main-col">
          <LiveChart series={series} date={date} span={span} bandRule={inputs.rules.band} />

          {result && (
            <OutlookStrip days={dailyByZone[zoneId] ?? {}} date={date} onPick={setDate}
                          note={<>Weather is the <b>Open-Meteo forecast</b> issued today; the further ahead the day, the less certain it is.</>} />
          )}

          <section className="panel assumptions">
            <div className="panel-head"><h2>How this forecast is made</h2>
              <span className="sub">Model data exported {inputs.generated_at.slice(0, 10)}</span></div>
            <ul>
              <li><b>Model:</b> {model.name}, trained on {model.trained_on}, runs in your browser ({model.trees.toLocaleString()} trees). Same predictions as the Python model, checked by <span className="num">npm run check:live</span>.</li>
              <li><b>Choosing a model:</b> operating-hours WAPE on Jul–Sep 2018, with the typical week / with real readings:{' '}
                {inputs.models.map((m, i) => <span key={m.id}>{i > 0 && '; '}{m.name} {opWape(m, 'typical')}% / {opWape(m, 'readings')}%</span>)}.
                LightGBM also uses the weather, which helps most while readings are not connected; XGBoost (accuracy-first) uses only the calendar and AC lags, so it ignores the weather forecast.</li>
              <li><b>Weather:</b> live Open-Meteo forecast. Accuracy figures were measured with observed weather, so they flatter a real forecast a little, more so for days further out.</li>
              <li><b>Last-7-days inputs:</b> {inputs.rules.typical}. Backtested on Jul–Sep 2018: operating-hours WAPE {opWape(model, 'typical')}% with the typical week vs {opWape(model, 'readings')}% with real readings.</li>
              <li><b>Building today:</b> the model has only seen 2018–19. Changes since then (equipment, layout, occupancy, working patterns) are not in it.</li>
              <li><b>Holidays:</b> Thai public holidays. Office closures that are not public holidays can be marked per day in the plan above.</li>
              <li><b>Rain and solar timing:</b> {inputs.rules.weather_shift}.</li>
            </ul>
          </section>

          {mode === 'typical' && (
            <div className="note">
              <b>Recent readings are not connected.</b> The model's last-7-days inputs for this zone come from a typical 2019 week,
              so treat this as a weather- and calendar-adjusted typical day rather than a full forecast. Upload recent readings in the sidebar to use the real ones.
            </div>
          )}
        </div>

        <aside className="side-col" style={{ position: 'static' }}>
          {result && (
            <section className="panel">
              <div className="panel-head"><h2>{shortZone(zoneId)} · {dow(date)} {dayMonth(date)}</h2></div>
              <LiveKpis day={dailyByZone[zoneId]?.[date]} series={series} date={date}
                        accuracy={model.accuracy.by_zone[zoneId]} mode={mode} />
            </section>
          )}
          <LiveInputs weather={weather} dates={result?.dates ?? []} readings={readings} covered={covered}
                      zoneCount={inputs.zones.length} onUpload={onUpload} uploadError={uploadError}
                      onClear={() => { setReadings(null); setUploadError(null) }}
                      onTemplate={() => download(`readings_${addDays(start, -7)}_to_${addDays(start, -1)}.csv`,
                                                 templateCsv(inputs, start, overrides))} />
        </aside>
      </div>
    </main>
  )
}
