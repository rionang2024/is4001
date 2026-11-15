import { useEffect, useMemo, useRef, useState } from 'react'
import { loadJSON, addDays, zoneLabel, shortZone, dow, dayMonth } from '../data.js'
import { fetchWeather, parseReadings, splitReadings, templateCsv, readingsCover, isHoliday, today, meteredStarts,
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

const dataUrl = (path) => new URL((import.meta.env.BASE_URL ?? '/') + 'data/' + path, document.baseURI).href
const modelUrl = (file) => dataUrl('live/' + file)

function download(name, text) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function LiveForecastPage() {
  const liveStart = useMemo(today, [])
  const [bms, setBms] = useState(null)          // mock BMS history index (optional)
  const [hist, setHist] = useState(null)        // real CU-BEMS 2018-19 history index (optional), Question A's data
  const [source, setSource] = useState(null)    // 'bms' | 'none' | 'upload' | 'cubems' | a replay preset id
  const [asOf, setAsOf] = useState(null)        // CU-BEMS: the day the forecast is made
  const replay = bms?.presets.find((p) => p.id === source)
  const history = source === 'cubems' && !!asOf
  const start = history ? asOf : replay?.start ?? liveStart      // the page's "today"
  const [baseInputs, setInputs] = useState(null)
  const [weather, setWeather] = useState(null)
  const [error, setError] = useState(null)
  const [zoneId, setZoneId] = useState('F2_Z2')
  const [date, setDate] = useState(addDays(liveStart, 1))
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
    loadJSON('live/inputs.json').then(setInputs).catch((e) => setError(e.message))
    loadJSON('bms/index.json').then(setBms).catch(() => setSource('none'))   // optional
    loadJSON('cubems/index.json').then(setHist).catch(() => {})              // optional
  }, [])

  // 2018-19 dates need that period's holidays and closures; the live list only covers recent years
  const inputs = useMemo(() => (baseInputs && history && hist
    ? { ...baseInputs, holidays: { ...baseInputs.holidays, ...hist.holidays } } : baseInputs), [baseInputs, history, hist])

  // Live: today's Open-Meteo forecast. Replays: the observed weather of that week (mock: 2026, CU-BEMS: 2018-19).
  useEffect(() => {
    if (!inputs) return
    setWeather(null)
    const observed = (file) => loadJSON(file).then((all) => ({
      byDay: Object.fromEntries(Array.from({ length: DAYS }, (_, i) => addDays(start, i)).filter((d) => all[d]).map((d) => [d, all[d]])),
      fetchedAt: null }))
    const w = history ? observed('cubems/weather.json') : replay ? observed('bms/weather.json') : fetchWeather(inputs.location, liveStart, DAYS)
    w.then(setWeather).catch((e) => setError(e.message))
  }, [inputs, replay, history, start, liveStart])

  // Meter readings: monthly exports (mock BMS or CU-BEMS) go through the same parser as a manual upload
  const loadReadings = (base, months, s, id) => {
    const [from, to] = [addDays(s, -7).slice(0, 7), addDays(s, DAYS - 1).slice(0, 7)]
    Promise.all(months.filter((m) => m >= from && m <= to).map((m) => fetch(dataUrl(`${base}/${m}.csv`)).then((r) => r.text())))
      .then((texts) => {
        const csv = texts.map((t, i) => (i ? t.slice(t.indexOf('\n') + 1) : t)).join('')   // one header
        setReadings(parseReadings(csv, baseInputs.zones.map((z) => z.id)))
        setSource(id)
      }).catch((e) => setUploadError(e.message))
  }
  const pickSource = (id, day) => {
    setUploadError(null)
    setOverrides({})
    setResult(null)
    if (id === 'cubems') {
      const s = day ?? asOf ?? hist.presets[0].start
      setAsOf(s)
      setDate(s)
      loadReadings('cubems', hist.months, s, id)
      return
    }
    const p = bms?.presets.find((x) => x.id === id)
    setDate(p ? p.start : addDays(liveStart, 1))
    if (id === 'none') { setSource(id); setReadings(null); return }
    loadReadings('bms', bms.months, p?.start ?? liveStart, id)
  }
  // A CU-BEMS "as of" date needs a week of readings before it inside one stretch of data
  const asOfOk = (d) => hist?.ranges.some(([a, b]) => d >= addDays(a, hist.lag_days) && d <= b)

  // Connect the mock BMS feed once both the model inputs and the history index are in
  useEffect(() => { if (baseInputs && bms && source === null) pickSource('bms') }, [baseInputs, bms])   // eslint-disable-line react-hooks/exhaustive-deps

  const { lags, actual } = useMemo(() => splitReadings(readings, start), [readings, start])

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
                                 start, days: DAYS, readings: lags, overrides })
  }, [inputs, weather, lags, overrides, start, modelId])

  // What the meters showed: AC start hour per zone on the last working day before the forecast was made, and on the
  // plan day itself when the readings reach it (replays). Shown next to the plan, never given to the model.
  const meters = useMemo(() => {
    if (!readings || !inputs) return null
    const has = (d) => Object.values(readings.byZone).some((days) => days[d]?.ac.some((v) => v != null))
    const working = (d) => !isHoliday(d, inputs, overrides) && !['Sat', 'Sun'].includes(dow(d))
    const seenDay = Array.from({ length: 7 }, (_, k) => addDays(start, -k - 1)).find((d) => working(d) && has(d))
    if (!seenDay) return null
    return { seenDay, seen: meteredStarts(readings.byZone, seenDay),
             actual: date >= start && has(date) ? meteredStarts(readings.byZone, date) : null }
  }, [readings, inputs, overrides, start, date])

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
  const mode = readingsCover(lags, zoneId, start) ? 'readings' : 'typical'
  const covered = lags ? inputs.zones.filter((z) => readingsCover(lags, z.id, start)).length : 0
  const hol = isHoliday(date, inputs, overrides)
  const holName = inputs.holidays[date]
  const model = inputs.models.find((m) => m.id === modelId)
  const opWape = (m, mode) => m.accuracy.overall.operating[mode].WAPE

  const onUpload = (f) => f.text().then((text) => {
    setUploadError(null)
    setReadings(parseReadings(text, inputs.zones.map((z) => z.id)))
    setSource('upload')
    setDate(addDays(liveStart, 1))
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
            <p>{history
              ? <>Replay on real CU-BEMS data: forecast made on {dow(start)} {dayMonth(start)} {start.slice(0, 4)} from the week of meter readings before it, with that week's observed weather.</>
              : replay
              ? <>Replay: forecast made on {dow(start)} {dayMonth(start)} 2026 from the meter history before it, with that week's observed weather.</>
              : <>Today and the next 7 days, from the trained {model.name} model, today's weather forecast for Bangkok and the last 7 days of meter readings.</>}</p>
          </div>
          <div className="date-row">
            {running && <span className="chip plain">Running the model…</span>}
            {(bms || hist) && (
              <div className="field">
                <label>Meter data</label>
                <select value={source ?? ''} onChange={(e) => pickSource(e.target.value)}>
                  {bms && <option value="bms">Live · mock BMS feed (to {dayMonth(bms.last)})</option>}
                  {source === 'upload' && <option value="upload">Live · uploaded CSV</option>}
                  <option value="none">Live · no meter data (typical week)</option>
                  {hist && <option value="cubems">Replay · real CU-BEMS data, 2018–19 (as Question A)</option>}
                  {bms && (
                    <optgroup label="Replay a mock 2026 week">
                      {bms.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
            )}
            {history && (
              <div className="field">
                <label>Forecast made on</label>
                <div className="date-row">
                  <input type="date" value={asOf} min={addDays(hist.ranges[0][0], hist.lag_days)} max={hist.ranges.at(-1)[1]}
                         onChange={(e) => { const d = e.target.value; if (d && asOfOk(d)) pickSource('cubems', d) }} />
                  <select value={hist.presets.find((p) => p.start === asOf)?.id ?? ''}
                          onChange={(e) => e.target.value && pickSource('cubems', hist.presets.find((p) => p.id === e.target.value).start)}>
                    <option value="">Suggested days…</option>
                    {hist.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
        {history && (
          <div className="demo-note">
            <span className="chip good">Real CU-BEMS readings</span> The same meters as the After-hours energy tab (hourly means of its minute data).
            Readings from {dow(start)} {dayMonth(start)} on are only drawn as actuals, never given to the model.{' '}
            {start <= hist.test[1]
              ? <span className="chip plain">Test period · the model never saw these days</span>
              : <span className="chip warn">2019 · the model was trained on this year, so the match is optimistic</span>}
            {hist.presets.find((p) => p.start === asOf) && <> {hist.presets.find((p) => p.start === asOf).edge}</>}
            {' '}Dates with data: Jul–Sep 2018 and Mar–Dec 2019.
          </div>
        )}
        {(source === 'bms' || replay) && (
          <div className="demo-note">
            <span className="chip warn">Mock BMS data</span> {replay ? replay.edge : 'Readings stand in for the building’s meters; weather is real.'}
          </div>
        )}

        {result ? (
          <StartupPlan daily={result.daily} building={result.building} date={date} rule={START_RULE}
                       hotDayTemp={inputs.hot_day_temp} hotDayNote="hotter than three-quarters of 2019 days"
                       onPickZone={setZoneId} toolbar={planControls} meters={meters}
                       qaLink={history ? `#/qn-a?t=${date}T06:00` : null} />
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
          <LiveChart series={series} date={date} span={span} bandRule={inputs.rules.band}
                     actual={actual[zoneId]} actualLabel={history ? 'Actual (CU-BEMS)' : replay ? 'Actual (mock BMS)' : 'Actual (uploaded)'} />

          {result && (
            <OutlookStrip days={dailyByZone[zoneId] ?? {}} date={date} onPick={setDate}
                          note={history
                            ? <>Weather is the <b>observed {start.slice(0, 4)} weather</b> the model was trained and tested with, standing in for a forecast.</>
                            : replay
                            ? <>Weather is <b>observed 2026 weather</b> (Open-Meteo archive), standing in for a forecast.</>
                            : <>Weather is the <b>Open-Meteo forecast</b> issued today; the further ahead the day, the less certain it is.</>} />
          )}

          <section className="panel assumptions">
            <div className="panel-head"><h2>How this forecast is made</h2>
              <span className="sub">Model data exported {inputs.generated_at.slice(0, 10)}</span></div>
            <ul>
              <li><b>Model:</b> {model.name}, trained on {model.trained_on}, runs in your browser ({model.trees.toLocaleString()} trees). Same predictions as the Python model, checked by <span className="num">npm run check:live</span>.</li>
              <li><b>Choosing a model:</b> operating-hours WAPE on Jul–Sep 2018, with the typical week / with real readings:{' '}
                {inputs.models.map((m, i) => <span key={m.id}>{i > 0 && '; '}{m.name} {opWape(m, 'typical')}% / {opWape(m, 'readings')}%</span>)}.
                LightGBM also uses the weather, which helps most while readings are not connected; XGBoost (accuracy-first) uses only the calendar and AC lags, so it ignores the weather forecast.</li>
              <li><b>Weather:</b> {history ? 'replay: the observed 2018–19 weather from the model data, standing in for the forecast.' : replay ? 'replay: observed 2026 weather from the Open-Meteo archive, standing in for the forecast.' : 'live Open-Meteo forecast.'} Accuracy figures were measured with observed weather, so they flatter a real forecast a little, more so for days further out.</li>
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
          <LiveInputs weather={weather} dates={result?.dates ?? []} readings={lags} covered={covered}
                      feed={source === 'upload' ? 'Uploaded CSV' : history ? 'CU-BEMS 2018–19' : bms && source !== 'none' ? 'Mock BMS feed' : null}
                      zoneCount={inputs.zones.length} onUpload={onUpload} uploadError={uploadError}
                      onClear={() => pickSource('none')}
                      onTemplate={() => download(`readings_${addDays(start, -7)}_to_${addDays(start, -1)}.csv`,
                                                 templateCsv(inputs, start, overrides))} />
        </aside>
      </div>
    </main>
  )
}
