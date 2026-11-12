// Load profile for one zone and end use (or floor totals for several floors) over a window of one date.
import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { GROUP_LABEL, LOAD_NAME, STATUS, clock, kw, minuteOf, reasonText, statusGroup, useApi } from '../../qnaApi.js'
import StatusKey from './StatusKey.jsx'

const FLOOR_COLORS = ['#4c8fd6', '#3aa07f', '#d08a3a', '#9b7fd1', '#d9694f', '#7fb24a', '#8f98a3']
const GROUP_FILL = { green: 'var(--st-green)', amber: 'var(--st-amber)', red: 'var(--st-red)', grey: 'var(--st-grey)', neutral: 'var(--st-neutral)' }
const toMinute = (ts) => minuteOf(ts.slice(11, 16))

// One row per minute of the window: a minute with no row stays empty so the line breaks there (gaps stay gaps).
function fill(start, end, byMinute) {
  const out = []
  for (let m = start; m <= end; m++) out.push(byMinute.get(m) ?? { m })
  return out
}

function Marker({ cx, cy, payload, dense }) {
  if (payload.power == null || cx == null || cy == null) return null
  const g = statusGroup(payload.status)
  const r = dense ? 2.2 : 4.5
  return g === 'neutral'
    ? <circle key={payload.m} cx={cx} cy={cy} r={r} fill="var(--panel)" stroke={GROUP_FILL.neutral} strokeWidth={dense ? 1.2 : 2} />
    : <circle key={payload.m} cx={cx} cy={cy} r={r} fill={GROUP_FILL[g]} />
}

function Tip({ active, payload, multi }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  if (multi) {
    return (
      <div className="qa-tip">
        <b>{clock(p.m)}</b>
        {payload.map((e) => <div key={e.dataKey}><span className="num">{kw(e.value)} kW</span> {e.name}</div>)}
      </div>
    )
  }
  const g = statusGroup(p.status)
  return (
    <div className="qa-tip">
      <b>{clock(p.m)}</b> {p.power == null ? <span className="muted">no data</span> : <span className="num">{kw(p.power, 2)} kW</span>}
      <div><i className={`sdot-h ${g}`} />{p.status ? `${GROUP_LABEL[g]}${STATUS[p.status] && g === 'grey' ? ` (${p.status.replace(/_/g, ' ')})` : ''}` : '–'}</div>
      {p.reason && <div className="muted">{reasonText(p.reason)}</div>}
      {p.median != null && <div className="muted">median {kw(p.median, 2)} kW · threshold {kw(p.p99, 2)} kW</div>}
      {p.p99o != null && <div className="muted">original P99 {kw(p.p99o, 2)} kW</div>}
      {p.run > 0 && <div className="muted">{p.run} min above threshold</div>}
    </div>
  )
}

const Select = ({ label, value, onChange, children, id }) => (
  <div className="field">
    <label htmlFor={id}>{label}</label>
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
  </div>
)

