import { useEffect, useState } from 'react'
import { API_DOWN, stamp, useApi } from '../qnaApi.js'
import BuildingExplorer from '../components/qn_a/BuildingExplorer.jsx'
import LoadProfileChart from '../components/qn_a/LoadProfileChart.jsx'
import StatusKey from '../components/qn_a/StatusKey.jsx'
import TimeControl, { INCIDENT } from '../components/qn_a/TimeControl.jsx'

// Question A: where and when does the building use energy after hours?
// Minute-level data comes from Qn_A/api (Parquet in dashboard_data/, never sent to the browser whole).
export default function AfterHoursPage() {
  const meta = useApi('meta', {})
  const [date, setDate] = useState(INCIDENT.date)
  const [minute, setMinute] = useState(INCIDENT.minute)
  const [playing, setPlaying] = useState(false)
  const [step, setStep] = useState(1)

  const when = stamp(date, minute)
  const snap = useApi('snapshot', { timestamp: when }, { enabled: !!meta.data, debounce: playing ? 0 : 60 })

  useEffect(() => {
    if (!playing) return undefined
    const id = setInterval(() => {
      setMinute((m) => {
        if (m + step > 1439) { setPlaying(false); return 1439 }
        return m + step
      })
    }, 400)
    return () => clearInterval(id)
  }, [playing, step])

  const head = (
    <div className="page-head">
      <div>
        <h1>After-hours energy</h1>
        <p>Where and when does the building use energy after hours, and what should facility management check first?
          CU-BEMS Floors 1–7, minute readings.</p>
      </div>
    </div>
  )

  if (meta.error) {
    return (
      <main className="page">
        {head}
        <div className="qa-error" role="alert">
          {meta.error === API_DOWN
            ? <>The minute-data API is not running. From the repo root run <code>cd Qn_A/api &amp;&amp; uvicorn app:app --port 8000</code>, then reload. Setup is in <code>Qn_A/README.md</code>.</>
            : meta.error}
        </div>
      </main>
    )
  }
  if (!meta.data) return <main className="page">{head}<div className="loading">Loading minute data…</div></main>

  return (
    <main className="page">
      {head}
      <div className="main-col">
        <TimeControl meta={meta.data} date={date} minute={minute} onDate={setDate} onMinute={setMinute}
                     playing={playing} onPlaying={setPlaying} step={step} onStep={setStep} busy={snap.loading} />

        <BuildingExplorer rows={snap.data?.rows ?? null} when={when.replace('T', ' ')} error={snap.error} loading={snap.loading} />

        <LoadProfileChart meta={meta.data} date={date} minute={minute} />

        <section className="panel assumptions qa-notes">
          <div className="panel-head"><h2>How to read this page</h2></div>
          <StatusKey />
          <ul>
            <li><b>Red means investigate</b>, not a confirmed fault, waste or savings. Say "above threshold", not "waste".</li>
            <li><b>Grey and neutral are not "normal".</b> Grey means a reading is missing, has too little history for a threshold, or was excluded.
              Neutral means the minute is outside the after-hours alert schedule (weekdays before 08:00 or from 17:00, and weekends, excluding public holidays).</li>
            <li>Thresholds are each zone and end use's own P99 for the matching weekday and hour, frozen from the preceding 56 days.
              July and August 2018 are warm-up months. There is no minimum increase, so a tiny threshold can give a trivial alert.</li>
            <li>Times are Bangkok local time. Gaps in a chart are missing minutes, never zero.</li>
            <li>Floor 1 has no sensor, Floors 1–2 use the four-zone plan and Floors 3–7 the five-zone plan, and Zone 3 on Floors 3–7 is a staircase with no AC.
              Floor 6's record ends in October 2019: the missing tail is unavailable, not zero.</li>
            <li>Without occupancy or schedule data, high after-hours load is a lead to check, not a finding.</li>
          </ul>
        </section>
      </div>
    </main>
  )
}
