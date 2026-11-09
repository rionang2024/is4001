// The isometric 7-storey building, as SVG. Geometry ported from the Question A prototype (docs/qa/reference-prototype/js/building.js).
import { FLOORS } from './explorerModel.js'

// x runs along the long facade (right side of the picture), y along the short facade (left side).
export const G = { L: 330, W: 180, H: 42, T: 7, O: 6, OX: 360, OY: 360, c: Math.sqrt(3) / 2, s: 0.5, VW: 980, VH: 700 }
const P = (x, y, z) => [G.OX + (y - x) * G.c, G.OY + (x + y) * G.s - z]
const pts = (a) => a.map((p) => P(...p).map((v) => v.toFixed(1)).join(',')).join(' ')
const longQ = (x0, x1, z0, z1, y = G.W) => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]]
const shortQ = (y0, y1, z0, z1, x = G.L) => [[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]]
const topQ = (x0, x1, y0, y1, z) => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]
export const floorMidY = (j) => G.OY + G.W * G.s - ((j - 1) * G.H + G.H / 2)

const SHOWN = new Set(['red', 'amber', 'grey', 'neutral'])
const Poly = ({ q, cls }) => <polygon className={cls} points={pts(q)} />

function Windows({ z0, z1 }) {
  const za = z0 + 9, zb = z1 - G.T - 7
  const nl = 9, pl = (G.L - 28) / nl
  const ns = 5, ps = (G.W - 28) / ns
  return (
    <>
      {Array.from({ length: nl }, (_, i) => {
        const q = longQ(14 + i * pl, 14 + i * pl + pl - 9, za, zb)
        return <g key={`l${i}`}><Poly q={q} cls="win-long" /><Poly q={q} cls="lit" /></g>
      })}
      {Array.from({ length: ns }, (_, i) => {
        const q = shortQ(14 + i * ps, 14 + i * ps + ps - 9, za, zb)
        return <g key={`s${i}`}><Poly q={q} cls="win-short" /><Poly q={q} cls="lit" /></g>
      })}
    </>
  )
}

function FloorArt({ j }) {
  const z0 = (j - 1) * G.H, z1 = j * G.H, o = G.O, T = G.T
  return (
    <>
      {j === 1 ? (
        <>
          <Poly q={longQ(0, G.L, z0, z1 - T)} cls="base-long" />
          <Poly q={shortQ(0, G.W, z0, z1 - T)} cls="base-short" />
          {Array.from({ length: 12 }, (_, i) => {
            const x = (i * (G.L - 8)) / 11
            return <Poly key={`cl${i}`} q={longQ(x, x + 8, z0, z1 - T)} cls="col-long" />
          })}
          {Array.from({ length: 7 }, (_, i) => {
            const y = (i * (G.W - 8)) / 6
            return <Poly key={`cs${i}`} q={shortQ(y, y + 8, z0, z1 - T)} cls="col-short" />
          })}
          {/* the podium also glows a little, so floor 1 reads like the others */}
          <Poly q={longQ(8, G.L - 8, z0 + 6, z1 - T - 4)} cls="lit" />
        </>
      ) : (
        <>
          <Poly q={longQ(0, G.L, z0, z1 - T)} cls="wall-long" />
          <Poly q={shortQ(0, G.W, z0, z1 - T)} cls="wall-short" />
          <Windows z0={z0} z1={z1} />
        </>
      )}
      <Poly q={longQ(-o, G.L + o, z1 - T, z1, G.W + o)} cls="slab-long" />
      <Poly q={shortQ(-o, G.W + o, z1 - T, z1, G.L + o)} cls="slab-short" />
    </>
  )
}

function PvArray({ xa, xb, ya, yb, cols, rows, top }) {
  const dx = (xb - xa) / cols, dy = (yb - ya) / rows
  const cells = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = xa + c * dx + 1, x1 = x0 + dx - 2, y0 = ya + r * dy + 1, y1 = y0 + dy - 2
      const za = top + 3 + ((y0 - ya) / (yb - ya)) * 8, zb = top + 3 + ((y1 - ya) / (yb - ya)) * 8
      cells.push(<Poly key={`${r}-${c}`} cls="pv" q={[[x0, y0, za], [x1, y0, za], [x1, y1, zb], [x0, y1, zb]]} />)
    }
  }
  return <>{cells}</>
}

