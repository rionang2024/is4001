// When the building's AC switches on (schedule.json, built from Question A's minute data by
// scripts/build_schedule.py). The plan uses the last working day's metered time, or the typical one.

// Last working day with metered times before `day`
export function lastMeteredDay(schedule, day) {
  const days = Object.keys(schedule.days).filter((d) => d < day)
  return days.length ? days[days.length - 1] : null
}

// AC-on minute for a zone: its group's metered time on seenDay (rounded down), else the typical time.
// 'overnight' for zones that run through the night, null for zones in no group.
export function acOnFor(schedule, seenDay, zone) {
  if (schedule.overnight.includes(zone)) return 'overnight'
  const g = schedule.groups.find((x) => x.zones.includes(zone))
  if (!g) return null
  const seen = seenDay ? schedule.days[seenDay]?.[g.id] : null
  return seen != null ? Math.floor(seen / schedule.round_min) * schedule.round_min : g.typical
}
