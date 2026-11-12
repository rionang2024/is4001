// One interface over the browser model evaluators, picked by the exported file's "kind".
import * as lgbm from './lgbm.js'
import * as xgb from './xgb.js'

const KINDS = { lgbm, xgb }

export const compile = (model) => KINDS[model.kind ?? 'lgbm'].compile(model)
export const predictRow = (m, x) => KINDS[m.kind].predictRow(m, x)
