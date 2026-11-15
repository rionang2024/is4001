// Forecasts upcoming days with a trained model (LightGBM or XGBoost, see models.js).
//
// Inputs per zone-hour, built by name in model.features order:
//   calendar            from the date + Thai holiday list (inputs.json), with manual overrides
//   outdoor weather     Open-Meteo forecast for the building (fetchWeather)
//   AC + indoor lags    1, 2 and 7 days earlier: uploaded readings if given, otherwise the
//                       "typical week" from 2019. Later forecast days reuse earlier forecasts
//                       for AC lags only when readings were uploaded (recursive forecasting).
import { addDays, parseDate } from '../data.js'
import { predictRow } from './models.js'

const HOLIDAY_TYPE = 7

// Same rules as scripts/build_data.py, so the start-up plan reads the same on both tabs
export const START_SHARE = 0.25
export const START_MIN_KW = 1.0
export const ACTIVE_DAY_PEAK_KW = 2.0

const weekday = (d) => (parseDate(d).getDay() + 6) % 7            // 0 = Monday, as in training
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

export function isHoliday(d, inputs, overrides) {
  if (d in overrides) return overrides[d]
  return d in inputs.holidays
}
const dayType = (d, inputs, overrides) => (isHoliday(d, inputs, overrides) ? HOLIDAY_TYPE : weekday(d))

// ----------------------------------------------------------------------------- weather
// One extra day is fetched because rain and solar for hour h come from Open-Meteo hour h+1:
// Open-Meteo labels those totals at the end of the hour, the training data at the start.
export async function fetchWeather(location, start, days) {
  const params = new URLSearchParams({
    latitude: location.latitude, longitude: location.longitude, timezone: location.timezone,
    hourly: 'temperature_2m,relative_humidity_2m,precipitation,shortwave_radiation',
    start_date: start, end_date: addDays(start, days),
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!res.ok) throw new Error(`Weather forecast unavailable (Open-Meteo ${res.status})`)
  const { hourly: w } = await res.json()

  const byDay = {}
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i)
    const at = w.time.indexOf(`${d}T00:00`)
    if (at < 0) continue
    const temp = w.temperature_2m.slice(at, at + 24)
    const rh = w.relative_humidity_2m.slice(at, at + 24)
    const rain = w.precipitation.slice(at + 1, at + 25)
    const solar = w.shortwave_radiation.slice(at + 1, at + 25)
    if ([temp, rh, rain, solar].some((a) => a.length < 24 || a.some((v) => v == null))) continue
    byDay[d] = { temp, rh, rain, solar, ...dailyWeather({ temp, rh, rain, solar }) }
  }
  return { byDay, fetchedAt: new Date() }
}

// Daily weather features as the training data defines them: humidity is the mean rounded to a whole
// percent, solar the day's total in MJ/m² (W/m² × 3600 s / 10⁶ per hour)
const sum = (a) => a.reduce((x, y) => x + y, 0)
export function dailyWeather({ temp, rh, rain, solar }) {
  return {
    temp_avg: sum(temp) / 24,
    rain_total: sum(rain),
    rh_avg: Math.round(sum(rh) / 24),
    solar_total: Math.round(sum(solar) * 0.36) / 100,
  }
}

// ----------------------------------------------------------------------------- readings upload
// CSV columns: zone_id, timestamp (YYYY-MM-DD HH:MM, Bangkok time), ac_load_kw, indoor_temp_c, indoor_humidity_pct
export function parseReadings(text, zoneIds) {
  const lines = text.trim().split(/\r?\n/)
  const head = lines.shift().split(',').map((s) => s.trim().toLowerCase())
  const col = (n) => head.indexOf(n)
  const [iz, it, ia, ii, iu] = ['zone_id', 'timestamp', 'ac_load_kw', 'indoor_temp_c', 'indoor_humidity_pct'].map(col)
  if (iz < 0 || it < 0 || ia < 0) {
    throw new Error('CSV needs the columns zone_id, timestamp, ac_load_kw (and optionally indoor_temp_c, indoor_humidity_pct)')
  }

  const known = new Set(zoneIds)
  const out = {}
  let rows = 0
  for (const line of lines) {
    const c = line.split(',').map((s) => s.trim())
    const z = c[iz], ts = c[it].replace('T', ' ')
    if (!known.has(z) || ts.length < 13) continue
    const d = ts.slice(0, 10), h = +ts.slice(11, 13)
    const num = (i) => (i < 0 || c[i] === '' || c[i] == null ? null : Number(c[i]))
    const day = ((out[z] ??= {})[d] ??= { ac: Array(24).fill(null), tin: Array(24).fill(null), rh: Array(24).fill(null) })
    day.ac[h] = num(ia)
    day.tin[h] = num(ii)
    day.rh[h] = num(iu)
    rows++
  }
  if (!rows) throw new Error('No rows matched a known zone (e.g. F2_Z2) and timestamp')
  return { byZone: out, rows }
}

