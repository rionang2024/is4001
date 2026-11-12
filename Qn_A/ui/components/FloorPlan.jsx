// One floor as a CSS-3D model: a block per zone, height = kW of the switched-on loads, with an upright card per zone.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { GROUP_LABEL, LOADS, LOAD_NAME, kw, reasonText, statusGroup } from '../qnaApi.js'
import { FLOORS, indexSnapshot, maxZoneTotal, num, planOf, zoneState } from './explorerModel.js'
import { BreachList } from './AnomalyNow.jsx'
import { breachText, floorAnomaly, useAlerts } from './anomaly.js'

const PW = 580, PH = 380                // plan size in px
const NOM = 100                         // nominal wall height; each zone is scaled in Z to its real height
const DEF = { rx: 66, rz: -16 }         // default camera tilt and turn, in degrees
const ISO = { rx: 54.7, rz: -45 }       // the building's isometric angle: the floor swings in from here
const ICON = { AC: '#qa-ico-ac', Lighting: '#qa-ico-light', Plug: '#qa-ico-plug' }
const COLOR = { AC: 'var(--eu-ac)', Lighting: 'var(--eu-light)', Plug: 'var(--eu-plug)' }
const ALL_ON = { AC: true, Lighting: true, Plug: true }
const ZONE_FILL = { 1: 'var(--z1)', 2: 'var(--z2)', 3: 'var(--z3)', 4: 'var(--z4)', 5: 'var(--z5)' }

const shrink = (pts, k = 0.985) => {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length
  return pts.map((p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k])
}
const dPath = (pts) => 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L') + ' Z'

function Wall({ a, b, cls = 'w' }) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  return <i className={cls} style={{ left: a[0], top: a[1], width: Math.hypot(dx, dy),
    transform: `rotateZ(${(Math.atan2(dy, dx) * 180) / Math.PI}deg) rotateX(90deg)` }} />
}

const rowTip = (zone, e, r) => {
  const reason = reasonText(r.status_reason)
  const head = `Zone ${zone}, ${LOAD_NAME[e]}: ${num(r.power_kw) ? `${kw(r.power_kw)} kW` : 'no reading'}`
  return `${head}. Status ${r.status}${reason ? `: ${reason}` : ''}`
}

// Status marker used in cards: filled for green/amber/red/grey, hollow for neutral so it never reads as "passed".
function StatusDot({ status, cx, cy }) {
  const g = statusGroup(status)
  return g === 'neutral'
    ? <circle className="sdot neutral" cx={cx} cy={cy} r="4" />
    : <circle className={`sdot ${g}`} cx={cx} cy={cy} r="4" />
}

function Card({ zone, zs, maxLoad }) {
  const w = 140, ox = 9, oy = 7, P = 19, n = zs.rows.length
  const h = oy + 22 + n * P + (n > 1 ? P : 0) + 8
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
      <rect className="bgc" x="0" y="0" width={w} height={h} rx="8" />
      <text className="znm" x={ox} y={oy + 12}>Zone {zone}</text>
      {(zs.worst === 'red' || zs.worst === 'amber') && (
        <g className={`pill ${zs.worst}`}>
          <rect x={w - ox - 62} y={oy - 1} width="62" height="17" rx="8.5" />
          <text x={w - ox - 31} y={oy + 11.5} textAnchor="middle">{zs.worst === 'red' ? '▲ CHECK' : '◆ WATCH'}</text>
        </g>
      )}
      {zs.rows.map((row, i) => {
        const y = oy + 20 + i * P
        const icon = <use href={ICON[row.e]} x={ox} y={y} width="14" height="14" style={{ color: COLOR[row.e] }} />
        if (row.state === 'none') return <g key={row.e}>{icon}<text className="rn" x={ox + 19} y={y + 11}>no meter</text></g>
        const g = statusGroup(row.r.status)
        if (row.state === 'nodata') {
          return (
            <g key={row.e}><title>{rowTip(zone, row.e, row.r)}</title>{icon}
              <text className="rn" x={ox + 19} y={y + 11}>no data</text>
              <StatusDot status={row.r.status} cx={w - ox - 4} cy={y + 7} />
            </g>
          )
        }
        const bw = Math.max(1.5, Math.min(1, row.r.power_kw / maxLoad) * 28)
        const fill = g === 'red' ? 'var(--st-red)' : g === 'amber' ? 'var(--st-amber)' : COLOR[row.e]
        return (
          <g key={row.e}><title>{rowTip(zone, row.e, row.r)}</title>{icon}
            <rect className="trk" x={ox + 18} y={y + 3.5} width="28" height="7" rx="3.5" />
            <rect className="bar" x={ox + 18} y={y + 3.5} width={bw} height="7" rx="3.5" fill={fill} />
            <StatusDot status={row.r.status} cx={ox + 56} cy={y + 7} />
            <text className={`rv${g === 'red' ? ' br' : g === 'amber' ? ' ba' : ''}`} x={w - ox} y={y + 11} textAnchor="end">{kw(row.r.power_kw)} <tspan className="rk">kW</tspan></text>
          </g>
        )
      })}
      {n > 1 && (
        <>
          <line x1={ox} x2={w - ox} y1={oy + 18 + n * P} y2={oy + 18 + n * P} stroke="rgba(27,36,48,0.35)" />
          <text className="rv tot" x={ox} y={oy + 31 + n * P}>Total{zs.partial ? '*' : ''}</text>
          <text className="rv tot" x={w - ox} y={oy + 31 + n * P} textAnchor="end">{zs.n ? kw(zs.tot) : '–'} <tspan className="rk">kW</tspan></text>
        </>
      )}
    </svg>
  )
}

