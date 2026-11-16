import { useState } from 'react'
import { fmt, modelName, passesAshrae, shortZone } from '../data.js'

// Accuracy per zone, always next to the comparison model (a WAPE on its own says little).
export default function AccuracyTable({ metrics, zones, model, compare, selected, onPick }) {
  const [scope, setScope] = useState('operating')
  const [sort, setSort] = useState({ key: 'zone', dir: 1 })

  const rows = zones.map((z) => {
    const m = metrics.by_zone[z.id]?.[scope]?.[model]
    const c = metrics.by_zone[z.id]?.[scope]?.[compare]
    return {
      zone: z.id, floor: z.floor, n: m?.n,
      wape: m?.WAPE, cWape: c?.WAPE, gain: m && c ? c.WAPE - m.WAPE : null,
      cv: m?.CVRMSE, nmbe: m?.NMBE, mae: m?.MAE, pass: passesAshrae(m),
    }
  })
  const sorted = [...rows].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key]
    if (x == null) return 1
    if (y == null) return -1
    return (x > y ? 1 : x < y ? -1 : 0) * sort.dir
  })
  const all = metrics.overall[scope]
  const beats = rows.filter((r) => r.gain > 0).length

  const H = ({ k, children, r }) => (
    <th className={`sortable ${r ? 'r' : ''}`} onClick={() => setSort({ key: k, dir: sort.key === k ? -sort.dir : 1 })}>
      {children}{sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
    </th>
  )

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Accuracy by zone · {modelName(model)} vs {modelName(compare)}</h2>
        <div className="seg small">
          <button className={scope === 'operating' ? 'on' : ''} onClick={() => setScope('operating')}>Operating hours</button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>All hours</button>
        </div>
      </div>
      <p className="small" style={{ margin: '0 0 10px' }}>
        Building-wide WAPE <b className="num">{fmt(all[model]?.WAPE)}%</b> vs <span className="num">{fmt(all[compare]?.WAPE)}%</span>.
        Beats the comparison in <b>{beats} of {rows.length}</b> zones.
        {scope === 'all' && <span className="muted"> (Nights are near 0 kW, so all-hours % run high.)</span>}
      </p>
      <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
        <table>
          <thead><tr>
            <H k="zone">Zone</H><H k="wape" r>WAPE</H><H k="cWape" r>Comparison</H><H k="gain" r>Gain (pp)</H>
            <H k="cv" r>CV(RMSE)</H><H k="nmbe" r>NMBE</H><H k="mae" r>MAE kW</H><th>ASHRAE 14</th>
          </tr></thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.zone} className={`click ${r.zone === selected ? 'sel' : ''}`} onClick={() => onPick(r.zone)}>
                <td>{shortZone(r.zone)}</td>
                <td className="r num">{fmt(r.wape)}%</td>
                <td className="r num muted">{fmt(r.cWape)}%</td>
                <td className="r num" style={{ color: r.gain > 0 ? 'var(--good)' : 'var(--bad)' }}>{r.gain > 0 ? '+' : ''}{fmt(r.gain)}</td>
                <td className="r num">{fmt(r.cv)}%</td>
                <td className="r num">{r.nmbe > 0 ? '+' : ''}{fmt(r.nmbe)}%</td>
                <td className="r num">{fmt(r.mae, 2)}</td>
                <td>{r.pass ? <span className="chip good">pass</span> : <span className="chip bad">fail</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>Gain = comparison WAPE − model WAPE. ASHRAE 14: CV(RMSE) ≤ 30%, NMBE ±10%.</p>
    </section>
  )
}
