// Checks the browser forecast against each model's own Python predictions.
// Run after build_live.py:  npm run check:live
import { readFileSync } from 'node:fs'
import { compile, predictRow } from '../src/live/models.js'
import { runForecast } from '../src/live/forecast.js'

const here = new URL('.', import.meta.url)
const read = (p) => JSON.parse(readFileSync(new URL(p, here)))
const inputs = read('../public/data/live/inputs.json')
const TOL = { lgbm: 1e-6, xgb: 1e-3 }     // XGBoost sums leaves in float32

let failed = false
for (const { id, file, rows, expected, end_to_end: e2e } of read('live_check.json').models) {
  const model = compile(read(`../public/data/live/${file}`))
  const report = (label, worst) => {
    console.log(`${id} · ${label}: largest difference from Python ${worst.toExponential(2)} kW`)
    if (worst > TOL[id]) failed = true
  }

  // 1. Tree evaluator on prepared feature rows
  let worst = 0
  rows.forEach((x, i) => { worst = Math.max(worst, Math.abs(predictRow(model, x) - expected[i])) })
  report(`${rows.length} feature rows`, worst)

  // 2. Whole pipeline on two test days with typical-week inputs
  const overrides = Object.fromEntries(e2e.holidays.map((d) => [d, true]))
  const bands = inputs.models.find((m) => m.id === id).bands
  const t0 = performance.now()
  const out = runForecast({ model, bands, inputs, weather: { byDay: e2e.weather }, start: e2e.start, days: e2e.days,
                            readings: null, overrides })
  const ms = performance.now() - t0
  worst = 0
  for (const [z, t, v] of e2e.expected) {
    const s = out.zones[z]
    worst = Math.max(worst, Math.abs(s.forecast[s.t.indexOf(t)] - v))
  }
  report(`${e2e.expected.length} zone-hours end to end (${Math.round(ms)} ms for ${e2e.days} days)`, worst)
}

if (failed) {
  console.error('MISMATCH: the browser forecast does not reproduce the Python model')
  process.exit(1)
}
