// The after-hours window from the README: weekdays 17:01 to 07:59, and all of every weekend.
// A pure time-of-day and weekday rule. Public holidays are not known here: the data marks those minutes neutral on its own.
import { parseDate } from '../../data.js'

export const AH_START = 17 * 60 + 1 // 17:01
export const AH_END = 7 * 60 + 59   // 07:59
export const AH_LABEL = '17:01 to 07:59'

export const isWeekend = (date) => [0, 6].includes(parseDate(date).getDay())
export const isAfterHours = (date, minute) => isWeekend(date) || minute >= AH_START || minute <= AH_END

// A daytime minute moves to the nearer edge of the window: 07:59 before midday, 17:01 after.
export const snapAfterHours = (date, minute) => (isAfterHours(date, minute) ? minute : minute < 750 ? AH_END : AH_START)

// The minute after `minute` + `step` when replaying: daytime is skipped, so 07:59 is followed by 17:01.
export const stepAfterHours = (date, minute, step) => {
  const n = minute + step
  return isAfterHours(date, n) ? n : AH_START
}
