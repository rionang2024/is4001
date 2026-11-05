"""Reproducible XGBoost forecast pipeline for Question B.

Run locally with:
    python xgboost_forecaster.py --data-dir ../cleaned_data --output-dir outputs

The same script can be used in Colab with --device cuda when a CUDA-enabled
XGBoost installation is available. The default CPU path is intended for an
Apple Silicon Mac.
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
from dataclasses import asdict, dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

try:
    import xgboost as xgb
except ImportError as exc:  # pragma: no cover - exercised by setup failure
    raise ImportError(
        "XGBoost is required. Install the project dependencies first, e.g. "
        "`python -m pip install -r requirements.txt`."
    ) from exc


MODEL_NAMES = ("M1", "M2", "M3", "M4")
RANDOM_STATE = 42
TARGET = "ac_load_kw"
KEYS = ["zone_id", "timestamp"]
WEATHER_FEATURES = {
    "outdoor_temp_hourly_c",
    "outdoor_temp_daily_avg_c",
    "outdoor_humidity_hourly_pct",
    "outdoor_humidity_daily_avg_pct",
    "rainfall_hourly_mm",
    "rainfall_daily_total_mm",
    "solar_radiation_hourly_wm2",
    "solar_radiation_daily_total_mjm2",
}


@dataclass(frozen=True)
class Config:
    data_dir: Path
    output_dir: Path
    device: str = "cpu"
    seed: int = RANDOM_STATE
    n_jobs: int = 4
    tuning_trials: int = 12
    shap_sample: int = 3000
    weather_noise_seed: int = 43


def _require_columns(frame: pd.DataFrame, columns: Iterable[str], name: str) -> None:
    missing = sorted(set(columns) - set(frame.columns))
    if missing:
        raise ValueError(f"{name} is missing required columns: {missing}")


def load_inputs(data_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load and validate the modelling, dictionary, and baseline inputs."""
    data = pd.read_parquet(data_dir / "question_b_model_data.parquet")
    dictionary = pd.read_csv(data_dir / "question_b_feature_dictionary.csv")
    baseline = pd.read_parquet(data_dir / "question_b_baseline_predictions.parquet")
    _require_columns(data, ["zone_id", "timestamp", "split", TARGET], "model data")
    _require_columns(dictionary, ["column", *MODEL_NAMES], "feature dictionary")
    _require_columns(baseline, ["zone_id", "timestamp", "scored"], "baseline data")
    if data[KEYS].duplicated().any():
        raise ValueError("model data contains duplicate zone_id + timestamp keys")
    unknown_splits = set(data["split"].dropna().unique()) - {"train", "validation", "test"}
    if unknown_splits:
        raise ValueError(f"unexpected split labels: {sorted(unknown_splits)}")
    data = data.copy()
    data["timestamp"] = pd.to_datetime(data["timestamp"], errors="raise")
    baseline = baseline.copy()
    baseline["timestamp"] = pd.to_datetime(baseline["timestamp"], errors="raise")
    return data, dictionary, baseline


def feature_sets(dictionary: pd.DataFrame) -> dict[str, list[str]]:
    """Return only the columns explicitly marked Yes for each model."""
    all_columns = set(dictionary["column"].dropna())
    result: dict[str, list[str]] = {}
    for model_name in MODEL_NAMES:
        selected = dictionary.loc[dictionary[model_name].eq("Yes"), "column"].tolist()
        if not selected:
            raise ValueError(f"{model_name} has no selected features")
        if not set(selected).issubset(all_columns):
            raise ValueError(f"{model_name} contains unknown feature columns")
        result[model_name] = selected
    return result


def metric_row(actual: pd.Series, predicted: pd.Series) -> dict[str, float]:
    """Compute the requested metrics with explicit zero-denominator handling."""
    y = pd.to_numeric(actual, errors="coerce").to_numpy(float)
    p = pd.to_numeric(predicted, errors="coerce").to_numpy(float)
    mask = np.isfinite(y) & np.isfinite(p)
    y, p = y[mask], p[mask]
    if not len(y):
        return {key: np.nan for key in ("n", "mae", "rmse", "cv_rmse", "nmbe", "wape")}
    error = p - y
    mean_actual = float(np.mean(y))
    mean_abs_actual = float(np.sum(np.abs(y)))
    rmse = float(np.sqrt(np.mean(error**2)))
    return {
        "n": float(len(y)),
        "mae": float(np.mean(np.abs(error))),
        "rmse": rmse,
        "cv_rmse": rmse / mean_actual if mean_actual else np.nan,
        "nmbe": float(np.mean(error)) / mean_actual if mean_actual else np.nan,
        "wape": float(np.sum(np.abs(error)) / mean_abs_actual)
        if mean_abs_actual
        else np.nan,
    }


