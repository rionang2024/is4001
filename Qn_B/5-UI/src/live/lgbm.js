// Evaluates the exported LightGBM trees (public/data/live/model_lgbm.json) in the browser.
// Mirrors LightGBM's Tree::NumericalDecision / CategoricalDecision; checked against Python
// predictions by `npm run check:live`.

const CATEGORICAL = 1
const DEFAULT_LEFT = 2
const MISSING_ZERO = 1
const MISSING_NAN = 2

// Packs every tree into flat typed arrays (one node table, one leaf table) for speed.
// Child pointers >= 0 are node indices; < 0 are ~leaf indices, both already offset.
export function compile(model) {
  let nNodes = 0, nLeaves = 0, nCat = 0
  for (const t of model.trees) { nNodes += t.f?.length ?? 0; nLeaves += t.v.length; nCat += t.ct?.length ?? 0 }

  const feat = new Int32Array(nNodes), thr = new Float64Array(nNodes), dec = new Uint8Array(nNodes)
  const left = new Int32Array(nNodes), right = new Int32Array(nNodes)
  const catLo = new Int32Array(nNodes), catN = new Int32Array(nNodes)
  const leafVal = new Float64Array(nLeaves), cats = new Uint32Array(nCat)
  const roots = new Int32Array(model.trees.length)

  let no = 0, lo = 0, co = 0
  model.trees.forEach((t, k) => {
    t.v.forEach((v, i) => { leafVal[lo + i] = v })
    if (!t.f) { roots[k] = ~lo; lo += t.v.length; return }
    roots[k] = no
    const ptr = (c) => (c >= 0 ? no + c : ~(lo + ~c))
    for (let i = 0; i < t.f.length; i++) {
      feat[no + i] = t.f[i]; thr[no + i] = t.t[i]; dec[no + i] = t.d[i]
      left[no + i] = ptr(t.l[i]); right[no + i] = ptr(t.r[i])
      if (t.d[i] & CATEGORICAL) {
        const j = Math.trunc(t.t[i])
        catLo[no + i] = co + t.cb[j]; catN[no + i] = t.cb[j + 1] - t.cb[j]
      }
    }
    t.ct?.forEach((v, i) => { cats[co + i] = v >>> 0 })
    no += t.f.length; lo += t.v.length; co += t.ct?.length ?? 0
  })
  return { kind: 'lgbm', features: model.features, feat, thr, dec, left, right, catLo, catN, leafVal, cats, roots }
}

// x: array of feature values in model.features order (null = missing). Returns kW, never negative.
export function predictRow(m, x) {
  const { feat, thr, dec, left, right, catLo, catN, leafVal, cats, roots } = m
  const xs = x.map((v) => (v == null ? NaN : v))
  let s = 0
  for (let k = 0; k < roots.length; k++) {
    let node = roots[k]
    while (node >= 0) {
      const dt = dec[node]
      let v = xs[feat[node]]
      const nan = v !== v
      if (dt & CATEGORICAL) {
        if (nan || v < 0) { node = right[node]; continue }
        const cat = Math.trunc(v), word = cat >> 5
        const hit = word < catN[node] && ((cats[catLo[node] + word] >>> (cat & 31)) & 1)
        node = hit ? left[node] : right[node]
        continue
      }
      const missing = (dt >> 2) & 3
      if (nan && missing !== MISSING_NAN) v = 0
      if ((missing === MISSING_ZERO && Math.abs(v) <= 1e-35) || (missing === MISSING_NAN && nan)) {
        node = dt & DEFAULT_LEFT ? left[node] : right[node]
      } else {
        node = v <= thr[node] ? left[node] : right[node]
      }
    }
    s += leafVal[~node]
  }
  return Math.max(0, s)
}