// Readings before `start` are the model's inputs; readings from `start` on are actuals, only drawn for
// comparison (never given to the model, so the forecast stays a genuine day-ahead forecast).
export function splitReadings(readings, start) {
  if (!readings) return { lags: null, actual: {} }
  const byZone = {}, actual = {}
  let rows = 0
  for (const [z, days] of Object.entries(readings.byZone)) {
    for (const [d, v] of Object.entries(days)) {
      if (d < start) {
        (byZone[z] ??= {})[d] = v
        rows += v.ac.filter((x) => x != null).length
      } else {
        v.ac.forEach((x, h) => { if (x != null) (actual[z] ??= {})[`${d}T${String(h).padStart(2, '0')}:00`] = x })
      }
    }
  }
  return { lags: rows ? { byZone, rows } : null, actual }
}

// Typical-week values for the 7 days before `start`, in the upload format
export function templateCsv(inputs, start, overrides) {
  const lines = ['zone_id,timestamp,ac_load_kw,indoor_temp_c,indoor_humidity_pct']
  for (const z of inputs.zones) {
    for (let k = 7; k >= 1; k--) {
      const d = addDays(start, -k), t = dayType(d, inputs, overrides)
      for (let h = 0; h < 24; h++) {
        const typ = inputs.typical[z.id]
        lines.push(`${z.id},${d} ${String(h).padStart(2, '0')}:00,${typ.ac[t][h] ?? ''},${typ.tin[t][h] ?? ''},${typ.rh[t][h] ?? ''}`)
      }
    }
  }
  return lines.join('\n')
}

// ----------------------------------------------------------------------------- start hours
// Hour the AC comes on in 24 hourly values (forecast or metered): the first hour at START_SHARE of the
// day's peak and at least START_MIN_KW. null when the day's peak is too small to count as AC on.
export function startHourOf(values) {
  if (values.length < 24 || values.some((v) => v == null)) return null
  const peak = Math.max(...values)
  if (peak < ACTIVE_DAY_PEAK_KW) return null
  const on = values.findIndex((v) => v >= START_SHARE * peak && v >= START_MIN_KW)
  return on < 0 ? null : on
}

// Metered start hour per zone on day d, from parsed readings (byZone[zone][date].ac)
export function meteredStarts(byZone, d) {
  const out = {}
  for (const [z, days] of Object.entries(byZone ?? {})) {
    const h = days[d] ? startHourOf(days[d].ac) : null
    if (days[d]) out[z] = h
  }
  return out
}

// ----------------------------------------------------------------------------- forecast
// Whether a zone's first forecast day has real readings behind all its lag days
export function readingsCover(readings, zoneId, start) {
  const z = readings?.byZone[zoneId]
  return !!z && [1, 2, 7].every((k) => z[addDays(start, -k)]?.ac.some((v) => v != null))
}

