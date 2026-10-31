# Question B — Forecast Zone AC Energy Demand

> Can we accurately forecast a zone's AC energy demand by combining historical indoor environmental conditions with external weather forecasts?

- **Zone AC demand** = the sum of that zone's AC units' energy demand
- **Indoor environmental conditions** = temperature, humidity
- **External weather** = temperature, humidity, rainfall

## Pipeline

Run in order — each stage reads the cleaned dataset in [`cleaned_data/`](cleaned_data/).

| Stage | Folder | What it does | Status |
|---|---|---|---|
| 1 | [`1-eda/`](1-eda/) | Exploratory analysis: dead sensors, demand patterns, weather relationships | notebook committed |
| 2 | [`2-baselines/`](2-baselines/) | Seasonal naive, average profile, feature-only baseline | empty |
| 3 | [`3-LightGBM/`](3-LightGBM/) | Main forecasting model | empty |
| 4 | [`4-XGBoost/`](4-XGBoost/) | Comparator model | empty |
| 5 | [`5-UI/`](5-UI/) | Facilities-manager dashboard | empty |

## Scope

### Time window

| | |
|---|---|
| **Main modelling** | 2019-03 to 2019-12 |
| **Extra training data** | 2018-07 to 2018-09 |

The rest of the record has no temperature or humidity readings, so it cannot support an indoor-conditions model.

### Floors and zones — 23 in total

| Floors | Zones |
|---|---|
| F2 | 1, 2, 4 |
| F3–F7 | 1, 2, 4, 5 |

Excluded because: **Floor 1** has no temperature or humidity sensors · **Zone 3** has no AC · **F2 Zone 4** has no sensor data in 2018.

### Variables

- **Used** — Date, AC (kW), temperature (degC), humidity (RH%)
- **Brought in** — Bangkok weather (Open-Meteo historical archive; NOAA ISD and Thai Meteorological Department stations also evaluated)
- **Not used** — light, plug electricity, lux

## Analytics plan

1. **Data preparation** — parse date formats; sum each zone's AC units into `AC_Zone`; resample to hourly; reshape to one row per zone-hour (`zone`, `floor`, `timestamp`, `AC_zone`, `T_in`, `RH_in`).
2. **Integrate external data** — retrieve hourly Bangkok temperature, humidity and rainfall for Jul 2018 – Dec 2019 and join onto the 23 zones' hourly dataset.
3. **Anomaly detection** — flag impossible values and spike caps; set to missing and interpolate short gaps.
4. **Set baselines** — see [`2-baselines/`](2-baselines/).
5. **Modelling** — LightGBM / XGBoost, comparing the contribution of indoor conditions against outdoor weather.
6. **Validation** — time-based splits, then MAE, RMSE, CV(RMSE), NMBE and WAPE, with a Diebold–Mariano test against the baselines.

## Feature sets

The point of the question is which inputs actually help, so the models are compared across four nested feature sets:

| Set | Features |
|---|---|
| **M1** | calendar + AC lags (baseline) |
| **M2** | M1 + indoor T / RH |
| **M3** | M1 + outdoor weather |
| **M4** | all features |

**Leakage rule:** indoor values only up to the forecast time; weather at the target hour (standing in for a real forecast).

## Splits

| Split | Window |
|---|---|
| Train (main) | 2019-03-07 → 2019-12-31 |
| Validate | Sep–Oct 2019 |
| Test | Nov–Dec 2019 |
| Out-of-year test | 2018-07-01 → 2018-09-12 |
| AC-only baseline (no sensors) | Sep 2018 – Mar 2019 |

Plus rolling monthly folds, and a **weather-noise test** (±1.5 °C, rain flips) to mimic the error a real forecast would carry.

## Evaluation

MAE, RMSE, CV(RMSE), NMBE, WAPE — per zone, benchmarked against the seasonal-naive baseline. Diebold–Mariano compares **M4 vs M1** for significance. Breakdowns: per zone, rainy vs dry, hot vs cool, operating vs off.

## What the EDA already tells us

From [`1-eda/`](1-eda/), on Floor 2 zone 2, working weekdays 08:00–17:00, Mar–Dec 2019:

| Relationship | Pearson r | Reading |
|---|---|---|
| AC load vs hourly **rainfall** | **-0.003** | no clear linear relationship — 29.9 kW in hours with ≥0.1 mm rain vs 30.0 kW in drier hours |
| AC load vs hourly **outdoor temperature** | **0.468** | moderate positive — hotter hours carry higher AC load |

So temperature is the weather variable worth carrying into the model; rainfall is not, on this evidence.

## Actions and KPIs

**Actions** — use zone-level forecasts to set pre-cooling and stagger AC start-up where zones are forecast to peak together; adjust setpoints ahead of hot or rainy days; flag zones whose actual demand deviates sharply from forecast as leads for inspection, not confirmed faults.

**KPIs** — CV(RMSE) and WAPE per zone on the held-out test period, which must **beat the seasonal-naive baseline**; the error reduction from the full model against the indoor-only model, to isolate what weather actually contributes; and peak-interval kW re-checked after 4–6 weeks in zones where FM applies the forecast.
