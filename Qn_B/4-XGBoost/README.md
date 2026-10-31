# 4 · XGBoost

> **Status:** empty — nothing committed yet.

Comparator to the LightGBM model in [`../3-LightGBM/`](../3-LightGBM/).

## Purpose

Same data, same splits, same four feature sets (M1–M4), same leakage rule, same metrics — only the learner changes. The point is to show that the reported accuracy is a property of the **features and framing**, not an artefact of one gradient-boosting implementation.

Keep everything that is not the model identical to stage 3, or the comparison says nothing. In particular: the same global `zone_id` model, the same day-ahead-at-00:00 horizon, and the same weather-noise test.

## Reporting

Report alongside LightGBM rather than instead of it. If the two disagree materially on a zone, that is itself worth a line in the write-up — it usually points at thin data for that zone rather than a real modelling difference.

Comparators named in the plan also include **SARIMAX**, if time allows.

## Inputs

[`../cleaned_data/question_b_hourly_data.parquet`](../cleaned_data/) · see [`../README.md`](../README.md) for scope, splits and exclusions.
