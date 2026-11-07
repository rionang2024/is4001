# Data contract: real minute-level data

Source of truth: `docs/dashboard_data_README.md` (the data package's own README, copied verbatim).
Status colour key: `docs/assets/status_colours.png`. Example of the intended line-chart style: `docs/assets/demo_chart.png`.

## Layout
`dashboard_data/minute/floor=<n>/month=<YYYY-MM>/part-*.parquet` (hive partitions: `floor`, `month`). Not committed to git.
Fast-start example to prototype with: Floor 1, October 2018, 2018-10-03 20:25 to 20:48, Zone 2, AC
(amber at 20:31, red at 20:35, green at 20:44).

## Fields (minute rows)
Row key: `timestamp + floor + zone + end_use`.

| Field | Meaning |
|---|---|
| timestamp | Bangkok local time, no timezone conversion |
| floor, zone | integers (zone is an int in the dataset filter: `ds.field('zone') == 2`) |
| end_use | `AC`, `Lighting`, `Plug`, `All` (only installed groups exist) |
| power_kw | the reading |
| reference_median_kw | typical power (historical median) |
| upper_threshold_kw | P99 threshold |
| status | `green`, `amber`, `red`, `missing`, `insufficient_reference`, `not_assessed`, `neutral` |
| status_reason | always show it |
| exceedance_duration_minutes | length of the current run above threshold |
| quality_status, alert_components, calendar fields | retained for audit |
| reference_id | audit id only |

## How the new fields differ from the mock CSVs
| Mock (`data/dashboard/*.csv`) | Real minute data | Note |
|---|---|---|
| `Year`, `Floor` | partition `month`, `floor` | month string `YYYY-MM` |
| `Zone` = `Z2`, `All` | `zone` = 2 (int) | whole-floor rows use `end_use = All`; check how a floor-level row is keyed |
| `End_Use` = `Light` | `end_use` = `Lighting` | map in `js/config.js` |
| `Actual_kW` (hourly mean) | `power_kw` (per minute) | |
| `Daytime_Baseline_kW` (weekday daytime mean) | `reference_median_kw` (median for matching weekday and hour, frozen preceding 56 days) | different concept: do not mix |
| `Is_Anomaly`, `Priority` | `status` amber/red | red means investigate, not confirmed fault |
| `Data_Status` OK / Insufficient | `status` grey group | missing, insufficient_reference, not_assessed |
| `Day_Type` | alert scope | weekdays before 08:00 or from 17:00 (non-holiday) and non-holiday weekends; otherwise `neutral` |

## Rules (summary; the README wins if they differ)
- Reference: monthly, frozen preceding 56 days, matching weekday and hour, at least 6 dates and 70% coverage. Jul/Aug 2018 are warm-up.
- Persistence resets on invalid reading, at/below threshold, out-of-scope minute, or month boundary; not at an hour boundary.
- `All` power needs every installed component complete. `All` status inherits component severity only when checks are available.
- No minimum kW increase or recovery hysteresis, so tiny thresholds can give trivial alerts.
- Minute data is zone/end-use aggregated. Individual-meter minute data is not included.