def score_predictions(
    predictions: pd.DataFrame,
    prediction_column: str,
    split_label: str,
    condition_columns: Iterable[str],
) -> pd.DataFrame:
    """Return all-hours, operating-hours, and requested condition breakdowns."""
    frame = predictions.loc[predictions["split"].eq(split_label)].copy()
    groups: list[tuple[str, pd.Series]] = [("all_hours", pd.Series(True, index=frame.index))]
    if "is_operating_hours" in frame:
        groups.append(("operating_hours", frame["is_operating_hours"].eq(1)))
        groups.append(("off_hours", frame["is_operating_hours"].ne(1)))
    for column in condition_columns:
        if column in frame:
            groups.extend(
                [(f"{column}=0", frame[column].eq(0)), (f"{column}=1", frame[column].eq(1))]
            )
    rows = []
    for label, mask in groups:
        subset = frame.loc[mask]
        scores = metric_row(subset[TARGET], subset[prediction_column])
        rows.append({"slice": label, **scores})
    return pd.DataFrame(rows)


def score_grouped(
    frame: pd.DataFrame,
    prediction_column: str,
    split_label: str,
    group_columns: Iterable[str],
) -> pd.DataFrame:
    """Score requested reporting dimensions while retaining the group label."""
    rows = []
    subset = frame.loc[frame["split"].eq(split_label)]
    for column in group_columns:
        if column not in subset:
            continue
        for value, group in subset.groupby(column, dropna=False):
            scores = metric_row(group[TARGET], group[prediction_column])
            rows.append({"dimension": column, "group": value, **scores})
    return pd.DataFrame(rows)


def _parameter_candidates(seed: int, n_trials: int) -> list[dict[str, object]]:
    rng = np.random.default_rng(seed)
    candidates = [
        {
            "max_depth": int(rng.choice([4, 6, 8, 10])),
            "learning_rate": float(rng.choice([0.03, 0.05, 0.08])),
            "min_child_weight": int(rng.choice([1, 5, 10])),
            "subsample": float(rng.choice([0.8, 1.0])),
            "colsample_bytree": float(rng.choice([0.8, 1.0])),
            "reg_lambda": float(rng.choice([1.0, 5.0, 20.0])),
            "reg_alpha": float(rng.choice([0.0, 0.1, 1.0])),
        }
        for _ in range(max(1, n_trials))
    ]
    return candidates


def _xgb_params(config: Config, candidate: dict[str, object]) -> dict[str, object]:
    params: dict[str, object] = {
        "objective": "reg:squarederror",
        "tree_method": "hist",
        "n_estimators": 3000,
        "early_stopping_rounds": 75,
        "random_state": config.seed,
        "n_jobs": config.n_jobs,
        "verbosity": 0,
        **candidate,
    }
    if config.device == "cuda":
        params["device"] = "cuda"
    elif config.device != "cpu":
        raise ValueError("device must be 'cpu' or 'cuda'")
    return params


def tune_model(
    train: pd.DataFrame,
    validation: pd.DataFrame,
    features: list[str],
    model_name: str,
    config: Config,
) -> tuple[dict[str, object], pd.DataFrame]:
    """Tune on validation only and return best parameters and trial results."""
    rows = []
    best: tuple[float, dict[str, object], int] | None = None
    X_train, y_train = train[features], train[TARGET]
    X_valid, y_valid = validation[features], validation[TARGET]
    for trial, candidate in enumerate(_parameter_candidates(config.seed, config.tuning_trials), 1):
        model = xgb.XGBRegressor(**_xgb_params(config, candidate))
        model.fit(X_train, y_train, eval_set=[(X_valid, y_valid)], verbose=False)
        pred = np.clip(model.predict(X_valid), 0, None)
        scores = metric_row(y_valid, pd.Series(pred))
        best_iteration = int(getattr(model, "best_iteration", model.n_estimators))
        row = {
            "model": model_name,
            "trial": trial,
            "best_iteration": best_iteration,
            **candidate,
            **{f"validation_{key}": value for key, value in scores.items()},
        }
        rows.append(row)
        if best is None or scores["rmse"] < best[0]:
            best = (scores["rmse"], candidate, best_iteration)
    if best is None:
        raise RuntimeError(f"No tuning trials completed for {model_name}")
    best_params = dict(best[1])
    best_params["n_estimators"] = best[2] + 1
    return best_params, pd.DataFrame(rows)


def fit_final_model(
    data_2019: pd.DataFrame,
    features: list[str],
    params: dict[str, object],
    config: Config,
) -> xgb.XGBRegressor:
    final_params = _xgb_params(config, {**params, "n_estimators": params["n_estimators"]})
    final_params.pop("early_stopping_rounds", None)
    model = xgb.XGBRegressor(**final_params)
    model.fit(data_2019[features], data_2019[TARGET], verbose=False)
    return model


