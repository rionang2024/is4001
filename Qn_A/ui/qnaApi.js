// Data access and shared helpers for the Question A page.
// The minute-level data is served by Qn_A/api (see Qn_A/README.md); Vite proxies /api to it in dev.
import { useEffect, useState } from 'react'

const BASE = (import.meta.env.VITE_QA_API ?? '') + '/api/'
export const API_DOWN = 'The minute-data API is not running. Start it with: cd Qn_A/api && uvicorn app:app --port 8000'

export async function apiGet(path, params = {}, signal) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  let res
  try {
    res = await fetch(`${BASE}${path}?${qs}`, { signal })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new Error(API_DOWN)
  }
  if (!res.ok) {
    // a dev server with no proxy target answers 5xx with an empty body
    if (res.status >= 500 && !res.headers.get('content-type')?.includes('json')) throw new Error(API_DOWN)
    const body = await res.json().catch(() => ({}))
    throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${res.status})`)
  }
  return res.json()
}

// Fetches when the params change; keeps the previous result on screen while the next one loads.
export function useApi(path, params, { enabled = true, debounce = 0 } = {}) {
  const key = JSON.stringify([path, params])
  const [state, setState] = useState({ data: null, error: null, loading: enabled })

  useEffect(() => {
    if (!enabled) return undefined
    const ctrl = new AbortController()
    setState((s) => ({ ...s, loading: true }))
    const timer = setTimeout(() => {
      apiGet(path, params, ctrl.signal)
        .then((data) => setState({ data, error: null, loading: false }))
        .catch((e) => { if (e.name !== 'AbortError') setState((s) => ({ ...s, error: e.message, loading: false })) })
    }, debounce)
    return () => { clearTimeout(timer); ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  return state
}

// ---------- load types (the API calls the middle one "Lighting"; the prototype said "Light")
export const LOADS = ['AC', 'Lighting', 'Plug']
export const LOAD_NAME = { AC: 'AC', Lighting: 'Lighting', Plug: 'Plug load', All: 'All loads' }

// ---------- status key (docs/qa/dashboard_data_README.md)
export const STATUS = {
  green: { group: 'green', label: 'Green', meaning: 'Valid reading at or below its threshold' },
  amber: { group: 'amber', label: 'Amber', meaning: 'Above threshold for 1–4 consecutive minutes' },
  red: { group: 'red', label: 'Red', meaning: 'Above threshold for at least 5 consecutive minutes: investigate' },
  missing: { group: 'grey', label: 'No data', meaning: 'Missing data' },
  insufficient_reference: { group: 'grey', label: 'No data', meaning: 'Insufficient history to set a threshold' },
  not_assessed: { group: 'grey', label: 'No data', meaning: 'Reading excluded from assessment' },
  neutral: { group: 'neutral', label: 'Neutral', meaning: 'Outside the after-hours alert schedule. Not a passed check' },
}
export const statusGroup = (s) => STATUS[s]?.group ?? 'grey'
// Worst first. Grey and neutral rank above green because they are not confirmed normal.
export const GROUP_RANK = { red: 4, amber: 3, grey: 2, neutral: 1, green: 0 }
export const GROUP_LABEL = { green: 'green', amber: 'amber', red: 'red', grey: 'no data', neutral: 'neutral' }

const REASONS = {
  at_or_below_p99: 'At or below the P99 threshold',
  all_components_at_or_below_p99: 'All loads at or below their P99 thresholds',
  above_p99_1to4_minutes: 'Above P99 for 1–4 minutes',
  above_p99_5plus_minutes: 'Above P99 for 5+ minutes',
  at_or_below_threshold: 'At or below the alert threshold',
  all_components_at_or_below_threshold: 'All loads at or below their alert thresholds',
  above_threshold_amber: 'Above the alert threshold, not yet long enough for red',
  above_threshold_red: 'Above the alert threshold for the full red time',
  highest_component_amber: 'Highest load is amber',
  highest_component_red: 'Highest load is red',
  outside_alert_scope: 'Outside the after-hours alert schedule',
  component_reference_unavailable: 'A load has no reference yet',
  component_power_unavailable: 'A load has no reading',
  fewer_than_6_reference_dates: 'Fewer than 6 reference dates',
  reference_coverage_below_70pct: 'Reference coverage below 70%',
  incomplete_meters: 'Some meters have no reading',
}
export const reasonText = (r) => (r == null ? '' : REASONS[r] ?? r.replace(/_/g, ' '))

// ---------- time
const pad = (n) => String(n).padStart(2, '0')
export const clock = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`
export const minuteOf = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
export const stamp = (date, mins) => `${date}T${clock(mins)}`
export const kw = (v, nd = 1) => (v == null || Number.isNaN(v) ? '–' : Number(v).toFixed(nd))
