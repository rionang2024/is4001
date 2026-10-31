# Cleaned data

The single input for every stage of Question B.

## `question_b_hourly_data.parquet`

| | |
|---|---|
| Shape | 55,622 rows × 50 columns |
| Coverage | 2018-07-01 00:00 → 2019-12-31 23:00, hourly |
| Floors | 2–7 (Floor 1 excluded — no temperature or humidity sensors) |
| Size | 3.6 MB |

One row per **floor-hour**, with every zone's readings as columns. Floor 6 has 7,862 rows against 9,552 for the others, because its record ends in October 2019 — those hours are *unavailable*, not zero.

Reading it requires `pyarrow`:

```python
import pandas as pd
df = pd.read_parquet('../cleaned_data/question_b_hourly_data.parquet')
```

## Columns

| Group | Columns | Notes |
|---|---|---|
| Keys | `Year`, `Floor`, `Hour`, `minutes in hour` | `Hour` is the hourly timestamp; `minutes in hour` is how many of the 60 source minutes contributed |
| AC power | 23 × `z{N}_AC{M}(kW)` | z1 ×4, z2 ×14, z4 ×4, z5 ×1 — sum a zone's units to get its zone AC demand |
| Indoor | `z{N}_S1(degC)`, `z{N}_S1(RH%)` | zones 1–5 |
| Outdoor (minute-sampled) | `rainfall (mm)`, `outdoor temp (degC)`, `outdoor humidity (%)` | |
| Outdoor (hourly) | `hourly rainfall (mm)`, `hourly outdoor temp (degC)`, `hourly outdoor humidity (%)` | **use these** for hourly modelling |
| Calendar | `holiday?` | 2018–19 Thai calendar |
| Quality flags | `replaced?`, `AC spike?`, `AC spike units`, `indoor temp out of range?`, `indoor humidity out of range?`, `z1_S1 supply-air sensor?` | |

Note there are **two** sets of weather columns. The `hourly ...` ones are the hour-aligned values; the unprefixed ones are carried from the minute-level source.

## Cleaning applied

**Shaping** — sum AC units into one zone AC kW · resample 1-minute → hourly, keeping hours with **≥45 valid minutes** · merge weather and holidays to one row per zone-hour · drop Floor 6's corrupt last line.

**Physical limits** — readings beyond these were checked and flagged:

| Limit | Rows flagged |
|---|---|
| Temperature outside 15–36 °C | 33,972 minutes, all from **floor 5, zone 1, 2019** |
| AC spike ratio > 1.5 × the unit's 99.9th percentile | 1,786 |
| Humidity outside 20–100% | 0 |

**Anomalies** — data faults (physical limits, spikes, flat-lines) are set to missing with gaps ≤2 h interpolated. Operational anomalies (robust z-score, STL, Isolation Forest) are **kept and flagged**, not removed — they are findings, not errors.

## Known sensor caveats

- **Floor 5 zone 1** reads AC supply air rather than room air — treat that zone with care. Flagged by `z1_S1 supply-air sensor?`.
- **Floor 2 zone 2** has 14 AC meters but only **13 working**; one is dead and should be excluded.
- **F2 zone 4** has no sensor data in 2018.
