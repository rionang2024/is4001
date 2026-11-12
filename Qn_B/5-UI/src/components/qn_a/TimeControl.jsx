// Replay control for the floor plan: pick a date, then scrub or play through the day minute by minute.
import { addDays, dow } from '../../data.js'
import { clock } from '../../qnaApi.js'
import { daytimeBand } from './afterHours.js'

export const INCIDENT = { date: '2018-10-03', minute: 20 * 60 + 35 }
// The night the button below jumps to: Fri 13 Sep 2019, from 17:01 (the start of the after-hours window)
const NIGHT = { date: '2019-09-13', minute: 17 * 60 + 1 }

export default function TimeControl({ meta, date, minute, onDate, onMinute, playing, onPlaying, step, onStep, busy, rules, ruleId, onRule, holidays, afterOnly, onAfterOnly, onJump }) {
  const { date_min: lo, date_max: hi } = meta
  const band = afterOnly ? daytimeBand(date, holidays) : null
  // with the filter on, the previous/next day buttons skip public holidays
  const step1 = (d, n) => { let x = addDays(d, n); while (afterOnly && holidays.has(x) && x >= lo && x <= hi) x = addDays(x, n); return x }
  return (
    <section className="panel qa-time" aria-label="Replay time">
      <div className="field">
        <label htmlFor="qa-date">Date</label>
        <div className="date-row">
          <button type="button" className="btn" aria-label="Previous day" disabled={date <= lo} onClick={() => onDate(step1(date, -1), -1)}>‹</button>
          <input id="qa-date" type="date" value={date} min={lo} max={hi} onChange={(e) => e.target.value && onDate(e.target.value)} />
          <button type="button" className="btn" aria-label="Next day" disabled={date >= hi} onClick={() => onDate(step1(date, 1), 1)}>›</button>
        </div>
      </div>

      <div className="slider">
        <div className="row">
          <span className="clock num" aria-live="off">{clock(minute)}</span>
          <span className="muted small">{dow(date)} {date}, Bangkok local time{busy ? ' · loading…' : ''}</span>
        </div>
        <div className="qa-range">
          {band && <span className="qa-daytime" style={{ left: `${band[0] * 100}%`, width: `${(band[1] - band[0]) * 100}%` }} title="Daytime: not after-hours" aria-hidden="true" />}
          <input type="range" min="0" max="1439" step="1" value={minute} aria-label="Minute of the day"
                 aria-valuetext={clock(minute)} onChange={(e) => onMinute(Number(e.target.value))} />
        </div>
        <div className="ticks" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:59</span></div>
      </div>

      <div className="field">
        <label>Hours</label>
        <div className="row">
          <div className="seg" role="group" aria-label="Hours shown">
            <button type="button" className={afterOnly ? 'on' : ''} aria-pressed={afterOnly} onClick={() => onAfterOnly(true)}>After-hours only</button>
            <button type="button" className={!afterOnly ? 'on' : ''} aria-pressed={!afterOnly} onClick={() => onAfterOnly(false)}>All hours</button>
          </div>
        </div>
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
          <button type="button" className="btn qa-night" title="Jump to the start of this night: Friday 17:00 to Saturday 09:00"
                  onClick={() => { onPlaying(false); onJump(NIGHT.date, NIGHT.minute) }}>
            Fri 13 Sep 2019 night <small>Fri 17:00 to Sat 09:00</small>
          </button>
        </div>
      </div>

      {afterOnly && <p className="muted small qa-ah-note">After-hours = Mon–Fri 17:01–07:59 and all weekends, public holidays excluded. The slider and replay skip everything else (the shaded band is daytime).</p>}

      {rules?.sd && (
        <div className="field qa-rule">
          <label>Alert rule</label>
          <div className="row">
            <div className="seg" role="group" aria-label="Alert rule">
              <button type="button" className={ruleId === 'sd' ? 'on' : ''} aria-pressed={ruleId === 'sd'} onClick={() => onRule('sd')}>Median + 3 SD</button>
              <button type="button" className={ruleId === 'p99' ? 'on' : ''} aria-pressed={ruleId === 'p99'} onClick={() => onRule('p99')}>Original (P99)</button>
            </div>
            <span className="muted small">{rules[ruleId]?.label}</span>
          </div>
        </div>
      )}
    </section>
  )
}