def add_condition_labels(data: pd.DataFrame, training_2019: pd.DataFrame) -> pd.DataFrame:
    """Add stable rainy/dry and hot/cool labels derived without test leakage."""
    result = data.copy()
    if "rainfall_hourly_mm" in result:
        result["is_rainy"] = result["rainfall_hourly_mm"].fillna(0).ge(0.1).astype(int)
    if "outdoor_temp_daily_avg_c" in result:
        median_temp = training_2019["outdoor_temp_daily_avg_c"].median()
        result["is_hot_day"] = result["outdoor_temp_daily_avg_c"].ge(median_temp).astype(int)
    return result


def add_weather_noise(frame: pd.DataFrame, seed: int) -> pd.DataFrame:
    """Create a separate robustness frame with noisy weather inputs."""
    noisy = frame.copy()
    rng = np.random.default_rng(seed)
    if "outdoor_temp_hourly_c" in noisy:
        noisy["outdoor_temp_hourly_c"] += rng.normal(0, 1.5, len(noisy))
    if "outdoor_temp_daily_avg_c" in noisy:
        noisy["outdoor_temp_daily_avg_c"] += rng.normal(0, 1.5, len(noisy))
    if "rainfall_hourly_mm" in noisy:
        flips = rng.random(len(noisy)) < 0.1
        noisy.loc[flips, "rainfall_hourly_mm"] = 0
    return noisy


def diebold_mariano(actual: pd.Series, first: pd.Series, second: pd.Series) -> dict[str, float]:
    """Paired DM statistic using absolute-error loss; observations stay time ordered."""
    from scipy import stats

    y = pd.to_numeric(actual, errors="coerce").to_numpy(float)
    a = pd.to_numeric(first, errors="coerce").to_numpy(float)
    b = pd.to_numeric(second, errors="coerce").to_numpy(float)
    valid = np.isfinite(y) & np.isfinite(a) & np.isfinite(b)
    loss_difference = np.abs(a[valid] - y[valid]) - np.abs(b[valid] - y[valid])
    n = len(loss_difference)
    if n < 2 or np.std(loss_difference, ddof=1) == 0:
        return {"n": float(n), "statistic": np.nan, "p_value": np.nan}
    statistic = float(np.mean(loss_difference) / (np.std(loss_difference, ddof=1) / np.sqrt(n)))
    return {"n": float(n), "statistic": statistic, "p_value": float(2 * stats.norm.sf(abs(statistic)))}


def save_shap_plots(
    model: xgb.XGBRegressor,
    frame: pd.DataFrame,
    features: list[str],
    output_dir: Path,
    sample_size: int,
    seed: int,
) -> None:
    """Save sampled SHAP summary plots when the optional SHAP dependency exists."""
    try:
        import matplotlib.pyplot as plt
        import shap
    except ImportError as exc:
        raise ImportError(
            "SHAP outputs require the optional explainability dependencies. "
            "Install requirements.txt before running the full pipeline."
        ) from exc
    sample = frame.sample(min(sample_size, len(frame)), random_state=seed)
    explanation = shap.TreeExplainer(model)(sample[features])
    output_dir.mkdir(parents=True, exist_ok=True)
    plt.figure()
    shap.summary_plot(explanation, sample[features], show=False)
    plt.tight_layout()
    plt.savefig(output_dir / "shap_summary.png", dpi=160)
    plt.close()
    plt.figure()
    shap.summary_plot(explanation, sample[features], plot_type="bar", show=False)
    plt.tight_layout()
    plt.savefig(output_dir / "shap_bar.png", dpi=160)
    plt.close()


def package_versions() -> dict[str, str]:
    versions = {"python": platform.python_version(), "xgboost": xgb.__version__}
    for package in ("pandas", "numpy", "pyarrow", "shap"):
        try:
            versions[package] = version(package)
        except PackageNotFoundError:
            versions[package] = "not-installed"
    return versions


