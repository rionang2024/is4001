// Replay control for the floor plan: pick a date, then scrub or play through the day minute by minute.
import { addDays, dow } from '../../data.js'
import { clock } from '../../qnaApi.js'

export const INCIDENT = { date: '2018-10-03', minute: 20 * 60 + 35 }

export default function TimeControl({ meta, date, minute, onDate, onMinute, playing, onPlaying, step, onStep, busy }) {
  const { date_min: lo, date_max: hi } = meta
  return (
    <section className="panel qa-time" aria-label="Replay time">
      <div className="field">
        <label htmlFor="qa-date">Date</label>
        <div className="date-row">
          <button type="button" className="btn" aria-label="Previous day" disabled={date <= lo} onClick={() => onDate(addDays(date, -1))}>‹</button>
          <input id="qa-date" type="date" value={date} min={lo} max={hi} onChange={(e) => e.target.value && onDate(e.target.value)} />
          <button type="button" className="btn" aria-label="Next day" disabled={date >= hi} onClick={() => onDate(addDays(date, 1))}>›</button>
        </div>
      </div>

      <div className="slider">
        <div className="row">
          <span className="clock num" aria-live="off">{clock(minute)}</span>
          <span className="muted small">{dow(date)} {date}, Bangkok local time{busy ? ' · loading…' : ''}</span>
        </div>
        <input type="range" min="0" max="1439" step="1" value={minute} aria-label="Minute of the day"
               aria-valuetext={clock(minute)} onChange={(e) => onMinute(Number(e.target.value))} />
        <div className="ticks" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:59</span></div>
      </div>

      <div className="field">
        <label>Replay</label>
        <div className="row">
          <button type="button" className="btn" onClick={() => onPlaying(!playing)} aria-pressed={playing}>{playing ? '⏸ Pause' : '▶ Play'}</button>
          <div className="seg" role="group" aria-label="Minutes per step">
            {[1, 5, 15].map((n) => (
              <button key={n} type="button" className={step === n ? 'on' : ''} aria-pressed={step === n} onClick={() => onStep(n)}>{n} min</button>
            ))}
          </div>
          <button type="button" className="btn" title="Floor 1, Zone 2, AC: amber 20:31, red 20:35, green 20:44"
                  onClick={() => { onPlaying(false); onDate(INCIDENT.date); onMinute(INCIDENT.minute) }}>Example incident</button>
        </div>
      </div>
    </section>
  )
}
