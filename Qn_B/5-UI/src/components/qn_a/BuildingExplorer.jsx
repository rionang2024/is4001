// Building explorer: an isometric building with a kW label per floor; click a floor for its 3D plan.
// Ported from the Question A prototype and driven by a minute snapshot from the API.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LOAD_NAME, LOADS, kw } from '../../qnaApi.js'
import { BuildingSVG, G, floorMidY } from './BuildingArt.jsx'
import FloorPlan from './FloorPlan.jsx'
import LoadSwitches from './LoadSwitches.jsx'
import StatusKey from './StatusKey.jsx'
import { AnomalyNow, STATE_ICON } from './AnomalyNow.jsx'
import { floorAnomaly, useAlerts } from './anomaly.js'
import { FLOORS, floorStats, indexSnapshot } from './explorerModel.js'
import './explorer.css'
import './qn_a.css'
import './anomaly.css'

const ALL_ON = { AC: true, Lighting: true, Plug: true }
const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Counts up to the new value, so a switch or a replay step reads as a change rather than a jump.
function AnimatedNumber({ value }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (value == null || from.current == null || reduce) { setShown(value); from.current = value; return undefined }
    const a = from.current, b = value, t0 = performance.now()
    let raf
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 450), e = 1 - (1 - p) ** 3
      from.current = a + (b - a) * e
      setShown(from.current)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{shown == null ? '–' : kw(shown)}</>
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

const RATIO_TEXT = { red: (c) => `${c.red} red`, amber: (c) => `${c.amber} amber` }
const labelText = (s) => {
  if (!s.has) return s.worst ? 'no data' : ''
  if (s.partial) return 'partial'
  return (RATIO_TEXT[s.worst]?.(s.counts)) ?? s.worst
}