export default function FloorPlan({ floor, when, rows, on, introTick, active, onBack, onFloor, backRef, focusZone = null }) {
  const plan = planOf(floor)
  const idx = indexSnapshot(rows)
  const hasData = (rows ?? []).some((r) => r.floor === floor)
  const alerts = useAlerts()
  const an = floorAnomaly(idx, floor, on, when, alerts)
  // one scale for every floor, fixed with all loads counted, so switching a load off visibly shrinks the blocks
  const maxTot = maxZoneTotal(idx, ALL_ON)
  const maxLoad = Math.max(10, ...(rows ?? []).filter((r) => r.end_use !== 'All' && num(r.power_kw)).map((r) => r.power_kw))

  const [flat, setFlat] = useState(false)
  const [cam, setCam] = useState(DEF)
  const [intro, setIntro] = useState(introTick > 0)
  const [raised, setRaised] = useState(false)
  const [drag, setDrag] = useState(false)
  const [sceneW, setSceneW] = useState(900)
  const sceneRef = useRef(null)

  // swing in from the building's own angle when opened from the building view
  useLayoutEffect(() => { if (introTick) setIntro(true) }, [introTick])
  useEffect(() => {
    let b
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setIntro(false)) })
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b) }
  }, [introTick])

  // the blocks start flat and rise, so each opened floor animates in
  useLayoutEffect(() => { if (active) setRaised(false) }, [floor, introTick, active])
  useEffect(() => {
    if (!active) return undefined
    let b
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setRaised(true)) })
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b) }
  }, [floor, introTick, active])

  useEffect(() => {
    const el = sceneRef.current
    if (!el || !('ResizeObserver' in window)) return undefined
    const ro = new ResizeObserver(() => setSceneW(el.clientWidth || 900))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const small = sceneW < 520
  const sceneH = Math.round(Math.min(660, Math.max(small ? 320 : 390, sceneW * (small ? 0.9 : 0.62))))
  const sc = Math.max(0.36, Math.min(1.55, sceneW / (flat ? 620 : small ? 660 : 790))) * (intro ? 0.55 : 1)
  const target = intro ? ISO : flat ? { rx: 0, rz: 0 } : cam

  const dragRef = useRef(null)
  const onDown = (e) => {
    dragRef.current = { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(true)
  }
  const onMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    d.x = e.clientX; d.y = e.clientY
    if (flat) { setFlat(false); setCam({ rx: DEF.rx, rz: cam.rz }) }
    setCam((c) => ({ rz: c.rz + dx * 0.4, rx: d.touch ? c.rx : Math.max(32, Math.min(72, c.rx - dy * 0.3)) }))
  }
  const onUp = () => { dragRef.current = null; setDrag(false) }
  const turn = (deg) => { setFlat(false); setCam((c) => ({ ...c, rz: c.rz + deg })) }

  // totals for the header
  const stat = { kw: 0, has: false, red: 0, amber: 0, grey: 0, neutral: 0 }
  Object.keys(plan.zones).forEach((z) => {
    const zs = zoneState(idx, floor, Number(z), on)
    if (zs.n) { stat.has = true; stat.kw += zs.tot }
    zs.rows.forEach((r) => { if (r.state !== 'none') stat[statusGroup(r.r.status)] = (stat[statusGroup(r.r.status)] ?? 0) + 1 })
  })
  const eus = LOADS.filter((l) => on[l])
  const anyPartial = Object.keys(plan.zones).some((z) => zoneState(idx, floor, Number(z), on).partial)

  return (
    <>
      <div className="plan-top">
        <button type="button" className="plan-back" id="ex-back" ref={backRef} onClick={onBack}>← Building</button>
        <div>
          <h3 className="plan-title">Floor {floor}</h3>
          <p className="plan-sub">{plan.title}. Load at {when}.</p>
        </div>
        <div className="ftabs" role="group" aria-label="Switch floor">
          {[...FLOORS].reverse().map((j) => (
            <button key={j} type="button" className="ftab" aria-current={j === floor ? 'true' : undefined} onClick={() => onFloor(j)}>F{j}</button>
          ))}
        </div>
      </div>

      <dl className="plan-stats">
        <div><dt>Selected loads</dt><dd>{stat.has ? <>{kw(stat.kw)} <small>kW</small></> : '–'}</dd></div>
        <div><dt>Red</dt><dd>{stat.red}</dd></div>
        <div><dt>Amber</dt><dd>{stat.amber}</dd></div>
        <div><dt>No data</dt><dd>{stat.grey}</dd></div>
      </dl>

      <BreachList an={an} floor={floor} when={when} />

      <div className="viewbar">
        <div className="seg" role="group" aria-label="View">
          <button type="button" className={!flat ? 'on' : ''} aria-pressed={!flat} onClick={() => setFlat(false)}>3D</button>
          <button type="button" className={flat ? 'on' : ''} aria-pressed={flat} onClick={() => setFlat(true)}>Flat plan</button>
        </div>
        <div className="vb-turn" role="group" aria-label="Rotate the floor">
          <button type="button" className="btn" aria-label="Rotate left" onClick={() => turn(30)}>⟲</button>
          <button type="button" className="btn" aria-label="Rotate right" onClick={() => turn(-30)}>⟳</button>
          <button type="button" className="btn" onClick={() => { setFlat(false); setCam(DEF) }}>Reset view</button>
        </div>
        <span className="vb-hint">Drag the floor to rotate it</span>
      </div>

      <div className="plan-scene" ref={sceneRef} style={{ height: sceneH }} role="group"
           aria-label="3D model of the floor, one block per zone"
           onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className={`cam${flat && !intro ? ' flat' : ''}${drag ? ' drag' : ''}`}
             style={{ '--rx': `${target.rx}deg`, '--rz': `${target.rz}deg`, '--sc': sc.toFixed(3), '--cs': flat ? 1 : 0.8 }}>
          <div className="slab" />
          {[[0, 0], [PW, 0], [PW, PH], [0, PH]].map((p, i, a) => <Wall key={i} a={p} b={a[(i + 1) % 4]} cls="w sw" />)}
          {Object.entries(plan.zones).map(([z, def], zi) => {
            const zs = zoneState(idx, floor, Number(z), on)
            const pts = shrink(def.pts)
            const hpx = flat ? 2 : 6 + 132 * Math.sqrt(Math.min(1, zs.tot / maxTot))
            return (
              <div key={z} className={`zp${zs.worst === 'red' ? ' flagged' : zs.worst === 'amber' ? ' warn' : ''}`}
                   style={{ '--zc': ZONE_FILL[z], '--zi': zi, '--k': raised ? (hpx / NOM).toFixed(3) : 0.03 }}>
                {pts.map((p, i) => <Wall key={i} a={p} b={pts[(i + 1) % pts.length]} />)}
                <svg className="tface" viewBox={`0 0 ${PW} ${PH}`}>
                  <path className="tp" d={dPath(pts)}><title>Zone {z}</title></path>
                  {(zs.worst === 'red' || zs.worst === 'amber') && (
                    <>
                      <defs>
                        <pattern id={`qa-hatch-${z}`} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                          <rect width="16" height="16" className={`hatch-a ${zs.worst}`} />
                          <rect width="8" height="16" className={`hatch-b ${zs.worst}`} />
                        </pattern>
                      </defs>
                      <path className={`tp-alert ${zs.worst}`} d={dPath(pts)} fill={`url(#qa-hatch-${z})`} />
                    </>
                  )}
                  {floor !== 1 && def.sensor && <circle className="sensor" cx={def.sensor[0]} cy={def.sensor[1]} r="6"><title>Multi-sensor, approximate location</title></circle>}
                </svg>
              </div>
            )
          })}
          <div className="cp">
            {(() => {
              const [cx, cy, cw, ch] = plan.core
              const cp = [[cx, cy], [cx + cw, cy], [cx + cw, cy + ch], [cx, cy + ch]]
              return (
                <>
                  {cp.map((p, i) => <Wall key={i} a={p} b={cp[(i + 1) % 4]} cls="w cw" />)}
                  <svg className="tface" viewBox={`0 0 ${PW} ${PH}`}>
                    <rect className="core" x={cx} y={cy} width={cw} height={ch} />
                    {[0, 1, 2].map((i) => {
                      const sz = Math.min(cw - 12, 18), y = cy + 14 + i * (sz + 12), x = cx + (cw - sz) / 2
                      return (
                        <g key={i}>
                          <rect className="lift" x={x} y={y} width={sz} height={sz} />
                          <path className="lift" d={`M${x} ${y}L${x + sz} ${y + sz}M${x + sz} ${y}L${x} ${y + sz}`} />
                        </g>
                      )
                    })}
                  </svg>
                </>
              )
            })()}
          </div>
          {Object.entries(plan.zones).map(([z, def]) => {
            const zs = zoneState(idx, floor, Number(z), on)
            const hpx = flat ? 2 : 6 + 132 * Math.sqrt(Math.min(1, zs.tot / maxTot))
            const w = 140, n = zs.rows.length
            const h = 7 + 22 + n * 19 + (n > 1 ? 19 : 0) + 8
            return (
              <div key={z} className={`bill${zs.worst === 'red' ? ' flagged' : zs.worst === 'amber' ? ' warn' : ''}${Number(z) === focusZone ? ' focus' : ''}`}
                   style={{ '--bx': `${def.at[0] + 56}px`, '--by': `${def.at[1] + 52}px`, '--bz': `${raised ? hpx + 3 : 6}px`,
                            width: w, height: h, marginLeft: -w / 2, marginTop: -h }}>
                {eus.length ? <Card zone={z} zs={zs} maxLoad={maxLoad} /> : null}
              </div>
            )
          })}
          {!hasData && <div className="nodata">No data for this floor at this minute</div>}
        </div>
      </div>

      <p className="plan-note">
        {floor !== 1 ? <span><i className="sd" />Approximate multi-sensor location</span> : <span>Floor 1 has no sensor</span>}
        <span>Block height shows the zone's total kW for the switched-on loads, on one scale for every floor, set by all loads at this minute.
          Outline: red = above threshold for 5+ minutes (investigate), amber = 1–4 minutes.</span>
        {anyPartial && <span>* a selected load has no reading, so the total is incomplete.</span>}
        <span>Schematic, after CU-BEMS Fig. 2.</span>
      </p>

      {eus.length > 0 && (
        <div className="table-wrap">
          <table className="plan-table">
            <thead>
              <tr>
                <th scope="col">Zone</th>
                {eus.map((e) => <th key={e} scope="col">{LOAD_NAME[e]} (kW)</th>)}
                {eus.length > 1 && <th scope="col">Total (kW)</th>}
              </tr>
            </thead>
            <tbody>
              {Object.keys(plan.zones).map((z) => {
                const zs = zoneState(idx, floor, Number(z), on)
                return (
                  <tr key={z} className={Number(z) === focusZone ? 'focus' : undefined}>
                    <th scope="row" style={{ textAlign: 'left', fontWeight: 600, color: 'var(--ink)' }}>Zone {z}</th>
                    {zs.rows.map((row) => {
                      if (row.state === 'none') return <td key={row.e} className="none">no meter</td>
                      const g = statusGroup(row.r.status)
                      return (
                        <td key={row.e} className={`st-${g}`} title={rowTip(z, row.e, row.r)}>
                          {row.state === 'nodata' ? <span className="none">no data</span> : kw(row.r.power_kw)}
                          <small className="st-line"><i className={`sdot-h ${g}`} />{GROUP_LABEL[g]}: {reasonText(row.r.status_reason)}</small>
                          {(() => {
                            const p = an.problems.find((q) => q.zone === Number(z) && q.e === row.e)
                            return p && <small className={`qa-breach ${g}`}>{breachText(p)}</small>
                          })()}
                        </td>
                      )
                    })}
                    {eus.length > 1 && <td>{zs.n ? kw(zs.tot) : '–'}{zs.partial ? '*' : ''}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
