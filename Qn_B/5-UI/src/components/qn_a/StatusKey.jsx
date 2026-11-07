import { STATUS } from '../../qnaApi.js'

const ROWS = [
  ['green', STATUS.green.meaning],
  ['amber', STATUS.amber.meaning],
  ['red', STATUS.red.meaning],
  ['grey', 'Missing data, insufficient history, or a reading excluded from assessment. Not confirmed normal'],
  ['neutral', STATUS.neutral.meaning],
]

export function StatusDot({ group }) {
  return <i className={`sdot-h ${group}`} aria-hidden="true" />
}

// The status colour key from the data README. Grey and neutral are never "normal".
export default function StatusKey({ compact = false }) {
  if (compact) {
    return (
      <div className="status-key compact" role="list" aria-label="Status colours">
        {ROWS.map(([g]) => <span key={g} role="listitem"><StatusDot group={g} />{g[0].toUpperCase() + g.slice(1)}</span>)}
      </div>
    )
  }
  return (
    <dl className="status-key">
      {ROWS.map(([g, text]) => (
        <div key={g}><dt><StatusDot group={g} />{g[0].toUpperCase() + g.slice(1)}</dt><dd>{text}</dd></div>
      ))}
    </dl>
  )
}