def run(config: Config) -> None:
    config.output_dir.mkdir(parents=True, exist_ok=True)
    data, dictionary, baseline = load_inputs(config.data_dir)
    sets = feature_sets(dictionary)
    training_2019 = data.loc[data["split"].isin(["train", "validation"])].copy()
    train = data.loc[data["split"].eq("train")].copy()
    validation = data.loc[data["split"].eq("validation")].copy()
    test = data.loc[data["split"].eq("test")].copy()
    training_2019 = add_condition_labels(training_2019, training_2019)
    data = add_condition_labels(data, training_2019)
    test = data.loc[data["split"].eq("test")].copy()
    tuning_frames, evaluation_frames, models, dm_rows = [], [], {}, []
    metadata = asdict(config)
    metadata["data_dir"] = str(config.data_dir)
    metadata["output_dir"] = str(config.output_dir)
    metadata["versions"] = package_versions()
    (config.output_dir / "run_metadata.json").write_text(json.dumps(metadata, indent=2, default=str))

    for model_name, features in sets.items():
        best_params, trials = tune_model(train, validation, features, model_name, config)
        tuning_frames.append(trials)
        model = fit_final_model(training_2019, features, best_params, config)
        models[model_name] = model
        model_dir = config.output_dir / model_name
        model_dir.mkdir(exist_ok=True)
        model.save_model(model_dir / "model.json")
        (model_dir / "metadata.json").write_text(
            json.dumps({"model": model_name, "features": features, "params": best_params}, indent=2)
        )
        scored = test[KEYS + ["split", TARGET, "is_operating_hours", "is_rainy", "is_hot_day"]].copy()
        scored[f"{model_name}_prediction"] = np.clip(model.predict(test[features]), 0, None)
        evaluation_frames.append(scored)
        importance = pd.DataFrame(
            {"feature": features, "gain": [model.get_booster().get_score(importance_type="gain").get(f, 0) for f in features]}
        ).sort_values("gain", ascending=False)
        importance.to_csv(model_dir / "feature_importance.csv", index=False)
        save_shap_plots(model, test, features, model_dir, config.shap_sample, config.seed)

    predictions = evaluation_frames[0]
    for frame in evaluation_frames[1:]:
        predictions = predictions.merge(frame[KEYS + [c for c in frame if c.endswith("_prediction")]], on=KEYS)
    predictions = predictions.merge(
        baseline, on=KEYS, how="left", suffixes=("", "_baseline")
    )
    predictions.to_csv(config.output_dir / "test_predictions.csv", index=False)
    pd.concat(tuning_frames, ignore_index=True).to_csv(config.output_dir / "tuning_results.csv", index=False)
    scores = []
    for model_name in MODEL_NAMES:
        column = f"{model_name}_prediction"
        result = score_predictions(predictions, column, "test", ["is_rainy", "is_hot_day"])
        result.insert(0, "model", model_name)
        scores.append(result)
        grouped = score_grouped(
            predictions, column, "test", ["zone_id", "floor", "is_operating_hours", "is_rainy", "is_hot_day"]
        )
        grouped.insert(0, "model", model_name)
        scores.append(grouped.assign(slice="grouped"))
    pd.concat(scores, ignore_index=True).to_csv(config.output_dir / "test_metrics.csv", index=False)
    if "scored" in predictions:
        common = predictions.loc[predictions["scored"].eq(1)].copy()
        common_scores = []
        for model_name in MODEL_NAMES:
            result = score_predictions(common, f"{model_name}_prediction", "test", [])
            result.insert(0, "model", model_name)
            common_scores.append(result)
        pd.concat(common_scores, ignore_index=True).to_csv(
            config.output_dir / "common_scored_metrics.csv", index=False
        )
    noisy_test = add_weather_noise(test, config.weather_noise_seed)
    noise_scores = []
    for model_name, model in models.items():
        noisy = test[KEYS + ["split", TARGET, "is_operating_hours"]].copy()
        noisy[f"{model_name}_prediction"] = np.clip(model.predict(noisy_test[sets[model_name]]), 0, None)
        result = score_predictions(noisy, f"{model_name}_prediction", "test", [])
        result.insert(0, "model", model_name)
        result.insert(1, "scenario", "weather_noise")
        noise_scores.append(result)
    pd.concat(noise_scores, ignore_index=True).to_csv(
        config.output_dir / "weather_noise_metrics.csv", index=False
    )
    if all(column in predictions for column in ("M1_prediction", "M4_prediction")):
        dm_rows.append(
            {"comparison": "M4_vs_M1", **diebold_mariano(
                predictions[TARGET], predictions["M4_prediction"], predictions["M1_prediction"]
            )}
        )
    baseline_column = "B1 seasonal naive" if "B1 seasonal naive" in predictions else None
    if baseline_column:
        common = predictions["scored"].eq(1) if "scored" in predictions else pd.Series(True, index=predictions.index)
        dm_rows.append(
            {"comparison": "M4_vs_baseline", **diebold_mariano(
                predictions.loc[common, TARGET], predictions.loc[common, "M4_prediction"],
                predictions.loc[common, baseline_column],
            )}
        )
    if dm_rows:
        pd.DataFrame(dm_rows).to_csv(config.output_dir / "diebold_mariano.csv", index=False)


def parse_args() -> Config:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("../cleaned_data"))
    parser.add_argument("--output-dir", type=Path, default=Path("outputs"))
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--n-jobs", type=int, default=4)
    parser.add_argument("--tuning-trials", type=int, default=12)
    parser.add_argument("--shap-sample", type=int, default=3000)
    args = parser.parse_args()
    return Config(**vars(args))


if __name__ == "__main__":
    run(parse_args())
