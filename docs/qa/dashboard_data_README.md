## Fast start
Use Floor 1 / October 2018 for the first full-floor prototype: `minute/floor=1/month=2018-10/part-00000.parquet`. Replay 2018-10-03 20:25–20:48, Zone 2, AC. Amber at 20:31, red at 20:35, green at 20:44.

Install pandas and pyarrow in your backend environment if needed. Example:

```python
from pathlib import Path
import pyarrow.dataset as ds

root = Path('dashboard_data')
minute = ds.dataset(root / 'minute', format='parquet', partitioning='hive')
rows = minute.to_table(
    filter=(ds.field('floor') == 1) & (ds.field('month') == '2018-10')
           & (ds.field('zone') == 2) & (ds.field('end_use') == 'AC'),
    columns=['timestamp', 'floor', 'zone', 'end_use', 'power_kw',
             'reference_median_kw', 'upper_threshold_kw', 'status',
             'status_reason', 'quality_status', 'alert_components']
).to_pandas().sort_values('timestamp')
```
Filter the required day/time before sending results to the frontend. Never send the whole dataset to the browser. File row order is not time order: sort filtered rows. Recorded timestamps are Bangkok local time without timezone conversion.

## Filters and fields
Unique minute row key: timestamp + floor + zone + end_use. Actual end-use values: `AC`, `Lighting`, `Plug`, `All`; only installed groups exist. Floor and month are partition fields. Main display fields: power_kw, reference_median_kw, upper_threshold_kw, status, status_reason, exceedance_duration_minutes. Quality and calendar fields are retained. `reference_id` is an audit identifier; the separate detailed reference table is omitted because display references are already in minute rows.

## Status colours
- `green`: valid, eligible reading at/below P99.
- `amber`: above P99 for 1–4 consecutive valid minutes.
- `red`: above P99 for at least five consecutive valid minutes.
- `missing`: grey; required data unavailable/invalid. Never substitute zero.
- `insufficient_reference`: grey; power may exist, but insufficient historical support.
- `not_assessed`: grey; source-corrected reading excluded from scoring.
- `neutral`: neutral colour; outside the after-hours alert scope, NOT a passed anomaly check.
Always show status_reason and preserve gaps in charts. Grey/neutral must not be interpreted as confirmed normality.

All power requires every installed included component complete. All status inherits component severity only when checks are available. Unavailable components override overall availability, but alert_components retains known component alerts. All median/threshold/reference_id are null by design: never add component thresholds. All duration is the maximum current component run.

## Rules and caveats
Median = typical power; P99 = upper threshold. Monthly frozen preceding 56-day reference, matching weekday and hour, at least six dates and 70% coverage. July/August 2018 are warmup. Only complete nonholiday uncorrected readings fit references. Alert scope: nonholiday weekdays before 08:00 or from 17:00, plus nonholiday weekends. Calendar holidays do not prove closure.

Persistence resets on invalid/unavailable readings, below/equal threshold, excluded scope or month boundary. It does not reset at an hour boundary if both readings are eligible and above their respective thresholds. No minimum kW increase or recovery hysteresis was applied. Tiny thresholds may yield trivial alerts. Red means investigate, not confirmed fault, waste or savings.

Minute data is zone/end-use aggregated. Full individual-meter minute drill-down is NOT included (the small demo includes its four AC channels).