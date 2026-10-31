# 3 · LightGBM

> **Status:** empty — nothing committed yet.

The main forecasting model for Question B.

## Design

**One global model** across all 23 zones, with `zone_id` as a feature, rather than 23 separate models. Zones share far more structure than they differ by, and a global model lets the sparser zones borrow strength from the rest.

**Forecast horizon:** day-ahead hourly, issued at 00:00. A 1-hour-ahead variant is optional.

## Feature sets

The question is not just "how accurate" but "which inputs earn their place", so the model is trained four times over nested feature sets:

| Set | Features | Answers |
|---|---|---|
| **M1** | calendar + AC lags | How far do time patterns alone get us? |
| **M2** | M1 + indoor T / RH | Do indoor conditions add anything? |
| **M3** | M1 + outdoor weather | Does the weather forecast add anything? |
| **M4** | all features | Do they add anything *together*? |

**Leakage rule — this is the one to get right.** Indoor values may only be used up to the forecast time; weather is taken at the target hour, standing in for a real forecast. Using indoor temperature at the target hour would leak the answer, since indoor temperature responds to the AC that is being predicted.

## Validation

Train 2019-03-07 → 2019-12-31, validate Sep–Oct 2019, test Nov–Dec 2019, plus rolling monthly folds and an out-of-year test on 2018-07-01 → 2018-09-12.

A **weather-noise test** (±1.5 °C, rain flips) re-scores the model with degraded weather inputs, because in production the weather is a forecast and not an observation. Accuracy measured against observed weather is optimistic.

## Evaluation

MAE, RMSE, CV(RMSE), NMBE, WAPE — per zone, against the seasonal-naive baseline in [`../2-baselines/`](../2-baselines/). **Diebold–Mariano on M4 vs M1** tests whether the full feature set is a significant improvement over calendar and lags alone.

Breakdowns to report: per zone · rainy vs dry · hot vs cool · operating vs off.

## Inputs

[`../cleaned_data/question_b_hourly_data.parquet`](../cleaned_data/) · see [`../README.md`](../README.md) for scope, splits and exclusions.
