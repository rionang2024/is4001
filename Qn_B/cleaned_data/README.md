# Cleaned data

The single input for every stage of Question B, and the two notebooks that build it.

## Files

| File | What it is | Made by |
|---|---|---|
| `question_b_hourly_data.parquet` | Cleaned hourly data, one row per **floor-hour** | `01_clean_raw_to_hourly.ipynb` |
| `question_b_model_data.parquet` | The **modelling dataset**, one row per **zone-hour**, with the target, features and split labels. Stages 2–4 read this | `02_build_model_dataset.ipynb` |
| `question_b_feature_dictionary.csv` | What every column of the modelling dataset means, and which features belong to M1–M4 | `02_build_model_dataset.ipynb` |
| `question_b_baseline_predictions.parquet` | The baselines' forecasts, hour by hour, for comparing models on the same rows (and the Diebold–Mariano test) | `../2-baselines/Baselines.ipynb` |

Reading the Parquet files requires `pyarrow`:

```python
import pandas as pd
model_data = pd.read_parquet('../cleaned_data/question_b_model_data.parquet')
```

## Rebuilding the data

Both notebooks run from this folder, in order.

1. **`01_clean_raw_to_hourly.ipynb`** — the 14 raw Kaggle CSVs → cleaned minute and hourly data. Download the raw files (`2018Floor1.csv` … `2019Floor7.csv`) from Kaggle into this folder first. They are not in git (up to 96 MB each). The notebook downloads the weather from the Open-Meteo archive, so it needs the internet.
   Writes `question_b_hourly_data.parquet` (committed) and `question_b_minute_data.parquet` (about 62 MB, not committed).
2. **`02_build_model_dataset.ipynb`** — the hourly and minute data → `question_b_model_data.parquet` and `question_b_feature_dictionary.csv`.

The raw CSVs, the weather downloads and the larger intermediate files the notebooks write are listed in the repo's `.gitignore`.

## `question_b_hourly_data.parquet`

| | |
|---|---|
| Shape | 55,622 rows × 52 columns |
| Coverage | 2018-07-01 00:00 → 2018-09-30 23:00 and 2019-03-01 00:00 → 2019-12-31 23:00, hourly |
| Floors | 2–7 (Floor 1 excluded — no temperature or humidity sensors) |

One row per **floor-hour**, with every zone's readings as columns. Floor 6 has 7,862 rows against 9,552 for the others, because its record ends on 22 October 2019 — those hours are *unavailable*, not zero.

| Group | Columns | Notes |
|---|---|---|
| Keys | `Year`, `Floor`, `Hour`, `minutes in hour` | `Hour` is the start of the hour; `minutes in hour` is how many of its 60 minutes exist in the data |
| AC power | 23 × `z{N}_AC{M}(kW)` | Sum a zone's working units to get its zone AC demand |
| Indoor | `z{N}_S1(degC)`, `z{N}_S1(RH%)` | Zones 1–5 |
| Outdoor (daily) | `rainfall (mm)`, `outdoor temp (degC)`, `outdoor humidity (%)`, `solar radiation (MJ/m2)` | The day's total rain and solar radiation, average temperature and humidity — repeated on every hour of the day |
| Outdoor (hourly) | `hourly rainfall (mm)`, `hourly outdoor temp (degC)`, `hourly outdoor humidity (%)`, `hourly solar radiation (W/m2)` | Temperature and humidity at the start of the hour; rain and solar radiation during the hour |
| Calendar | `holiday?` | 28 public holidays (see below) |
| Quality flags | `replaced?`, `AC spike?`, `AC spike units`, `indoor temp out of range?`, `indoor humidity out of range?`, `z1_S1 supply-air sensor?` | 'Yes' if any minute of the hour was flagged; values are kept |

Weather is Open-Meteo's historical archive for the building's location (13.7367 N, 100.5332 E), used as a stand-in for weather forecasts. Open-Meteo stamps rain and solar radiation at the end of the hour, so the value for 14:00–14:59 is the one stamped 15:00.

## `question_b_model_data.parquet`

209,119 rows × 35 columns: one row per **zone-hour** for the 23 zones, only rows where the zone's AC load is known. Column meanings and the M1–M4 feature sets are in `question_b_feature_dictionary.csv`.

- **Target:** `ac_load_kw` — the zone's working AC units added up, averaged over the hour. Missing if any unit was missing, so totals are never undercounted.
- **Day-ahead features only:** calendar, AC lags of 24, 48 and 168 hours, the zone's indoor temperature and humidity yesterday, last week and yesterday's average, and the weather. There is no previous-hour (t-1) lag: it is not known a day ahead.
- **Missing feature values are left as `NaN`** (mostly the indoor lags). LightGBM and XGBoost handle them.
- **`split`:** `train` = 2019 except April, August and December · `validation` = April, August, December 2019 (one month per season) · `test` = July–September 2018 (a different year; retrain on all of 2019 first, then test once).

## Cleaning applied

**Structure** — the 14 files combined; the invalid last row of the Floor 6, 2019 file removed; Light, Plug and Lux dropped; Floor 1 dropped; only July–September 2018 and March–December 2019 kept (the periods with indoor sensor readings).

**Invalid readings fixed** — 9 impossible values in 6 rows (for example a 4,762 kW lighting reading and two 799 kW AC readings), replaced with a neighbouring valid reading and marked in `replaced?`.

**Public holidays** — every weekday listed as a holiday in Thailand (30 days) was checked against the AC data. A holiday is kept unless the office floors' AC ran at 75% or more of a normal weekday (office open as usual). Result: 28 holidays, including Royal Ploughing Ceremony Day (9 May 2019, AC at 34%); Christmas Day 2018 and Labour Day 2019 excluded (AC at about 100% and 131%).

**Physical limits and spikes — flagged, values kept**

| Check | Result |
|---|---|
| Indoor temperature outside 15–36 °C | 33,972 minutes, all from **Floor 5, zone 1, 2019** (the supply-air sensor) |
| Indoor humidity outside 20–100% | 0 |
| AC reading above 1.5 × the unit's 99.9th percentile | 1,536 floor-minutes on Floors 2–7 (1,278 inside the time window). Many are real use of units that are almost always off |

**Hourly averages** — each meter or sensor's hourly value is the average of its minutes, kept only if **at least 54 of the 60 minutes** have a reading; otherwise `NaN`. **No gaps are filled or interpolated.**

## Known sensor caveats

- **Floor 5 zone 1** reads AC supply air rather than room air — treat that zone with care. Flagged by `z1_S1 supply-air sensor?` (and `supply_air_sensor_flag` in the modelling dataset).
- **Dead meters** — `z2_AC11` on Floor 2 and `z1_AC1` on **Floor 7 only** read 0 kW throughout. They are left out of the zone totals; `z1_AC1` works on Floors 2–6.
- **F2 zone 4** has no sensor data in 2018.
