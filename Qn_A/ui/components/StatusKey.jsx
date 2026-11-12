import { STATUS } from '../qnaApi.js'

const ROWS = [
  ['green', STATUS.green.meaning],
  ['amber', STATUS.amber.meaning],
  ['red', STATUS.red.meaning],
  ['grey', 'Missing data, insufficient history, or a reading excluded from assessment. Not confirmed normal'],
]

const NAME = { green: 'Green', amber: 'Amber', red: 'Red', grey: 'No data' }

export function StatusDot({ group }) {
  return <i className={`sdot-h ${group}`} aria-hidden="true" />
}

// The status colour key from the data README. Grey is never "normal".
export default function StatusKey({ compact = false, ruleInfo = null }) {
  if (compact) {
    return (
      <div className="status-key compact" role="list" aria-label="Status colours">
        {ROWS.map(([g]) => <span key={g} role="listitem"><StatusDot group={g} />{NAME[g]}</span>)}
      </div>
    )
  }
  // the amber and red wording follows the rule in use
  const n = ruleInfo?.red_min
  const text = (g, fallback) => (!n ? fallback
    : g === 'amber' ? `Above threshold for 1–${n - 1} consecutive minutes`
    : g === 'red' ? `Above threshold for at least ${n} consecutive minutes: investigate` : fallback)
  return (
    <dl className="status-key">
      {ROWS.map(([g, fallback]) => (
        <div key={g}><dt><StatusDot group={g} />{NAME[g]}</dt><dd>{text(g, fallback)}</dd></div>
      ))}
    </dl>
  )
}
