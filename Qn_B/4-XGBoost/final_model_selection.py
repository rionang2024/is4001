"""Train conservative reduced-feature XGBoost candidates.

This keeps the original M1-M4 artifacts unchanged and creates reduced-feature
models:
  - accuracy_first: reduced M1, removing the redundant floor encoding
  - research_preserving: reduced M4, retaining representative indoor/weather
    variables while removing low-gain or redundant variables
  - correlation_reduced: M4 after applying the supplied feature-selection
    exclusions for highly correlated or unavailable calendar variables
  - correlation_reduced_M1 through correlation_reduced_M4: matched ablations
    of each original feature configuration
"""

from pathlib import Path
import json
import sys

import numpy as np
import pandas as pd

from xgboost_forecaster import (
    Config,
    add_condition_labels,
    feature_sets,
    fit_final_model,
    load_inputs,
    metric_row,
    save_shap_plots,
    tune_model,
)


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT.parent / "cleaned_data"
OUTPUT_DIR = ROOT / "outputs" / "final_models"
CORRELATION_EXCLUSIONS = {"floor", "month", "is_weekend"}


def build_candidates(dictionary: pd.DataFrame) -> dict[str, list[str]]:
    sets = feature_sets(dictionary)
    m1 = sets["M1"]
    m4 = sets["M4"]
    candidates = {
        "accuracy_first": [f for f in m1 if f != "month"],
        "research_preserving": [
            f for f in m4
            if f not in {
                "rainfall_hourly_mm",
                "indoor_humidity_pct_last_week",
            }
        ],
    }
    candidates["correlation_reduced"] = [
        f for f in m4 if f not in CORRELATION_EXCLUSIONS
    ]
    for model_name, features in sets.items():
        candidates[f"correlation_reduced_{model_name}"] = [
            f for f in features if f not in CORRELATION_EXCLUSIONS
        ]
    return candidates


def run_final_models(config: Config) -> None:
    config.output_dir.mkdir(parents=True, exist_ok=True)
    data, dictionary, baseline = load_inputs(config.data_dir)
    candidates = build_candidates(dictionary)
    train = data.loc[data["split"].eq("train")].copy()
    validation = data.loc[data["split"].eq("validation")].copy()
    train_2019 = data.loc[data["split"].isin(["train", "validation"])].copy()
    test = data.loc[data["split"].eq("test")].copy()
    train_2019 = add_condition_labels(train_2019, train_2019)
    test = add_condition_labels(test, train_2019)

    definitions = {
        "accuracy_first": {
            "base": "M1",
            "dropped": ["month"],
            "reason": "month had low gain in M1 while the remaining calendar features encode the operating pattern",
        },
        "research_preserving": {
            "base": "M4",
            "dropped": [
                "rainfall_hourly_mm",
                "indoor_humidity_pct_last_week",
            ],
            "reason": "conservative removal of redundant or low-gain variables while retaining indoor and weather groups",
        },
        "correlation_reduced": {
            "base": "M4",
            "dropped": ["floor", "month", "is_weekend"],
            "reason": "applies the supplied feature-selection exclusions: floor is nearly determined by zone_code, is_weekend by weekday, and validation months are absent from the training months",
        },
    }
    for model_name in ("M1", "M2", "M3", "M4"):
        definitions[f"correlation_reduced_{model_name}"] = {
            "base": model_name,
            "dropped": sorted(
                set(feature_sets(dictionary)[model_name]) & CORRELATION_EXCLUSIONS
            ),
            "reason": "matched ablation applying the supplied feature-selection exclusions to the original feature set",
        }
    all_trials, all_metrics, prediction_frames = [], [], []

    for model_name, features in candidates.items():
        best_params, trials = tune_model(
            train, validation, features, model_name, config
        )
        all_trials.append(trials)
        model = fit_final_model(train_2019, features, best_params, config)
        model_dir = config.output_dir / model_name
        model_dir.mkdir(parents=True, exist_ok=True)
        model.save_model(model_dir / "model.json")
        (model_dir / "metadata.json").write_text(
            json.dumps(
                {
                    **definitions[model_name],
                    "model": model_name,
                    "features": features,
                    "params": best_params,
                },
                indent=2,
            )
        )
        importance = model.get_booster().get_score(importance_type="gain")
        pd.DataFrame(
            {
                "feature": features,
                "gain": [importance.get(feature, 0.0) for feature in features],
            }
        ).sort_values("gain", ascending=False).to_csv(
            model_dir / "feature_importance.csv", index=False
        )
        save_shap_plots(
            model, test, features, model_dir, config.shap_sample, config.seed
        )
        predictions = test[
            [
                "zone_id",
                "timestamp",
                "split",
                "ac_load_kw",
                "is_operating_hours",
            ]
        ].copy()
        predictions["prediction"] = np.clip(model.predict(test[features]), 0, None)
        predictions["model"] = model_name
        predictions.to_csv(model_dir / "predictions.csv", index=False)
        prediction_frames.append(predictions)

    predictions = pd.concat(prediction_frames, ignore_index=True)
    predictions.to_csv(config.output_dir / "predictions.csv", index=False)
    pd.concat(all_trials, ignore_index=True).to_csv(
        config.output_dir / "tuning_results.csv", index=False
    )

    common = predictions.merge(
        baseline[["zone_id", "timestamp", "scored"]],
        on=["zone_id", "timestamp"],
        how="inner",
    )
    common = common.loc[common["scored"].eq(1)]
    metric_rows = []
    for model_name, group in common.groupby("model"):
        for label, mask in [
            ("all_hours", pd.Series(True, index=group.index)),
            ("operating_hours", group["is_operating_hours"].eq(1)),
        ]:
            metric_rows.append(
                {
                    "model": model_name,
                    "slice": label,
                    **metric_row(group.loc[mask, "ac_load_kw"], group.loc[mask, "prediction"]),
                }
            )
    pd.DataFrame(metric_rows).to_csv(
        config.output_dir / "common_metrics.csv", index=False
    )
    (config.output_dir / "feature_definitions.json").write_text(
        json.dumps(
            {"candidates": candidates, "definitions": definitions},
            indent=2,
        )
    )


if __name__ == "__main__":
    config = Config(
        data_dir=DATA_DIR,
        output_dir=OUTPUT_DIR,
        device="cpu",
        n_jobs=4,
        tuning_trials=12,
        shap_sample=3000,
    )
    run_final_models(config)
