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

## Multicollinearity diagnostic

[`Multicollinearity.ipynb`](Multicollinearity.ipynb) analyses the M4
independent variables using the 2019 training rows. It includes a Pearson
correlation heatmap, high-correlation pairs, and VIF. The generated diagnostic
files are under `outputs/multicollinearity/`.

The current diagnostic identifies `floor` and `zone_code` as highly correlated
because `zone_code` encodes the zone's floor, and also identifies strong
relationships among outdoor temperature/humidity variables. This does not
prevent XGBoost from training, but correlated variables can split gain and
SHAP attribution across features, so importance should be interpreted by
feature groups as well as by individual variable.

## LightGBM versus XGBoost

[`Model_Comparison.ipynb`](Model_Comparison.ipynb) compares the existing
LightGBM outputs with the research-preserving reduced XGBoost model on the exact common scored
`zone_id + timestamp` rows. It reports overall and operating-hours metrics,
metric winners, a comparison plot, and per-zone winners. Generated comparison
tables and plots are saved under `outputs/model_comparison/`.

[`Final_Model_Selection.ipynb`](Final_Model_Selection.ipynb) documents the
conservative reduced-feature experiment. It produces an accuracy-first model
and a research-preserving M4 model under `outputs/final_models/`. In the
completed run, removing `month` from M1 improved operating-hours WAPE from
10.97% to 10.81%; removing `rainfall_hourly_mm` and
`indoor_humidity_pct_last_week` from M4 reduced performance to 12.87%.
Therefore, the recommended final predictive model is the accuracy-first
candidate, while the original full M4 remains the feature-complete model for
research interpretation.

## Reporting

Report alongside LightGBM rather than instead of it. If the two disagree materially on a zone, that is itself worth a line in the write-up — it usually points at thin data for that zone rather than a real modelling difference.

Comparators named in the plan also include **SARIMAX**, if time allows.

## Inputs

[`../cleaned_data/question_b_hourly_data.parquet`](../cleaned_data/) · see [`../README.md`](../README.md) for scope, splits and exclusions.
