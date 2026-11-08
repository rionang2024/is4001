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

The pipeline writes four model artifacts under `outputs/M1/` through
`outputs/M4/`. Supporting files are grouped by purpose:

```text
outputs/
├── M1/ ... M4/                 # model, metadata, importance, SHAP
├── predictions/                # original M1–M4 dashboard predictions
├── evaluation/                 # metrics, weather-noise, DM-test CSVs
├── tuning/                     # hyperparameter trials
├── metadata/                   # run metadata
├── final_models/               # reduced-feature candidates
├── model_comparison/           # LightGBM/XGBoost comparison
└── multicollinearity/          # correlation/VIF diagnostics
```

SHAP is sampled from held-out test rows to keep local execution practical.

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
conservative reduced-feature experiment. It produces three reduced candidates
under `outputs/final_models/`:

- `accuracy_first`: M1 without `month`.
- `research_preserving`: M4 without `rainfall_hourly_mm` and
  `indoor_humidity_pct_last_week`.
- `correlation_reduced`: M4 without `floor`, `month`, and `is_weekend`, applying
  the supplied feature-selection notebook's 21-kept/3-excluded decision.
- `correlation_reduced_M1` through `correlation_reduced_M4`: matched ablations
  of each original M1–M4 configuration with those three exclusions applied.

On the common scored operating-hour rows, the updated run produced WAPE of
10.81% for `accuracy_first`, 12.87% for `research_preserving`, and 13.03% for
`correlation_reduced`. The supplied correlation exclusions are therefore
documented and tested.

The matched ablation results on common scored operating hours were:

| Original | Original WAPE | Correlation-reduced WAPE |
|---|---:|---:|
| M1 | 10.97% | 10.94% |
| M2 | 14.09% | 13.49% |
| M3 | 11.82% | 12.91% |
| M4 | 14.70% | 13.03% |

The reduction was slightly better for M1 and M4 in this run, but worse for M2
and M3. It is therefore not a universal accuracy improvement. The original
models remain available, and the reduced variants are retained as controlled
ablation artifacts.

## Dashboard model

Use the **research-preserving** reduced model for the forecast dashboard. It is
the final M4-based model that retains indoor environmental conditions, outdoor
weather, rainfall, and solar-radiation variables while removing only
`rainfall_hourly_mm` and `indoor_humidity_pct_last_week`.

The dashboard developer should use these files:

| Purpose | Path |
|---|---|
| Trained XGBoost model | [`outputs/final_models/research_preserving/model.json`](outputs/final_models/research_preserving/model.json) |
| Exact feature list and parameters | [`outputs/final_models/research_preserving/metadata.json`](outputs/final_models/research_preserving/metadata.json) |
| Feature importance | [`outputs/final_models/research_preserving/feature_importance.csv`](outputs/final_models/research_preserving/feature_importance.csv) |
| Model-specific predictions | [`outputs/final_models/research_preserving/predictions.csv`](outputs/final_models/research_preserving/predictions.csv) |
| All reduced-model predictions | [`outputs/final_models/predictions.csv`](outputs/final_models/predictions.csv) |

The model expects exactly the feature columns listed in `metadata.json`.
Do not substitute the original M4 model without also updating the feature list
and prediction pipeline. The included predictions are test-period results for
validation/dashboard comparison; a live dashboard must construct the same
features and provide next-day forecast weather values before calling
`model.json`.

`accuracy_first` has the best measured WAPE, but it does not retain the full
indoor/weather research feature groups. The original full M4 remains available
for feature-complete research interpretation.

## Reporting

Report alongside LightGBM rather than instead of it. If the two disagree materially on a zone, that is itself worth a line in the write-up — it usually points at thin data for that zone rather than a real modelling difference.

Comparators named in the plan also include **SARIMAX**, if time allows.

## Inputs

[`../cleaned_data/question_b_hourly_data.parquet`](../cleaned_data/) · see [`../README.md`](../README.md) for scope, splits and exclusions.
