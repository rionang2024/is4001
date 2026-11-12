// Replay control for the floor plan: pick a date, then scrub or play through the day minute by minute.
import { addDays, dow } from '../../data.js'
import { clock } from '../../qnaApi.js'
import { AH_END, AH_LABEL, AH_START, isWeekend, snapAfterHours } from './afterHours.js'
import './afterHours.css'

export const INCIDENT = { date: '2018-10-03', minute: 20 * 60 + 35 }
// The night the button below jumps to: Fri 13 Sep 2019, from 17:01 (the start of the after-hours window)
const NIGHT = { date: '2019-09-13', minute: 17 * 60 + 1 }

export default function TimeControl({ meta, date, minute, onDate, onMinute, playing, onPlaying, step, onStep, busy, afterHours = false, onAfterHours }) {
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
        <div className="range-wrap">
          <input type="range" min="0" max="1439" step="1" value={minute} aria-label="Minute of the day"
                 aria-valuetext={clock(minute)}
                 onChange={(e) => onMinute(afterHours ? snapAfterHours(date, Number(e.target.value)) : Number(e.target.value))} />
          {afterHours && !isWeekend(date) && (
            <span className="ah-band" aria-hidden="true"
                  style={{ left: `${((AH_END + 1) / 1439) * 100}%`, width: `${((AH_START - AH_END - 1) / 1439) * 100}%` }} />
          )}
        </div>
        {afterHours && (
          <p className="ah-note small">
            {isWeekend(date)
              ? `After-hours only: ${dow(date)} is a weekend, so the whole day counts.`
              : `After-hours only: ${AH_LABEL}. The hatched daytime band (08:00 to 17:00) is skipped by the slider and by replay.`}
          </p>
        )}
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
          {onAfterHours && (
            <button type="button" className={`btn ah-toggle${afterHours ? ' on' : ''}`} aria-pressed={afterHours}
                    title={`Only show after-hours minutes: weekdays ${AH_LABEL}, and all weekend`}
                    onClick={() => onAfterHours(!afterHours)}>
              After-hours only <small>{AH_LABEL}</small>
            </button>
          )}
          <button type="button" className="btn ah-toggle" title="Jump to the start of this night: Friday 17:00 to Saturday 09:00"
                  onClick={() => { onPlaying(false); onDate(NIGHT.date); onMinute(NIGHT.minute) }}>
            Fri 13 Sep 2019 night <small>Fri 17:00 to Sat 09:00</small>
          </button>
        </div>
      </div>
    </section>
  )
}
