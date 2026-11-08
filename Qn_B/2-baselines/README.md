# 2 · Baselines

Reference models the LightGBM and XGBoost forecasts must beat. Without these the accuracy numbers in stages 3 and 4 mean nothing: a zone's AC load is strongly periodic, so a naive repeat of last week is already a hard target.

## Files

| File | What it is |
|---|---|
| `Baselines.ipynb` | Builds and scores the three baselines |
| `question_b_baseline_results.csv` | Accuracy table: every baseline × period × hours × metric |
| `baseline_forecast_vs_actual_validation.png`, `baseline_forecast_vs_actual_test.png` | One week of forecasts vs actual for Floor 2 zone 2 |
| `baseline_wape.png` | WAPE of each baseline in operating hours, validation and test |
| `../cleaned_data/question_b_baseline_predictions.parquet` | Every forecast, row by row, written by the notebook |

Run the notebook from this folder; it reads [`../cleaned_data/question_b_model_data.parquet`](../cleaned_data/).

## The three baselines

| Baseline | Definition |
|---|---|
| **B1 · Seasonal naive** | AC load from the same hour one week earlier (`ac_load_kw_last_week`) |
| **B2 · Average profile** | The training average for the zone, hour and day type (weekday / weekend / holiday). A holiday with no training data falls back to the zone's weekend average |
| **B3 · Feature baseline (M1)** | Linear regression on the M1 features: calendar (hour, weekday, month, weekend, holiday, zone, floor) and AC lags (yesterday, 2 days ago, last week). No indoor sensors, no weather. Negative forecasts are set to 0 kW |

**Seasonal naive is the one that matters for the KPI.** The project commits to beating it on CV(RMSE) and WAPE per zone over the held-out test period.

`M1` doubles as the first of the four feature sets compared in stages 3–4, and is the reference arm of the Diebold–Mariano test (M4 vs M1).

## How they are scored

- **Validation:** B2 and B3 fitted on `train`, scored on `validation` (April, August, December 2019).
- **Test:** B2 and B3 refitted on all of 2019, scored once on `test` (July–September 2018).
- **Same rows for every baseline:** hours where all three can forecast — 45,931 validation and 46,064 test hours (91% of test hours; B1 cannot forecast when last week's value is missing). Models should be compared on the rows where `scored == 1` in the predictions file.
- **Metrics:** MAE, RMSE, CV(RMSE), NMBE (positive = forecasts too low), WAPE — for all hours and for operating hours (`is_operating_hours`: weekdays that are not holidays, 07:00–17:00).

## Results

**Test, operating hours** (12,602 hours) — the scores to beat:

| Baseline | MAE (kW) | RMSE (kW) | CV(RMSE) | NMBE | WAPE |
|---|---|---|---|---|---|
| B1 Seasonal naive | 2.31 | 4.77 | 34.9% | +4.7% | **16.9%** |
| B2 Average profile | 2.66 | **3.85** | **28.1%** | −11.8% | 19.5% |
| B3 Calendar + AC lags | 2.48 | 4.02 | 29.4% | +4.1% | 18.1% |

**Validation, operating hours** (11,848 hours):

| Baseline | MAE (kW) | RMSE (kW) | CV(RMSE) | NMBE | WAPE |
|---|---|---|---|---|---|
| B1 Seasonal naive | 3.88 | 7.60 | 50.0% | +12.8% | 25.5% |
| B2 Average profile | **2.63** | **3.89** | **25.5%** | −1.8% | **17.3%** |
| B3 Calendar + AC lags | 3.56 | 5.92 | 38.9% | +11.8% | 23.4% |

All-hours results are in `question_b_baseline_results.csv`. Their percentages are much larger (CV(RMSE) 70–130%) because night and weekend hours near 0 kW shrink the average load.

**Reading the results**

- **B1 fails after holidays:** on the Monday after a public holiday it copies the holiday's near-zero load.
- **B2 cannot adapt to change:** it over-forecasts 2018 (NMBE −11.8%) because some zones ran lower in 2018 than in 2019 (Floor 2 zone 2 by about 6 kW).
- **B3 is limited by being linear:** it cannot capture patterns that differ by zone and hour.

## Not built

The **AC-only baseline** for Sep 2018 – Mar 2019 (the stretch with no sensor readings) is not part of this stage: the modelling dataset covers only the periods with indoor sensor readings.
