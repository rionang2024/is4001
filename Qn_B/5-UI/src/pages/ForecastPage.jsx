import { useEffect, useMemo, useState } from 'react'
import { loadCore, loadSeries, addDays, zoneLabel, modelName } from '../data.js'
import ZonePicker from '../components/ZonePicker.jsx'
import KpiTiles from '../components/KpiTiles.jsx'
import ForecastChart from '../components/ForecastChart.jsx'
import OutlookStrip from '../components/OutlookStrip.jsx'
import StartupPlan from '../components/StartupPlan.jsx'
import AlertsPanel from '../components/AlertsPanel.jsx'
import AccuracyTable from '../components/AccuracyTable.jsx'
import Assumptions from '../components/Assumptions.jsx'
import { lastMeteredDay } from '../schedule.js'

// Default day: the working day with the highest building-wide forecast peak.
function busiestDay(building) {
  let best = null, bestVal = -1
  building.t.forEach((t, i) => {
    if (building.forecast[i] > bestVal) { bestVal = building.forecast[i]; best = t.slice(0, 10) }
  })
  return best
}

export default function ForecastPage() {
  const [core, setCore] = useState(null)
  const [error, setError] = useState(null)
  const [zoneId, setZoneId] = useState('F3_Z1')
  const [date, setDate] = useState(null)
  const [view, setView] = useState('day')
  const [compare, setCompare] = useState(null)
  const [series, setSeries] = useState(null)

  useEffect(() => {
    loadCore().then((c) => {
      setCore(c)
      setDate(busiestDay(c.building))
      setCompare(c.meta.reference_baseline)
    }).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    setSeries(null)
    loadSeries(zoneId).then(setSeries).catch((e) => setError(e.message))
  }, [zoneId])

  const dailyByZone = useMemo(() => {
    if (!core) return {}
    const m = {}
    for (const d of core.daily) (m[d.zone] ??= {})[d.date] = d
    return m
  }, [core])

  if (error) return <main className="page"><div className="loading">{error}</div></main>
  if (!core || !date) return <main className="page"><div className="loading">Loading forecasts…</div></main>

  const { meta, metrics, daily, alerts, building, schedule } = core
  const { start, end } = meta.period
  const model = meta.primary_model           // LightGBM · M4, the team's model
  const baselines = meta.models.filter((m) => m.kind === 'baseline').map((m) => m.id)
  const span = view === 'day' ? 1 : 7

  const goto = (z, d) => { if (z) setZoneId(z); if (d) setDate(d) }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>AC demand forecast: {zoneLabel(zoneId)}</h1>
          <p>LightGBM (M4) day-ahead forecast vs actual, Jul–Sep 2018 test period.</p>
        </div>
      </div>

      <div className="layout">
        <div className="main-col">
          <section className="panel controls-panel">
            <div className="controls">
              <ZonePicker zones={meta.zones} value={zoneId} onChange={setZoneId} />
              <div className="field">
                <label>Day</label>
                <div className="date-row">
                  <button className="btn" disabled={date <= start} onClick={() => setDate(addDays(date, -1))}>‹</button>
                  <input type="date" value={date} min={start} max={end} onChange={(e) => e.target.value && setDate(e.target.value)} />
                  <button className="btn" disabled={date >= end} onClick={() => setDate(addDays(date, 1))}>›</button>
                </div>
              </div>
              <div className="field">
                <label>View</label>
                <div className="seg">
                  <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>Next day</button>
                  <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>7 days</button>
                </div>
              </div>
              <div className="field">
                <label>Model</label>
                <div className="model-tag"><b>LightGBM</b> · feature set M4</div>
              </div>
              <div className="field">
                <label>Compare with</label>
                <select value={compare} onChange={(e) => setCompare(e.target.value)}>
                  {baselines.map((m) => <option key={m} value={m}>{modelName(m)}</option>)}
                </select>
              </div>
            </div>
          </section>

          <KpiTiles zoneMetrics={metrics.by_zone[zoneId]} model={model} compare={compare} />

          <ForecastChart series={series} date={date} span={span} model={model} compare={compare}
                         alerts={alerts.filter((a) => a.zone === zoneId)} bandFor={meta.primary_model}
                         bandRule={meta.rules.band} />

          <OutlookStrip days={dailyByZone[zoneId] ?? {}} date={date} onPick={setDate} />

          <StartupPlan daily={daily} building={building} date={date} schedule={schedule}
                       seenDay={lastMeteredDay(schedule, date)} showActual />

          <AccuracyTable metrics={metrics} zones={meta.zones} model={model} compare={compare}
                         selected={zoneId} onPick={setZoneId} />

          <Assumptions meta={meta} />
        </div>

        <aside className="side-col">
          <AlertsPanel alerts={alerts} date={date} span={span} zoneId={zoneId}
                       rule={meta.rules.deviation} onPick={goto} />
        </aside>
      </div>
    </main>
  )
}
