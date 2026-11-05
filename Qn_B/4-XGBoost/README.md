# 4 · XGBoost

The comparator is implemented in
[`xgboost_forecaster.py`](xgboost_forecaster.py), with an interactive wrapper
in [`XGBoost.ipynb`](XGBoost.ipynb).

Comparator to the LightGBM model in [`../3-LightGBM/`](../3-LightGBM/).

## Purpose

Same data, same splits, same four feature sets (M1–M4), same leakage rule, same metrics — only the learner changes. The point is to show that the reported accuracy is a property of the **features and framing**, not an artefact of one gradient-boosting implementation.

Keep everything that is not the model identical to stage 3, or the comparison says nothing. In particular: the same global `zone_id` model, the same day-ahead-at-00:00 horizon, and the same weather-noise test.

## Running

Install the local CPU dependencies:

```bash
python -m pip install -r requirements.txt
python xgboost_forecaster.py --data-dir ../cleaned_data --output-dir outputs
```

The default CPU path is intended for an Apple Silicon MacBook Air; no GPU is
required. In Google Colab, install the same requirements plus a CUDA-enabled
XGBoost build if available, then run with `--device cuda`. Keep the same seed,
splits, tuning trials, and output directory structure when comparing runs.

The pipeline writes four model artifacts, per-model gain importance and SHAP
plots, tuning results, test metrics, a dashboard prediction CSV, metadata, and
a Diebold–Mariano comparison. SHAP is sampled from held-out test rows to keep
local execution practical.

The checked-in notebook is execution-ready and contains the completed 12-trial
results as rendered tables and plots. The test period in the included run is
2018-07-01 through 2018-09-30, which is the supplied out-of-year holdout.

## Reporting

Report alongside LightGBM rather than instead of it. If the two disagree materially on a zone, that is itself worth a line in the write-up — it usually points at thin data for that zone rather than a real modelling difference.

Comparators named in the plan also include **SARIMAX**, if time allows.

## Inputs

[`../cleaned_data/question_b_hourly_data.parquet`](../cleaned_data/) · see [`../README.md`](../README.md) for scope, splits and exclusions.
