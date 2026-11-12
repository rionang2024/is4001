// A date and time stamp that stays at the top of the screen while the building explorer is in view,
// so a screenshot of the building always says which minute it shows.
import { useEffect, useState } from 'react'
import { dow, parseDate } from '../../data.js'
import { isAfterHours } from './afterHours.js'

const NO_HOLIDAYS = new Set()
const weekend = (date) => [0, 6].includes(parseDate(date).getDay())

export default function TimeStamp({ when, holidays = NO_HOLIDAYS, playing = false, onPlaying, step = 1, onStep, onNext }) {
  const [date, time] = when.split(' ')
  const [top, setTop] = useState(72)

  // sit just under the page's own sticky header, whatever height it has at this width
  useEffect(() => {
    const bar = document.querySelector('.topbar')
    if (!bar) return undefined
    const measure = () => setTop(Math.round(bar.getBoundingClientRect().height) + 6)
    measure()
    if (!('ResizeObserver' in window)) return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

  const [h, m] = time.split(':').map(Number)
  const after = isAfterHours(date, h * 60 + m, holidays)
  const nice = parseDate(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div className="qa-stamp" style={{ top }}>
      {onPlaying && (
        <button type="button" className="qa-stamp-play" aria-pressed={playing} aria-label={playing ? 'Pause replay' : 'Play replay'}
                title={playing ? 'Pause the replay' : 'Play the replay'} onClick={() => onPlaying(!playing)}>
          <span aria-hidden="true">{playing ? '⏸' : '▶'}</span> {playing ? 'Pause' : 'Play'}
        </button>
      )}
      {onNext && (
        <button type="button" className="qa-stamp-next" title={`Go forward ${step} minute${step > 1 ? 's' : ''} and pause`} onClick={onNext}>
          Next +{step} min <span aria-hidden="true">›</span>
        </button>
      )}
      {onStep && (
        <div className="seg qa-stamp-seg" role="group" aria-label="Minutes per step">
          {[1, 5, 15].map((n) => (
            <button key={n} type="button" className={step === n ? 'on' : ''} aria-pressed={step === n} onClick={() => onStep(n)}>{n} min</button>
          ))}
        </div>
      )}
      <span className="qa-stamp-date">{dow(date)} {nice}</span>
      <span className="qa-stamp-time" role="status" aria-label={`Showing ${dow(date)} ${nice} at ${time}, Bangkok time`}>{time}</span>
      <span className="qa-stamp-tz">Bangkok time</span>
      <span className={`qa-stamp-tag ${after ? 'after' : 'day'}`}>
        {after ? (weekend(date) ? 'After-hours · weekend' : 'After-hours') : 'Daytime'}
      </span>
    </div>
  )
}
