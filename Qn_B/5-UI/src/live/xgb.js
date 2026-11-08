// Evaluates the exported XGBoost trees (public/data/live/model_xgb.json) in the browser.
// Numeric splits only (the model has no categorical features): x < threshold goes left,
// missing follows default_left. XGBoost works in float32, so inputs and thresholds are
// rounded to float32 before comparing. Checked against Python by `npm run check:live`.

// Packs every tree into flat typed arrays; leaves have left = -1 and keep their value in thr.
export function compile(model) {
  const n = model.trees.reduce((s, t) => s + t.l.length, 0)
  const feat = new Int32Array(n), thr = new Float32Array(n), left = new Int32Array(n), right = new Int32Array(n)
  const defLeft = new Uint8Array(n), roots = new Int32Array(model.trees.length)

  let o = 0
  model.trees.forEach((t, k) => {
    roots[k] = o
    for (let i = 0; i < t.l.length; i++) {
      feat[o + i] = t.f[i]; thr[o + i] = t.t[i]; defLeft[o + i] = t.d[i]
      left[o + i] = t.l[i] < 0 ? -1 : o + t.l[i]
      right[o + i] = t.r[i] < 0 ? -1 : o + t.r[i]
    }
    o += t.l.length
  })
  return { kind: 'xgb', features: model.features, base: model.base, feat, thr, left, right, defLeft, roots }
}

// x: array of feature values in model.features order (null = missing). Returns kW, never negative.
export function predictRow(m, x) {
  const { feat, thr, left, right, defLeft, roots } = m
  const xs = x.map((v) => (v == null ? NaN : Math.fround(v)))
  let s = m.base
  for (let k = 0; k < roots.length; k++) {
    let node = roots[k]
    while (left[node] >= 0) {
      const v = xs[feat[node]]
      node = v !== v ? (defLeft[node] ? left[node] : right[node]) : v < thr[node] ? left[node] : right[node]
    }
    s += thr[node]
  }
  return Math.max(0, s)
}