// bands: the chosen model's error bands (inputs.models[i].bands)
export function runForecast({ model, bands, inputs, weather, start, days, readings, overrides }) {
  const pred = {}                                   // pred[zone][date] = 24 values
  const zones = {}, daily = [], buildingT = [], buildingF = [], buildingN = []

  const ac = (z, d, h) => {
    const r = readings?.byZone[z]?.[d]?.ac[h]
    if (r != null) return r
    if (readings && pred[z]?.[d]) return pred[z][d][h]
    return inputs.typical[z].ac[dayType(d, inputs, overrides)][h]
  }
  // Indoor temperature (key 'tin') and humidity ('rh'): readings if given, otherwise the typical week
  const indoor = (key) => (z, d, h) => readings?.byZone[z]?.[d]?.[key]?.[h] ?? inputs.typical[z][key][dayType(d, inputs, overrides)][h]
  const indoorAvg = (key) => (z, d) => {
    const vals = readings?.byZone[z]?.[d]?.[key]?.filter((v) => v != null) ?? []
    return vals.length >= 22 ? vals.reduce((a, b) => a + b, 0) / vals.length
      : inputs.typical[z][`${key}_avg`][dayType(d, inputs, overrides)]
  }
  const [tin, rhIn, tinAvg, rhInAvg] = [indoor('tin'), indoor('rh'), indoorAvg('tin'), indoorAvg('rh')]

  // Every feature either model was trained on, by name. c = one zone-hour's context.
  const FEATURES = {
    floor: (c) => c.z.floor,
    zone_code: (c) => inputs.zone_map[c.z.id],
    hour: (c) => c.h,
    weekday: (c) => c.wd,
    month: (c) => parseDate(c.d).getMonth() + 1,
    is_weekend: (c) => c.weekend,
    is_holiday: (c) => c.hol,
    ac_load_kw_yesterday: (c) => ac(c.z.id, c.d1, c.h),
    ac_load_kw_2_days_ago: (c) => ac(c.z.id, c.d2, c.h),
    ac_load_kw_last_week: (c) => ac(c.z.id, c.d7, c.h),
    indoor_temp_c_yesterday: (c) => tin(c.z.id, c.d1, c.h),
    indoor_temp_c_last_week: (c) => tin(c.z.id, c.d7, c.h),
    indoor_temp_c_yesterday_avg: (c) => tinAvg(c.z.id, c.d1),
    indoor_humidity_pct_yesterday: (c) => rhIn(c.z.id, c.d1, c.h),
    indoor_humidity_pct_last_week: (c) => rhIn(c.z.id, c.d7, c.h),
    indoor_humidity_pct_yesterday_avg: (c) => rhInAvg(c.z.id, c.d1),
    outdoor_temp_hourly_c: (c) => c.w.temp[c.h],
    outdoor_temp_daily_avg_c: (c) => c.w.temp_avg,
    outdoor_humidity_hourly_pct: (c) => c.w.rh[c.h],
    outdoor_humidity_daily_avg_pct: (c) => c.w.rh_avg,
    rainfall_hourly_mm: (c) => c.w.rain[c.h],
    rainfall_daily_total_mm: (c) => c.w.rain_total,
    solar_radiation_hourly_wm2: (c) => c.w.solar[c.h],
    solar_radiation_daily_total_mjm2: (c) => c.w.solar_total,
  }
  const getters = model.features.map((n) => {
    if (!FEATURES[n]) throw new Error(`The browser cannot build the model input "${n}"`)
    return FEATURES[n]
  })

  const dates = Array.from({ length: days }, (_, i) => addDays(start, i)).filter((d) => weather.byDay[d])

  for (const d of dates) {
    const w = { ...dailyWeather(weather.byDay[d]), ...weather.byDay[d] }   // daily values given win (training fixture)
    const wd = weekday(d), weekend = wd >= 5 ? 1 : 0, hol = isHoliday(d, inputs, overrides) ? 1 : 0
    const [d1, d2, d7] = [1, 2, 7].map((k) => addDays(d, -k))
    const total = Array(24).fill(0)

    for (const z of inputs.zones) {
      const id = z.id
      const mode = readingsCover(readings, id, start) ? 'readings' : 'typical'
      const band = bands[mode][id]
      const typ = inputs.typical[id].ac[dayType(d, inputs, overrides)]
      const f = []
      for (let h = 0; h < 24; h++) {
        const c = { z, d, h, wd, weekend, hol, w, d1, d2, d7 }
        f.push(predictRow(model, getters.map((g) => g(c))))
        total[h] += f[h]
      }
      ;(pred[id] ??= {})[d] = f

      const s = (zones[id] ??= { t: [], forecast: [], typical: [], band_lo: [], band_hi: [], temp: [], rain: [], mode })
      for (let h = 0; h < 24; h++) {
        s.t.push(`${d}T${String(h).padStart(2, '0')}:00`)
        s.forecast.push(f[h])
        s.typical.push(typ[h])
        s.band_lo.push(band.lo[h] == null ? null : Math.max(0, f[h] + band.lo[h]))
        s.band_hi.push(band.hi[h] == null ? null : Math.max(0, f[h] + band.hi[h]))
        s.temp.push(w.temp[h])
        s.rain.push(w.rain[h])
      }

      const peak = Math.max(...f)
      daily.push({
        zone: id, date: d, forecast_peak: peak, forecast_peak_hour: f.indexOf(peak),
        forecast_kwh: f.reduce((a, b) => a + b, 0), start_hour: startHourOf(f), hours: 24,
        temp_max: Math.max(...w.temp), temp_avg: w.temp_avg, rain_mm: w.rain_total,
        is_holiday: hol, is_weekend: weekend,
      })
    }

    total.forEach((v, h) => {
      buildingT.push(`${d}T${String(h).padStart(2, '0')}:00`)
      buildingF.push(v)
      buildingN.push(inputs.zones.length)
    })
  }

  return { dates, zones, daily, building: { t: buildingT, forecast: buildingF, zones: buildingN } }
}
