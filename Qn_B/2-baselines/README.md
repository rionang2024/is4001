# 2 · Baselines

> **Status:** empty — nothing committed yet.

Reference models the LightGBM and XGBoost forecasts must beat. Without these the accuracy numbers in stages 3 and 4 mean nothing: a zone's AC load is strongly periodic, so a naive repeat of last week is already a hard target.

## The three baselines

| Baseline | Definition |
|---|---|
| **Seasonal naive** | AC load from the same hour one week earlier |
| **Average profile** | Historical averages by zone, hour and day type |
| **Feature baseline (M1)** | A trained model using only calendar features and AC load lags — no indoor sensors, no weather |

**Seasonal naive is the one that matters for the KPI.** The project commits to beating it on CV(RMSE) and WAPE per zone over the held-out test period.

`M1` doubles as the first of the four feature sets compared in stages 3–4, and is the reference arm of the Diebold–Mariano test (M4 vs M1).

An additional **AC-only baseline** covers Sep 2018 – Mar 2019, the stretch with no sensor readings.

## Expected outputs

- Per-zone predictions on the validation and test windows, in the same shape the stage 3–4 models emit, so the metric code is shared.
- A per-zone metrics table: MAE, RMSE, CV(RMSE), NMBE, WAPE.

## Inputs

[`../cleaned_data/question_b_hourly_data.parquet`](../cleaned_data/) · splits and feature-set definitions in [`../README.md`](../README.md).