export default function BuildingExplorer({ rows, when, error, loading }) {
  const [on, setOn] = useState({ AC: true, Lighting: true, Plug: true })
  const [justOn, setJustOn] = useState(null)
  const [floor, setFloor] = useState(null)         // the open floor, or null for the building view
  const [lastFloor, setLastFloor] = useState(null) // kept so the plan fades out with its content
  const [hover, setHover] = useState(null)
  const [introTick, setIntroTick] = useState(0)
  const [origin, setOrigin] = useState({ x: '50%', y: '50%' })
  const [stageH, setStageH] = useState(null)
  const narrow = useNarrow()

  const stageRef = useRef(null), buildingRef = useRef(null), planRef = useRef(null), backRef = useRef(null)
  const labelRefs = useRef({})
  const isPlan = floor !== null
  const wasPlan = useRef(false)
  const lastRef = useRef(null)
  lastRef.current = lastFloor

  const idx = indexSnapshot(rows)
  const alerts = useAlerts()
  const stats = {}, anom = {}
  FLOORS.forEach((f) => { stats[f] = floorStats(idx, f, on); anom[f] = floorAnomaly(idx, f, on, when, alerts) })
  // brightness and bars use a scale fixed with all loads counted, so switching a load off visibly dims the floors
  const max = Math.max(1, ...FLOORS.map((f) => floorStats(idx, f, ALL_ON).kw))
  const none = LOADS.every((l) => !on[l])
  const glow = {}, beacon = {}
  FLOORS.forEach((f) => {
    const s = stats[f]
    glow[f] = s.has && !none ? Math.min(1, 0.08 + (s.kw / max) ** 0.42 * 0.92) : 0
    beacon[f] = s.counts.red > 0
  })

  const openFloor = (f, src) => {
    if (floor === f) return
    if (!isPlan) {
      const sr = stageRef.current.getBoundingClientRect()
      const r = (src ?? buildingRef.current).getBoundingClientRect()
      setOrigin({ x: `${r.left + r.width / 2 - sr.left}px`, y: `${r.top + r.height / 2 - sr.top}px` })
      setStageH(buildingRef.current.offsetHeight)
      setIntroTick((t) => t + 1)
    }
    setFloor(f)
    setLastFloor(f)
  }
  const closePlan = () => {
    if (!isPlan) return
    setStageH(planRef.current.offsetHeight)
    setFloor(null)
  }

  // grow or shrink the stage to the layer on show; the height animates between the two
  useLayoutEffect(() => {
    if (isPlan === wasPlan.current) return undefined
    wasPlan.current = isPlan
    let timer
    const raf = requestAnimationFrame(() => {
      if (isPlan) {
        setStageH(planRef.current.offsetHeight)
        timer = setTimeout(() => backRef.current?.focus({ preventScroll: true }), reduce ? 0 : 600)
      } else {
        setStageH(buildingRef.current.offsetHeight)
        timer = setTimeout(() => {
          setStageH(null)
          labelRefs.current[lastRef.current]?.focus({ preventScroll: true })
        }, reduce ? 20 : 650)
      }
    })
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [isPlan])

  // the plan's height follows its content (switches change the table, the viewport changes the scene)
  useEffect(() => {
    const el = planRef.current
    if (!el || !('ResizeObserver' in window)) return undefined
    const ro = new ResizeObserver(() => { if (isPlan) setStageH(el.offsetHeight) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isPlan])

  useEffect(() => {
    const onKey = (e) => {
      const root = stageRef.current?.closest('.qa-ex')
      if (e.key === 'Escape' && isPlan && root && (root.contains(document.activeElement) || document.activeElement === document.body)) closePlan()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const toggle = (e) => {
    const next = !on[e]
    setOn((o) => ({ ...o, [e]: next }))
    setJustOn(next ? e : null)
  }

  return (
    <section className="qa-ex panel" aria-labelledby="ex-title">
      <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true" focusable="false">
        <defs>
          <symbol id="qa-ico-ac" viewBox="0 0 16 16"><rect x="1" y="2.5" width="14" height="6" rx="2" fill="currentColor" /><path d="M3 12c2-1.6 3 1.6 5 0s3 1.6 5 0" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" /></symbol>
          <symbol id="qa-ico-light" viewBox="0 0 16 16"><path d="M8 1.2a4.6 4.6 0 0 0-2.7 8.3c.5.4.8.9.8 1.5v.8h3.8V11c0-.6.3-1.1.8-1.5A4.6 4.6 0 0 0 8 1.2z" fill="currentColor" /><rect x="6.2" y="13" width="3.6" height="1.7" rx=".85" fill="currentColor" /></symbol>
          <symbol id="qa-ico-plug" viewBox="0 0 16 16"><path d="M5.2 1v4M10.8 1v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M3.5 5h9v3a4.5 4.5 0 0 1-9 0z" fill="currentColor" /><path d="M8 12.4V15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></symbol>
        </defs>
      </svg>

      <header className="ex-head">
        <div>
          <h2 id="ex-title">Building explorer</h2>
          <p>Each floor shows the load at the chosen minute. Click a floor to open its plan with the zones, and use the switches to choose which loads are counted.</p>
        </div>
      </header>

      <div className="ex-controls">
        <LoadSwitches on={on} onToggle={toggle} justOn={justOn} />
      </div>
      <p className="ex-sub">
        Sum of the switched-on loads ({LOADS.filter((l) => on[l]).map((l) => LOAD_NAME[l]).join(', ') || 'none'}), kW, at {when} (Bangkok time).
        Window brightness shows each floor's load. The dot beside a floor is the worst status among its loads; grey and neutral mean not confirmed normal.
      </p>
      <p className="ex-hint" role="status">
        {error ?? (none ? 'Turn on at least one load type to see values.' : loading && !rows ? 'Loading…' : '')}
      </p>

      <AnomalyNow anom={anom} floors={FLOORS} when={when} onOpen={(f) => openFloor(f, stageRef.current.querySelector(`.floor[data-floor="${f}"]`))} />

      <div ref={stageRef} className={`ex-stage${isPlan ? ' is-plan' : ''}`}
           style={{ '--ox': origin.x, '--oy': origin.y, ...(stageH != null ? { height: stageH } : {}) }}>
        <div className="ex-building" ref={buildingRef} inert={isPlan ? '' : undefined}>
          <div className="ex-canvas">
            <BuildingSVG glow={glow} beacon={beacon} anom={anom} hover={hover} selected={floor} narrow={narrow}
                         onHover={setHover} onOpen={openFloor} />
            <div className="ex-labels">
              {[...FLOORS].reverse().map((j, i) => {
                const s = stats[j]
                const worst = s.worst ?? 'none'
                return (
                  <button key={j} type="button" ref={(el) => { labelRefs.current[j] = el }}
                          className={`fl anom-${anom[j].state}${s.counts.red ? ' flagged' : ''}${!s.has ? ' empty' : ''}${hover === j ? ' hl' : ''}`}
                          style={{ '--t': `${((floorMidY(j) / G.VH) * 100).toFixed(2)}%`, '--i': i }}
                          aria-label={`${anom[j].summary ? anom[j].summary.replace(/\n/g, '. ') : `Floor ${j}`}, open floor plan`}
                          title={!s.has ? 'No reading for the selected loads' : `${anom[j].summary ? `${anom[j].summary}\n\n` : ''}${kw(s.kw)} kW at ${when}. ${s.counts.red} red, ${s.counts.amber} amber, ${s.counts.grey} grey, ${s.counts.neutral} neutral, ${s.counts.green} green.`}
                          onMouseEnter={() => setHover(j)} onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover(j)} onBlur={() => setHover(null)}
                          onClick={(e) => openFloor(j, e.currentTarget.closest('.ex-canvas').querySelector(`.floor[data-floor="${j}"]`))}>
                    <span className="fl-n">Floor {j}</span>
                    <span className="fl-v"><b>{s.has && !none ? <AnimatedNumber value={s.kw} /> : '–'}</b> <small>kW</small></span>
                    <span className="fl-r">{none ? '' : <>{STATE_ICON[anom[j].state] && <span className="qa-ico" aria-hidden="true">{STATE_ICON[anom[j].state]} </span>}{labelText(s)}</>}</span>
                    <span className="fl-bar"><i style={{ '--w': s.has ? (s.kw / max).toFixed(3) : 0 }} /></span>
                    <span className={`fl-flag ${none ? 'none' : worst}`} />
                  </button>
                )
              })}
            </div>
          </div>
          <div className="ex-legend">
            <span><i />Window brightness: less to more kW</span>
            <StatusKey compact />
            <span>Click a floor or its label to open the plan</span>
          </div>
        </div>
        <div className="ex-plan" ref={planRef} inert={isPlan ? undefined : ''}>
          {lastFloor !== null && (
            <FloorPlan floor={lastFloor} when={when} rows={rows} on={on} introTick={introTick} active={isPlan}
                       backRef={backRef} onBack={closePlan} onFloor={(f) => { setFloor(f); setLastFloor(f) }} />
          )}
        </div>
      </div>
    </section>
  )
}
