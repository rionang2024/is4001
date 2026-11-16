// One interface over the browser model evaluator, picked by the exported file's "kind" (LightGBM only).
import * as lgbm from './lgbm.js'

const KINDS = { lgbm }

export const compile = (model) => KINDS[model.kind ?? 'lgbm'].compile(model)
export const predictRow = (m, x) => KINDS[m.kind].predictRow(m, x)
