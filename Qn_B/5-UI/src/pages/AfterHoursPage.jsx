import { useEffect, useMemo, useRef, useState } from 'react'
import { API_DOWN, clock, minuteOf, stamp, useApi } from '../qnaApi.js'
import { addDays } from '../data.js'
import BuildingExplorer from '../components/qn_a/BuildingExplorer.jsx'
import LoadProfileChart from '../components/qn_a/LoadProfileChart.jsx'
import StatusKey from '../components/qn_a/StatusKey.jsx'
import TimeControl, { INCIDENT } from '../components/qn_a/TimeControl.jsx'
import AlertsSidebar from '../components/qn_a/AlertsSidebar.jsx'
import { bindQaBuilding, emitEventSelect } from '../qaBuilding.js'
import { isAfterHours, nextAfterHours, prevAfterHours } from '../components/qn_a/afterHours.js'

// Replay speed, in ms per step: the 1-minute step shows one data minute every 2 seconds, so each change can be followed by eye.
const TICK_MS = { 1: 2000, 5: 1500, 15: 3000 }

// Question A: where and when does the building use energy after hours?
// Minute-level data comes from Qn_A/api (Parquet in dashboard_data/, never sent to the browser whole).
export default function AfterHoursPage() {
  const meta = useApi('meta', {})
  const [date, setDate] = useState(INCIDENT.date)
  const [minute, setMinute] = useState(INCIDENT.minute)
  const [playing, setPlaying] = useState(false)
  const [step, setStep] = useState(1)
  const [alertId, setAlertId] = useState(null)
  const [focus, setFocus] = useState(null)
  // After-hours filter: the replay only visits Mon-Fri 17:01-07:59 and weekends, public holidays skipped (afterHours.js).
  const [afterOnly, setAfterOnly] = useState(true)
  const holidays = useMemo(() => new Set(meta.data?.holidays ?? []), [meta.data])
  const lo = meta.data?.date_min, hi = meta.data?.date_max
  // Move to a time, snapping into after-hours when the filter is on. `dir` is which way the user was heading.
  const goTo = (d, m, dir = 1, only = afterOnly) => {
    let t = { date: d, minute: m }
    if (only && !isAfterHours(d, m, holidays)) {
      t = (dir >= 0 ? nextAfterHours(d, m, holidays, hi) : prevAfterHours(d, m, holidays, lo))
        ?? (dir >= 0 ? prevAfterHours(d, m, holidays, lo) : nextAfterHours(d, m, holidays, hi)) ?? t
    }
    setDate(t.date)
    setMinute(t.minute)
  }
  // Which alert rule the minute data is read under. null = whatever the API defaults to (see Qn_A/api/rules.py).
  // The switch in the replay panel flips it between the new rule (sd) and the original stored P99 rule.
  const [rulePick, setRulePick] = useState(null)
  const rules = meta.data?.rules
  const ruleId = rulePick ?? rules?.default ?? 'p99'
  const ruleInfo = rules?.[ruleId]

  // Clicking an alert moves the replay to the alert's peak minute and points the chart at its zone and load.
  // The chart shows one date, so the window is the part of the alert on its peak day, plus half an hour either side.
  const pickAlert = (a) => {
    const day = a.peak_at.slice(0, 10)
    const from = a.start.slice(0, 10) === day ? minuteOf(a.start.slice(11, 16)) : 0
    const to = a.end.slice(0, 10) === day ? minuteOf(a.end.slice(11, 16)) : 1439
    setPlaying(false)
    emitEventSelect(a)
    setAlertId(a.id)
    if (!isAfterHours(day, minuteOf(a.peak_at.slice(11, 16)), holidays)) setAfterOnly(false) // e.g. a peak at exactly 17:00
    setDate(day)
    setMinute(minuteOf(a.peak_at.slice(11, 16)))
    setFocus({ floor: a.floor, zone: a.zone, endUse: a.end_use, start: clock(Math.max(0, from - 30)), end: clock(Math.min(1439, to + 30)) })
  }

  const when = stamp(date, minute)

  // window.QA_BUILDING (see src/qaBuilding.js): lets other parts of the app set the time or pick an alert.
  const live = useRef({})
  live.current = { meta: meta.data, when, pickAlert, holidays }
  useEffect(() => bindQaBuilding({
    getTime: () => live.current.when,
    selectEvent: (a) => live.current.pickAlert(a),
    setTime: (ts) => {
      const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})$/.exec(String(ts))
      const lo = live.current.meta?.date_min, hi = live.current.meta?.date_max
      if (!m || +m[2] > 23 || +m[3] > 59 || (lo && m[1] < lo) || (hi && m[1] > hi)) return false
      setPlaying(false)
      if (!isAfterHours(m[1], +m[2] * 60 + +m[3], live.current.holidays)) setAfterOnly(false)
      setDate(m[1])
      setMinute(+m[2] * 60 + +m[3])
      return true
    },
  }), [])
  const snap = useApi('snapshot', { timestamp: when, rule: ruleId }, { enabled: !!meta.data, debounce: playing ? 0 : 60 })

  // Replay: one step every TICK_MS, slow enough to talk through. At 23:59 it carries on into 00:00 of the next day
  // (after-hours runs overnight), and only stops at the last day of data.
  const pos = useRef({})
  pos.current = { date, minute, hi: meta.data?.date_max, afterOnly, holidays }
  useEffect(() => {
    if (!playing) return undefined
    const id = setInterval(() => {
      const { date: d, minute: m, hi, afterOnly: only, holidays: hol } = pos.current
      let nd = d, nm = m + step
      if (nm > 1439) { nd = addDays(d, 1); nm -= 1440 }
      if (only) {
        // daytime and public holidays are skipped: jump straight to the next after-hours minute (23:59 flows into 00:00)
        const t = nextAfterHours(nd, nm, hol, hi)
        if (!t) { setPlaying(false); return }
        nd = t.date; nm = t.minute
      } else if (hi && nd > hi) { setPlaying(false); setMinute(1439); return }
      setDate(nd)
      setMinute(nm)
    }, TICK_MS[step] ?? 1500)
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
      <div className="layout">
      <div className="main-col">
        <TimeControl meta={meta.data} date={date} minute={minute} holidays={holidays}
                     afterOnly={afterOnly} onAfterOnly={(v) => { setAfterOnly(v); if (v) goTo(date, minute, 1, true) }}
                     onDate={(d, dir) => goTo(d, minute, dir)} onMinute={(m) => goTo(date, m, m >= minute ? 1 : -1)}
                     playing={playing} onPlaying={setPlaying} step={step} onStep={setStep} busy={snap.loading}
                     rules={rules} ruleId={ruleId} onRule={setRulePick} onJump={goTo} />

        <BuildingExplorer holidays={holidays} playing={playing} onPlaying={setPlaying} rows={snap.data?.rows ?? null} when={when.replace('T', ' ')} error={snap.error} loading={snap.loading} />

        <LoadProfileChart meta={meta.data} date={date} minute={minute} focus={focus} rule={ruleId} />

        <section className="panel assumptions qa-notes">
          <div className="panel-head"><h2>How to read this page</h2></div>
          <StatusKey ruleInfo={ruleInfo} />
          <ul>
            <li><b>Red means investigate</b>, not a confirmed fault, waste or savings. Say "above threshold", not "waste".</li>
            <li><b>No data (violet) is not "normal".</b> It means a reading is missing, has too little history for a threshold, or was excluded.</li>
            {ruleId === 'sd' ? (
              <li>Thresholds are each zone and end use's own median plus 3 standard deviations for the matching weekday and hour, frozen from the
                preceding 56 days, and never less than 0.5 kW above the median, so a near-constant load cannot alert on a trivial change.
                Amber is {ruleInfo?.red_min ? `1 to ${ruleInfo.red_min - 1}` : 'a few'} minutes above, red is {ruleInfo?.red_min ?? 15} or more.
                July and August 2018 are warm-up months. Switch to "Original (P99)" above to compare.</li>
            ) : (
              <li>Thresholds are each zone and end use's own P99 for the matching weekday and hour, frozen from the preceding 56 days.
                July and August 2018 are warm-up months. There is no minimum increase, so a tiny threshold can give a trivial alert.</li>
            )}
            <li>Times are Bangkok local time. Gaps in a chart are missing minutes, never zero.</li>
            <li>Floor 1 has no sensor, Floors 1–2 use the four-zone plan and Floors 3–7 the five-zone plan, and Zone 3 on Floors 3–7 is a staircase with no AC.
              Floor 6's record ends in October 2019: the missing tail is unavailable, not zero.</li>
            <li>Without occupancy or schedule data, high after-hours load is a lead to check, not a finding.</li>
          </ul>
        </section>
      </div>
      <aside className="side-col">
        {/* The sidebar follows the replay clock: it only shows alerts known by `when`. */}
        <AlertsSidebar selectedId={alertId} onPick={pickAlert} now={when} rows={snap.data?.rows ?? null} playing={playing}
                       onSetTime={(ts) => { setPlaying(false); setDate(ts.slice(0, 10)); setMinute(minuteOf(ts.slice(11, 16))) }} />
      </aside>
      </div>
    </main>
  )
}
