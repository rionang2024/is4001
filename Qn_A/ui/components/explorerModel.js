// Pure helpers for the building explorer: floor plans and what a minute snapshot says about a floor or zone.
import { GROUP_RANK, LOADS, statusGroup } from '../qnaApi.js'

export const FLOORS = [1, 2, 3, 4, 5, 6, 7]

// Zone outlines in plan units (580 x 380), schematic after CU-BEMS Fig. 2.
// Floors 1-2 use layout A (four zones), floors 3-7 layout B (five zones). Keys are the data's integer zone numbers.
export const PLANS = {
  A: {
    title: 'Floors 1 and 2 layout',
    zones: {
      1: { pts: [[315, 5], [550, 5], [550, 370], [340, 370], [340, 195], [270, 195], [270, 95], [315, 50]], at: [395, 142], sensor: [443, 322] },
      2: { pts: [[5, 5], [315, 5], [315, 50], [270, 95], [270, 195], [160, 195], [160, 165], [5, 165]], at: [120, 40], sensor: [185, 150] },
      3: { pts: [[160, 195], [315, 195], [315, 370], [160, 370]], at: [192, 232] },
      4: { pts: [[30, 165], [160, 165], [160, 370], [30, 370]], at: [38, 178], sensor: [95, 336] },
    },
    core: [315, 200, 25, 170],
  },
  B: {
    title: 'Floors 3 to 7 layout',
    zones: {
      1: { pts: [[230, 5], [555, 5], [555, 157], [355, 157], [355, 195], [290, 195], [290, 120], [230, 120]], at: [300, 40], sensor: [510, 90] },
      2: { pts: [[355, 157], [555, 157], [555, 370], [355, 370]], at: [384, 178], sensor: [462, 336] },
      3: { pts: [[150, 195], [320, 195], [320, 370], [150, 370]], at: [184, 238] },
      4: { pts: [[30, 5], [230, 5], [230, 120], [290, 120], [290, 195], [150, 195], [150, 155], [30, 155]], at: [150, 50], sensor: [62, 76] },
      5: { pts: [[30, 155], [150, 155], [150, 370], [30, 370]], at: [34, 168], sensor: [90, 336] },
    },
    core: [320, 200, 35, 170],
  },
}
export const planOf = (floor) => (floor <= 2 ? PLANS.A : PLANS.B)

export const num = (v) => v !== null && v !== undefined && !Number.isNaN(v)

export const indexSnapshot = (rows) => {
  const idx = new Map()
  for (const r of rows ?? []) idx.set(`${r.floor}|${r.zone}|${r.end_use}`, r)
  return idx
}

const worse = (a, b) => (GROUP_RANK[b] > GROUP_RANK[a] ? b : a)

// What one zone holds for the switched-on loads.
// state: 'none' (no meter of that type), 'nodata' (meter exists, no reading), 'ok' (a reading, whatever its status).
export function zoneState(idx, floor, zone, on) {
  const out = { rows: [], tot: 0, n: 0, partial: false, worst: null }
  for (const e of LOADS.filter((l) => on[l])) {
    const r = idx.get(`${floor}|${zone}|${e}`)
    if (!r) { out.rows.push({ e, state: 'none' }); continue }
    const g = statusGroup(r.status)
    out.worst = out.worst ? worse(out.worst, g) : g
    if (!num(r.power_kw)) { out.rows.push({ e, state: 'nodata', r }); out.partial = true; continue }
    out.rows.push({ e, state: 'ok', r })
    out.tot += r.power_kw
    out.n++
  }
  return out
}

// Floor label: the sum of the switched-on loads over the floor's zones, never a total built from a missing reading.
export function floorStats(idx, floor, on) {
  const out = { kw: 0, has: false, partial: false, worst: null, counts: { red: 0, amber: 0, grey: 0, neutral: 0, green: 0 } }
  for (const z of Object.keys(planOf(floor).zones)) {
    const zs = zoneState(idx, floor, Number(z), on)
    if (zs.n) { out.has = true; out.kw += zs.tot }
    if (zs.partial) out.partial = true
    for (const row of zs.rows) {
      if (row.state === 'none') continue
      const g = statusGroup(row.r.status)
      out.counts[g]++
      out.worst = out.worst ? worse(out.worst, g) : g
    }
  }
  return out
}

export const maxZoneTotal = (idx, on) => {
  let max = 20 // keeps a quiet building from stretching its smallest blocks to full height
  for (const f of FLOORS) {
    for (const z of Object.keys(planOf(f).zones)) max = Math.max(max, zoneState(idx, f, Number(z), on).tot)
  }
  return max
}
