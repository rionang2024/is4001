// The after-hours schedule from the data README: Mon-Fri 17:01 to 07:59 and all weekend, public holidays excluded.
// Dates are 'YYYY-MM-DD', minutes are minutes since midnight (Bangkok local time).
import { addDays } from '../data.js'

export const AH_FIRST_EVENING = 17 * 60 + 1  // 17:01
export const AH_LAST_MORNING = 7 * 60 + 59   // 07:59
const day = (d) => new Date(`${d}T00:00:00Z`).getUTCDay() // 0 Sun .. 6 Sat

export function isAfterHours(date, minute, holidays) {
  if (holidays.has(date)) return false
  const w = day(date)
  if (w === 0 || w === 6) return true
  return minute <= AH_LAST_MORNING || minute >= AH_FIRST_EVENING
}

// First after-hours minute at or after (date, minute), as { date, minute }, or null past `hi`.
export function nextAfterHours(date, minute, holidays, hi) {
  let d = date, m = minute
  for (let i = 0; i < 20; i++, d = addDays(d, 1), m = 0) {
    if (hi && d > hi) return null
    if (holidays.has(d)) continue
    const w = day(d)
    if (w === 0 || w === 6 || m <= AH_LAST_MORNING || m >= AH_FIRST_EVENING) return { date: d, minute: m }
    return { date: d, minute: AH_FIRST_EVENING }
  }
  return null
}

// Last after-hours minute at or before (date, minute), or null before `lo`.
export function prevAfterHours(date, minute, holidays, lo) {
  let d = date, m = minute
  for (let i = 0; i < 20; i++, d = addDays(d, -1), m = 1439) {
    if (lo && d < lo) return null
    if (holidays.has(d)) continue
    const w = day(d)
    if (w === 0 || w === 6 || m <= AH_LAST_MORNING || m >= AH_FIRST_EVENING) return { date: d, minute: m }
    return { date: d, minute: AH_LAST_MORNING }
  }
  return null
}

// Share of the day (0..1 of the slider) that is outside after-hours on this date: the band to shade, or null.
export function daytimeBand(date, holidays) {
  const w = day(date)
  if (holidays.has(date) || w === 0 || w === 6) return null
  return [(AH_LAST_MORNING + 1) / 1439, (AH_FIRST_EVENING - 1) / 1439]
}