export default function LoadProfileChart({ meta, date, minute, focus, rule }) {
  const [mode, setMode] = useState('zone')
  const [floor, setFloor] = useState(1)
  const [zone, setZone] = useState(2)
  const [endUse, setEndUse] = useState('AC')
  const [floors, setFloors] = useState([1, 2, 3, 4, 5, 6, 7])
  const [cmpUse, setCmpUse] = useState('AC')
  const [start, setStart] = useState('20:25')
  const [end, setEnd] = useState('20:48')

  // An alert picked in the sidebar points the chart at that zone, load and window (a new object each pick).
  useEffect(() => {
    if (!focus) return
    setMode('zone'); setFloor(focus.floor); setZone(focus.zone); setEndUse(focus.endUse); setStart(focus.start); setEnd(focus.end)
  }, [focus])

  const zonesOf = meta.zones[floor] ?? {}
  const zoneIds = Object.keys(zonesOf)
  const uses = zonesOf[zone] ?? []

  // keep the pickers valid when the floor or zone changes
  useEffect(() => { if (!zoneIds.includes(String(zone))) setZone(Number(zoneIds[0])) }, [floor]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (uses.length && !uses.includes(endUse)) setEndUse(uses.includes('All') ? 'All' : uses[0]) }, [floor, zone]) // eslint-disable-line react-hooks/exhaustive-deps

  const valid = minuteOf(end) >= minuteOf(start)
  const win = { date, start, end }
  const one = useApi('series', { floor, zone, end_use: endUse, ...win, rule }, { enabled: mode === 'zone' && valid, debounce: 120 })
  // With the new rule on, also fetch the original P99 for the same window, to draw it as a comparison line.
  const showOrig = rule === 'sd'
  const orig = useApi('series', { floor, zone, end_use: endUse, ...win, rule: 'p99' }, { enabled: mode === 'zone' && valid && showOrig, debounce: 120 })
  const many = useApi('compare', { floors: [...floors].sort().join(','), end_use: cmpUse, ...win }, { enabled: mode === 'compare' && valid && floors.length > 0, debounce: 120 })
  const res = mode === 'zone' ? one : many

  const { data, hasRed, dense, scale, multi } = useMemo(() => {
    const s = minuteOf(start), e = minuteOf(end)
    if (!valid) return { data: [] }
    if (mode === 'zone') {
      if (!one.data) return { data: [] }
      const by = new Map(one.data.rows.map((r) => [toMinute(r.timestamp), {
        m: toMinute(r.timestamp), power: r.power_kw, median: r.reference_median_kw, p99: r.upper_threshold_kw,
        status: r.status, reason: r.status_reason, run: r.exceedance_duration_minutes,
      }]))
      if (showOrig && orig.data) for (const r of orig.data.rows) { const x = by.get(toMinute(r.timestamp)); if (x) x.p99o = r.upper_threshold_kw }
      const rows = fill(s, e, by)
      const vals = rows.flatMap((r) => [r.power, r.median, r.p99, r.p99o]).filter((v) => v != null)
      return { data: rows, hasRed: rows.some((r) => r.status === 'red'), dense: rows.length > 120, scale: yScale(vals), multi: false }
    }
    if (!many.data) return { data: [] }
    const by = new Map()
    for (const [f, rows] of Object.entries(many.data.floors)) {
      for (const r of rows) {
        const m = toMinute(r.timestamp)
        if (!by.has(m)) by.set(m, { m })
        by.get(m)[`f${f}`] = r.power_kw
      }
    }
    const rows = fill(s, e, by)
    const vals = rows.flatMap((r) => Object.entries(r).filter(([k, v]) => k !== 'm' && v != null).map(([, v]) => v))
    return { data: rows, hasRed: false, dense: rows.length > 120, scale: yScale(vals), multi: true }
  }, [mode, one.data, orig.data, showOrig, many.data, start, end, valid])

  const present = (key) => data.some((r) => r[key] != null)
  const title = mode === 'zone'
    ? `Floor ${floor} · Zone ${zone} · ${LOAD_NAME[endUse]}`
    : `${LOAD_NAME[cmpUse]}, floor totals`
  const loading = res.loading && !res.data
  const toggleFloor = (f) => setFloors((a) => (a.includes(f) ? a.filter((x) => x !== f) : [...a, f]))
  const shown = (mode === 'zone' ? one.data : many.data)
  const truncated = shown?.truncated

  return (
    <section className="panel qa-chart" aria-label="Load profile">
      <div className="panel-head">
        <h2>Load profile</h2>
        <span className="sub">Power (kW), recorded Bangkok local time. Date follows the replay control above.</span>
      </div>

      <div className="controls">
        <div className="field">
          <label>Show</label>
          <div className="seg" role="group" aria-label="Chart mode">
            <button type="button" className={mode === 'zone' ? 'on' : ''} aria-pressed={mode === 'zone'} onClick={() => setMode('zone')}>One zone</button>
            <button type="button" className={mode === 'compare' ? 'on' : ''} aria-pressed={mode === 'compare'} onClick={() => setMode('compare')}>Compare floors</button>
          </div>
        </div>
        {mode === 'zone' ? (
          <>
            <Select id="qa-floor" label="Floor" value={floor} onChange={(v) => setFloor(Number(v))}>
              {meta.floors.map((f) => <option key={f} value={f}>Floor {f}</option>)}
            </Select>
            <Select id="qa-zone" label="Zone" value={zone} onChange={(v) => setZone(Number(v))}>
              {zoneIds.map((z) => <option key={z} value={z}>Zone {z}</option>)}
            </Select>
            <Select id="qa-use" label="End use" value={endUse} onChange={setEndUse}>
              {uses.map((u) => <option key={u} value={u}>{LOAD_NAME[u]}</option>)}
            </Select>
          </>
        ) : (
          <>
            <Select id="qa-cuse" label="End use" value={cmpUse} onChange={setCmpUse}>
              {meta.end_uses.map((u) => <option key={u} value={u}>{LOAD_NAME[u]}</option>)}
            </Select>
            <div className="field">
              <label>Floors</label>
              <div className="chips" role="group" aria-label="Floors to compare">
                {meta.floors.map((f) => (
                  <label key={f} className={floors.includes(f) ? 'on' : ''}>
                    <input type="checkbox" checked={floors.includes(f)} onChange={() => toggleFloor(f)} />F{f}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="field">
          <label>Window</label>
          <div className="date-row">
            <input type="time" aria-label="Window start" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
            <span className="muted">to</span>
            <input type="time" aria-label="Window end" value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} />
            <button type="button" className="btn" onClick={() => { setStart('00:00'); setEnd('23:59') }}>Whole day</button>
            <button type="button" className="btn" onClick={() => { setStart('20:25'); setEnd('20:48') }}>Example window</button>
          </div>
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <h3 className="qa-chart-title">
          {title}{hasRed ? ': illustrative, not a confirmed fault' : ''}
          <small>{date}, {start} to {end}</small>
        </h3>
        <div style={{ height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis type="number" dataKey="m" domain={[minuteOf(start), minuteOf(end)]} tickFormatter={clock}
                     allowDecimals={false} tickCount={8} stroke="var(--line)" />
              <YAxis domain={scale?.domain ?? ['auto', 'auto']} ticks={scale?.ticks} allowDecimals={false} width={44} stroke="var(--line)"
                     label={{ value: 'Power (kW)', angle: -90, position: 'insideLeft', offset: 14, style: { fill: 'var(--ink-3)', fontSize: 12 } }} />
              <Tooltip content={<Tip multi={multi} />} isAnimationActive={false} />
              {mode === 'zone' && present('p99') && (
                <Line name="Alert threshold" dataKey="p99" stroke="var(--baseline)" strokeWidth={1.8} strokeDasharray="7 5" dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
              )}
              {mode === 'zone' && showOrig && present('p99o') && (
                <Line name="Original P99" dataKey="p99o" stroke="var(--baseline)" strokeOpacity={0.55} strokeWidth={1.3} strokeDasharray="10 4 2 4" dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
              )}
              {mode === 'zone' && present('median') && (
                <Line name="Historical median" dataKey="median" stroke="var(--ink-3)" strokeWidth={1.8} strokeDasharray="2 4" dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
              )}
              {mode === 'zone' && (
                <Line name="Power" dataKey="power" stroke="var(--actual)" strokeWidth={1.6} connectNulls={false} isAnimationActive={false}
                      dot={({ key, ...p }) => <Marker key={key} {...p} dense={dense} />} activeDot={{ r: 6 }} />
              )}
              {mode === 'compare' && floors.map((f) => (
                <Line key={f} name={`Floor ${f}`} dataKey={`f${f}`} stroke={FLOOR_COLORS[f - 1]} strokeWidth={2}
                      dot={false} connectNulls={false} isAnimationActive={false} />
              ))}
              {minute >= minuteOf(start) && minute <= minuteOf(end) && (
                <ReferenceLine x={minute} stroke="var(--accent)" strokeWidth={1.5} label={{ value: 'Explorer', position: 'insideTopRight', fill: 'var(--accent)', fontSize: 11 }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {!valid && <div className="qa-overlay">The window ends before it starts.</div>}
        {valid && res.error && <div className="qa-overlay">{res.error}</div>}
        {valid && !res.error && loading && <div className="qa-overlay">Loading…</div>}
        {valid && !res.error && !loading && shown && data.every((r) => (mode === 'zone' ? r.power == null : Object.keys(r).length === 1)) && (
          <div className="qa-overlay">No readings in this window.</div>
        )}
      </div>

      {mode === 'zone' ? (
        <>
          <div className="legend" style={{ marginTop: 8 }}>
            <span><i className="line" style={{ color: 'var(--actual)' }} />Recorded power</span>
            {present('median') && <span><i className="dot" style={{ color: 'var(--ink-3)' }} />Historical median</span>}
            {present('p99') && <span><i className="dash" style={{ color: 'var(--baseline)' }} />{rule === 'sd' ? 'Alert threshold (median + 3 SD)' : 'Frozen P99 threshold'}</span>}
            {showOrig && present('p99o') && <span><i className="dash" style={{ color: 'var(--baseline)', opacity: 0.55 }} />Original P99 (for comparison)</span>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}><StatusKey compact /></div>
          {endUse === 'All' && (
            <p className="note qa-note">All-loads rows have no median or threshold of their own, by design. Their status is inherited from the component loads.</p>
          )}
        </>
      ) : (
        <p className="note qa-note">
          Status colours and threshold lines are left off when floors are compared: each threshold belongs to one zone and end use,
          so a floor total has none. Pick one zone to see statuses. A minute with a missing zone reading is left blank rather than summed.
        </p>
      )}
      {truncated && <p className="note qa-note">Showing the first {shown.max_rows} minutes of this window. Narrow the window to see the rest.</p>}
    </section>
  )
}

// A padded y range with round tick values, so the axis never reads 35, 50, 65, 92.
function yScale(vals) {
  if (!vals.length) return undefined
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = Math.max(1, (hi - lo) * 0.1)
  const raw = (hi - lo + 2 * pad) / 5
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw)
  const min = Math.max(0, Math.floor((lo - pad) / step) * step)
  const max = Math.ceil((hi + pad) / step) * step
  const ticks = []
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return { domain: [min, max], ticks }
}
