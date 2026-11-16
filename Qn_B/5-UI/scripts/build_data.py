"""Turn the Question B model outputs into small JSON files for the dashboard.

Run from the repo root (or anywhere):

    python Qn_B/5-UI/scripts/build_data.py

Reads
    Qn_B/3-LightGBM/outputs/test_predictions.parquet   (baselines + LightGBM M4, test period)
    Qn_B/cleaned_data/question_b_model_data.parquet    (weather + calendar for the same hours)
    Qn_B/3-LightGBM/outputs/test_diebold_mariano.csv   (optional)
    Qn_B/3-LightGBM/outputs/feature_group_importance.csv (optional)

Writes  Qn_B/5-UI/public/data/
    meta.json            zones, models, period, rules used below
    metrics.json         accuracy per model, overall and per zone (all hours / operating hours)
    daily.json           one row per zone per day: forecast & actual peak and energy, weather
    alerts.json          deviation alerts (actual far from forecast)
    building.json        building-level hourly totals (sum of zones) for peak coincidence
    series/<zone>.json   hourly actual, every model, prediction band and weather for one zone

Every rule (band, deviation threshold) is written into meta.json so the
dashboard can show it, and so it can be changed in one place here.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]          # repo root
QB = ROOT / "Qn_B"
OUT = QB / "5-UI" / "public" / "data"

# ----------------------------------------------------------------------------- settings
PRIMARY_MODEL = "LGBM final"     # the team's model, LightGBM with feature set M4
BASE_COLS = {"zone_id", "timestamp", "period", "split", "is_operating_hours",
             "ac_load_kw", "scored", "rainfall_hourly_mm"}
BASELINES = ["B1 seasonal naive", "B2 average profile", "B3 calendar + AC lags"]
REFERENCE_BASELINE = "B1 seasonal naive"   # the "must beat" baseline (best on test WAPE)

BAND_LOW_Q, BAND_HIGH_Q = 0.10, 0.90       # empirical band from residual quantiles
DEV_MIN_KW = 2.0                           # deviation must be at least this many kW ...
DEV_MAE_MULT = 3.0                         # ... and this many times the zone's op-hours MAE
AFTER_HOURS_ACTUAL_KW = 2.0                # after-hours: actual above this ...
AFTER_HOURS_FORECAST_KW = 0.5              # ... while forecast below this


def load_predictions() -> tuple[pd.DataFrame, list[str]]:
    pred = pd.read_parquet(QB / "3-LightGBM" / "outputs" / "test_predictions.parquet")
    pred = pred[pred["scored"] == 1].copy()
    # The baselines to compare with, then the model
    models = [m for m in BASELINES if m in pred.columns] + [PRIMARY_MODEL]
    return pred, models


def load_weather() -> pd.DataFrame:
    cols = ["zone_id", "timestamp", "floor", "zone", "is_holiday", "is_weekend",
            "outdoor_temp_hourly_c", "outdoor_temp_daily_avg_c", "outdoor_humidity_hourly_pct",
            "rainfall_daily_total_mm", "solar_radiation_hourly_wm2"]
    return pd.read_parquet(QB / "cleaned_data" / "question_b_model_data.parquet", columns=cols)


def metric_row(y: np.ndarray, f: np.ndarray) -> dict:
    err = y - f
    mean = y.mean()
    rmse = float(np.sqrt(np.mean(err ** 2)))
    return {
        "n": int(len(y)),
        "MAE": float(np.mean(np.abs(err))),
        "RMSE": rmse,
        "CVRMSE": float(rmse / mean * 100) if mean else None,
        "NMBE": float(err.sum() / (len(y) * mean) * 100) if mean else None,   # + = under-forecast
        "WAPE": float(np.abs(err).sum() / np.abs(y).sum() * 100) if y.sum() else None,
    }


def compute_metrics(df: pd.DataFrame, models: list[str]) -> dict:
    out = {"overall": {}, "by_zone": {}}
    for scope, sub in (("all", df), ("operating", df[df.is_operating_hours == 1])):
        out["overall"][scope] = {m: metric_row(sub.ac_load_kw.values, sub[m].values) for m in models}
        for zone, zsub in sub.groupby("zone_id"):
            out["by_zone"].setdefault(zone, {})[scope] = {
                m: metric_row(zsub.ac_load_kw.values, zsub[m].values) for m in models}
    return out


def r(x, nd=2):
    """Round for JSON; NaN -> None."""
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    return round(float(x), nd)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "series").mkdir(exist_ok=True)

    pred, models = load_predictions()
    df = pred.merge(load_weather(), on=["zone_id", "timestamp"], how="left")
    df = df.sort_values(["zone_id", "timestamp"]).reset_index(drop=True)
    df["date"] = df.timestamp.dt.strftime("%Y-%m-%d")
    df["hour"] = df.timestamp.dt.hour

    metrics = compute_metrics(df, models)

    # ---------------------------------------------------------------- prediction band
    # Empirical: residual quantiles per zone x hour-of-day for the primary model.
    # NOTE: computed on the test residuals themselves because only test predictions are
    # exported so far. Swap to validation residuals once P2/P3 export them.
    df["resid"] = df.ac_load_kw - df[PRIMARY_MODEL]
    q = (df.groupby(["zone_id", "hour"]).resid
           .quantile([BAND_LOW_Q, BAND_HIGH_Q]).unstack())
    q.columns = ["q_lo", "q_hi"]
    df = df.merge(q, left_on=["zone_id", "hour"], right_index=True, how="left")
    df["band_lo"] = (df[PRIMARY_MODEL] + df.q_lo).clip(lower=0)
    df["band_hi"] = (df[PRIMARY_MODEL] + df.q_hi).clip(lower=0)

    # ---------------------------------------------------------------- deviation alerts
    op_mae = {z: v["operating"][PRIMARY_MODEL]["MAE"] for z, v in metrics["by_zone"].items()
              if "operating" in v}
    df["dev_threshold"] = df.zone_id.map(lambda z: max(DEV_MIN_KW, DEV_MAE_MULT * op_mae.get(z, 0)))
    over = (df.is_operating_hours == 1) & (df.resid.abs() > df.dev_threshold)
    after = ((df.is_operating_hours == 0) & (df.ac_load_kw > AFTER_HOURS_ACTUAL_KW)
             & (df[PRIMARY_MODEL] < AFTER_HOURS_FORECAST_KW))
    alerts = df[over | after].copy()
    alerts["type"] = np.where(after[over | after], "After-hours running",
                              np.where(alerts.resid > 0, "Above forecast", "Below forecast"))
    alerts = alerts.assign(abs_dev=alerts.resid.abs()).sort_values("abs_dev", ascending=False)
    alerts_json = [
        {"zone": z, "t": t.strftime("%Y-%m-%dT%H:00"), "date": d, "forecast": r(f), "actual": r(y),
         "dev": r(e), "threshold": r(th), "type": ty}
        for z, t, d, f, y, e, th, ty in zip(alerts.zone_id, alerts.timestamp, alerts.date,
                                            alerts[PRIMARY_MODEL], alerts.ac_load_kw, alerts.resid,
                                            alerts.dev_threshold, alerts.type)]

    # ---------------------------------------------------------------- daily summary
    def day_summary(g: pd.DataFrame) -> pd.Series:
        f = g[PRIMARY_MODEL].to_numpy()
        return pd.Series({
            "forecast_peak": f.max(), "forecast_peak_hour": int(g.hour.iloc[f.argmax()]),
            "actual_peak": g.ac_load_kw.max(), "forecast_kwh": f.sum(), "actual_kwh": g.ac_load_kw.sum(),
            "hours": len(g),
            "temp_max": g.outdoor_temp_hourly_c.max(), "temp_avg": g.outdoor_temp_daily_avg_c.iloc[0],
            "rain_mm": g.rainfall_daily_total_mm.iloc[0],
            "is_holiday": int(g.is_holiday.iloc[0]), "is_weekend": int(g.is_weekend.iloc[0]),
        })

    daily = df.groupby(["zone_id", "date"]).apply(day_summary, include_groups=False).reset_index()
    daily_json = [{
        "zone": row.zone_id, "date": row.date,
        "forecast_peak": r(row.forecast_peak), "forecast_peak_hour": int(row.forecast_peak_hour),
        "actual_peak": r(row.actual_peak), "forecast_kwh": r(row.forecast_kwh, 1),
        "actual_kwh": r(row.actual_kwh, 1),
        "hours": int(row.hours), "temp_max": r(row.temp_max, 1), "temp_avg": r(row.temp_avg, 1),
        "rain_mm": r(row.rain_mm, 1), "is_holiday": int(row.is_holiday),
        "is_weekend": int(row.is_weekend),
    } for row in daily.itertuples(index=False)]

    # ---------------------------------------------------------------- building totals
    b = df.groupby("timestamp").agg(forecast=(PRIMARY_MODEL, "sum"), actual=("ac_load_kw", "sum"),
                                    zones=("zone_id", "nunique")).reset_index()
    building_json = {
        "t": b.timestamp.dt.strftime("%Y-%m-%dT%H:00").tolist(),
        "forecast": [r(v) for v in b.forecast], "actual": [r(v) for v in b.actual],
        "zones": b.zones.astype(int).tolist(),
    }

    # ---------------------------------------------------------------- per-zone series
    zones = []
    for zone, g in df.groupby("zone_id", sort=False):
        zones.append({"id": zone, "floor": int(g.floor.iloc[0]), "zone": int(g.zone.iloc[0]),
                      "hours": int(len(g))})
        series = {
            "t": g.timestamp.dt.strftime("%Y-%m-%dT%H:00").tolist(),
            "op": g.is_operating_hours.astype(int).tolist(),
            "actual": [r(v) for v in g.ac_load_kw],
            "band_lo": [r(v) for v in g.band_lo], "band_hi": [r(v) for v in g.band_hi],
            "temp": [r(v, 1) for v in g.outdoor_temp_hourly_c],
            "rain": [r(v, 1) for v in g.rainfall_hourly_mm],
            "models": {m: [r(v) for v in g[m]] for m in models},
        }
        (OUT / "series" / f"{zone}.json").write_text(json.dumps(series, separators=(",", ":")))
    zones.sort(key=lambda z: (z["floor"], z["zone"]))

    # ---------------------------------------------------------------- extras
    extras = {}
    dm_path = QB / "3-LightGBM" / "outputs" / "test_diebold_mariano.csv"
    if dm_path.exists():
        extras["diebold_mariano"] = pd.read_csv(dm_path).to_dict(orient="records")
    fg_path = QB / "3-LightGBM" / "outputs" / "feature_group_importance.csv"
    if fg_path.exists():
        fg = pd.read_csv(fg_path).rename(columns={"Unnamed: 0": "group"})
        extras["feature_groups"] = fg.to_dict(orient="records")

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "period": {"start": df.date.min(), "end": df.date.max(),
                   "label": "Test period: Jul–Sep 2018 (models trained on 2019)"},
        "zones": zones,
        "models": [{"id": m, "kind": "baseline" if m in BASELINES else "model"} for m in models],
        "primary_model": PRIMARY_MODEL,
        "reference_baseline": REFERENCE_BASELINE,
        "rules": {
            "band": f"{int(BAND_LOW_Q*100)}–{int(BAND_HIGH_Q*100)}% of past errors",
            "deviation": f"Operating hours: |actual − forecast| > max({DEV_MIN_KW} kW, "
                         f"{DEV_MAE_MULT}× the zone's operating-hours MAE). After hours: actual > "
                         f"{AFTER_HOURS_ACTUAL_KW} kW while forecast < {AFTER_HOURS_FORECAST_KW} kW.",
            "operating_hours": "Weekdays that are not holidays, 07:00–17:00",
        },
        **extras,
    }

    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
    (OUT / "metrics.json").write_text(json.dumps(metrics, separators=(",", ":")))
    (OUT / "daily.json").write_text(json.dumps(daily_json, separators=(",", ":")))
    (OUT / "alerts.json").write_text(json.dumps(alerts_json, separators=(",", ":")))
    (OUT / "building.json").write_text(json.dumps(building_json, separators=(",", ":")))

    print(f"models: {models}")
    print(f"zones: {len(zones)} · hours: {len(df):,} · days: {df.date.nunique()} · alerts: {len(alerts_json):,}")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