function Roof() {
  const top = FLOORS.length * G.H, o = G.O
  const x0 = G.L - 90, x1 = G.L - 38, y0 = G.W - 78, y1 = G.W - 30, h = 20
  return (
    <>
      <Poly q={topQ(-o, G.L + o, -o, G.W + o, top)} cls="roof" />
      <PvArray xa={30} xb={G.L - 110} ya={22} yb={74} cols={9} rows={2} top={top} />
      <PvArray xa={30} xb={G.L - 110} ya={96} yb={148} cols={9} rows={2} top={top} />
      <Poly q={longQ(x0, x1, top, top + h, y1)} cls="roof-box-long" />
      <Poly q={shortQ(y0, y1, top, top + h, x1)} cls="roof-box-short" />
      <Poly q={topQ(x0, x1, y0, y1, top + h)} cls="roof-box-top" />
    </>
  )
}

// Anomaly overlay for one floor: a tint over its two facades that glows red / amber when the floor has a problem at the
// selected minute, and a muted tint when nothing on it could be checked. Styled in anomaly.css; absent when there is nothing to show.
function FloorGlow({ j }) {
  const z0 = (j - 1) * G.H, z1 = j * G.H - G.T
  return (
    <>
      <Poly q={longQ(0, G.L, z0, z1)} cls="ag ag-long" />
      <Poly q={shortQ(0, G.W, z0, z1)} cls="ag ag-short" />
    </>
  )
}

// glow: floor -> 0..1 window brightness; flagged: floor -> status group of its worst reading (the beacon shows for red)
// anom: floor -> { state, summary } from anomaly.js; red and amber glow, grey and neutral are muted, anything else draws nothing extra
export function BuildingSVG({ glow, beacon, anom = {}, hover, selected, narrow, onHover, onOpen }) {
  const m = 26
  const ax = G.OX + G.W * G.c + 4
  return (
    <svg className="ex-svg" viewBox={narrow ? '0 20 590 680' : `0 0 ${G.VW} ${G.VH}`} role="img"
         aria-label="Seven-storey building, one row per floor with its load at the chosen minute">
      <Poly q={topQ(-m, G.L + m, -m, G.W + m, 0)} cls="ground" />
      <Poly q={topQ(G.L + 34, G.L + 66, -70, G.W + 70, 0)} cls="road" />
      <Poly q={topQ(-10, G.L + 70, G.W + 34, G.W + 66, 0)} cls="road" />
      {FLOORS.map((j, i) => (
        <g key={j} className="floor-in" style={{ '--i': i }}>
          <g className={`floor${hover === j ? ' hl' : ''}${selected === j ? ' sel' : ''}${SHOWN.has(anom[j]?.state) ? ` anom-${anom[j].state}` : ''}`} data-floor={j}
             style={{ '--glow': glow[j] ?? 0 }}
             onMouseEnter={() => onHover(j)} onMouseLeave={() => onHover(null)}
             onClick={(e) => onOpen(j, e.currentTarget)}>
            {SHOWN.has(anom[j]?.state) && <title>{anom[j].summary}</title>}
            <FloorArt j={j} />
            {SHOWN.has(anom[j]?.state) && <FloorGlow j={j} />}
          </g>
        </g>
      ))}
      <Roof />
      {FLOORS.map((j) => {
        const y = floorMidY(j)
        return (
          <g key={j} className="lead" data-floor={j}>
            <line className={`leader${hover === j ? ' hl' : ''}`} x1={ax} y1={y} x2={G.VW * 0.562 - 6} y2={y} />
            <circle className="anchor" cx={ax} cy={y} r="3.5" />
            {beacon[j] && (
              <g>
                <circle className="beacon-ring" cx={ax} cy={y} r="5" />
                <circle className="beacon" cx={ax} cy={y} r="4.5" />
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}
