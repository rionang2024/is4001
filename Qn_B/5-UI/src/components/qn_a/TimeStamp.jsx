// A date and time stamp that stays at the top of the screen while the building explorer is in view,
// so a screenshot of the building always says which minute it shows.
import { useEffect, useState } from 'react'
import { dow, parseDate } from '../../data.js'
import { isAfterHours, isWeekend } from './afterHours.js'

export default function TimeStamp({ when }) {
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
  const after = isAfterHours(date, h * 60 + m)
  const nice = parseDate(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div className="qa-stamp" style={{ top }} role="status" aria-label={`Showing ${dow(date)} ${nice} at ${time}, Bangkok time`}>
      <span className="qa-stamp-date">{dow(date)} {nice}</span>
      <span className="qa-stamp-time">{time}</span>
      <span className="qa-stamp-tz">Bangkok time</span>
      <span className={`qa-stamp-tag ${after ? 'after' : 'day'}`}>
        {after ? (isWeekend(date) ? 'After-hours · weekend' : 'After-hours') : 'Daytime'}
      </span>
    </div>
  )
}
