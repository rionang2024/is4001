import { useEffect, useMemo, useRef, useState } from 'react'
import { loadJSON, addDays, zoneLabel, shortZone, dow, dayMonth, fmt } from '../data.js'
import { fetchWeather, parseReadings, splitReadings, templateCsv, readingsCover, isHoliday, today } from '../live/forecast.js'
import { lastMeteredDay, acOnFor } from '../schedule.js'
import ZonePicker from '../components/ZonePicker.jsx'
import LiveKpis from '../components/LiveKpis.jsx'
import LiveChart from '../components/LiveChart.jsx'
import LiveInputs from '../components/LiveInputs.jsx'
import OutlookStrip from '../components/OutlookStrip.jsx'
import StartupPlan from '../components/StartupPlan.jsx'

const DAYS = 8   // today + the next 7

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
  const [zoneId, setZoneId] = useState('F3_Z1')
  const [date, setDate] = useState(addDays(liveStart, 1))
  const [view, setView] = useState('day')
  const [schedule, setSchedule] = useState(null)
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
    loadJSON('schedule.json').then(setSchedule).catch((e) => setError(e.message))
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
    const m = inputs.models[0]                    // LightGBM · M4, the team's model
    setRunning(true)
    worker.current.postMessage({ id: ++runId.current, modelUrl: modelUrl(m.file), bands: m.bands, inputs, weather,
                                 start, days: DAYS, readings: lags, overrides })
  }, [inputs, weather, lags, overrides, start])

  const dailyByZone = useMemo(() => {
    const m = {}
    for (const d of result?.daily ?? []) (m[d.zone] ??= {})[d.date] = d
    return m
  }, [result])

  if (error) return <main className="page"><div className="loading">{error}</div></main>
  if (!inputs || !schedule) return <main className="page"><div className="loading">Loading the model…</div></main>

  const last = addDays(start, DAYS - 1)
  const span = view === 'day' ? 1 : 7
  const series = result?.zones[zoneId]
  const mode = readingsCover(lags, zoneId, start) ? 'readings' : 'typical'
  const covered = lags ? inputs.zones.filter((z) => readingsCover(lags, z.id, start)).length : 0
  const hol = isHoliday(date, inputs, overrides)
  const holName = inputs.holidays[date]
  const model = inputs.models[0]
  const score = inputs.reported
  // CU-BEMS replays plan from the last working day the forecast could see; live days use the typical times
  const seenDay = history ? lastMeteredDay(schedule, start) : null

  const onUpload = (f) => f.text().then((text) => {
    setUploadError(null)
    setReadings(parseReadings(text, inputs.zones.map((z) => z.id)))
    setSource('upload')
    setDate(addDays(liveStart, 1))
  }).catch((e) => setUploadError(e.message))

  // Day and day type change the whole-building plan, so they sit with it; floor/zone only change the detail below.
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
        <div className="model-tag"><b>LightGBM</b> · feature set M4 · WAPE {score.lgbm.WAPE}%</div>
      </div>
    </div>
  )

  return (
    <main className="page">
      <div className="hero">
        <div className="page-head">
          <div>
            <h1>Upcoming AC demand</h1>
            <p>{history || replay
              ? <>LightGBM forecast made on {dow(start)} {dayMonth(start)} {start.slice(0, 4)}, from the week of readings before it.</>
              : <>LightGBM forecast for today and the next 7 days.</>}</p>
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
            <span className="chip good">Real CU-BEMS data</span> Same meters as Question A.{' '}
            {start <= hist.test[1]
              ? <span className="chip plain">Test period: unseen by the model</span>
              : <span className="chip warn">2019: training year, so optimistic</span>}
          </div>
        )}
        {(source === 'bms' || replay) && (
          <div className="demo-note">
            <span className="chip warn">Mock BMS data</span> {replay ? replay.edge : 'Stand-in meter readings; real weather.'}
          </div>
        )}

        {result ? (
          <StartupPlan daily={result.daily} building={result.building} date={date} schedule={schedule}
                       seenDay={seenDay} showActual={history} toolbar={planControls}
                       hotDayTemp={inputs.hot_day_temp} hotDayNote="hotter than three-quarters of 2019 days"
                       qaLink={history ? `#/qn-a?t=${date}T07:00` : null} />
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
                          note={history || replay ? <>Observed weather stands in for a forecast.</>
                            : <>Weather: today's Open-Meteo forecast.</>} />
          )}

          <section className="panel assumptions">
            <div className="panel-head"><h2>About the model</h2></div>
            <ul>
              <li><b>LightGBM, feature set M4</b>: calendar, AC lags, indoor and outdoor weather. Trained on 2019.</li>
              <li>Test (Jul–Sep 2018, operating hours): WAPE {fmt(score.lgbm.WAPE, 2)}%, CV(RMSE) {fmt(score.lgbm.CVRMSE, 2)}%, NMBE {fmt(score.lgbm.NMBE, 2)}%.
                Beat XGBoost M4 ({fmt(score.xgb.WAPE, 2)}%, {fmt(score.xgb.CVRMSE, 2)}%, {fmt(score.xgb.NMBE, 2)}%).</li>
              <li>Without recent readings, a typical 2019 week stands in (WAPE {model.accuracy.overall.operating.typical.WAPE}%).</li>
            </ul>
          </section>

          {mode === 'typical' && (
            <div className="note"><b>No recent readings for this zone:</b> using a typical 2019 week.</div>
          )}
        </div>

        <aside className="side-col" style={{ position: 'static' }}>
          {result && (
            <section className="panel">
              <div className="panel-head"><h2>{shortZone(zoneId)} · {dow(date)} {dayMonth(date)}</h2></div>
              <LiveKpis day={dailyByZone[zoneId]?.[date]} series={series} date={date}
                        accuracy={model.accuracy.by_zone[zoneId]} mode={mode} acOn={acOnFor(schedule, seenDay, zoneId)} />
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
