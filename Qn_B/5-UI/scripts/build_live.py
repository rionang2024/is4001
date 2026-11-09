"""Export what the dashboard needs to forecast *upcoming* days in the browser.

Run from anywhere:

    python Qn_B/5-UI/scripts/build_live.py

Two trained models can run in the browser (the user picks one):
    LightGBM (final)            Qn_B/3-LightGBM, calendar + lags + weather
    XGBoost (accuracy-first)    Qn_B/4-XGBoost final_models, calendar + AC lags only

Between them they need, for every zone-hour they forecast:
    calendar            -> known for any date
    outdoor weather     -> fetched live from the Open-Meteo forecast API by the browser
    AC load + indoor    -> the building's own readings 1, 2 and 7 days earlier
    temperature lags

The CU-BEMS record ends in Dec 2019, so there are no recent readings. Until the building
supplies them (CSV upload in the UI), the lags are filled with a *typical week*: the median
reading for that zone, day type and hour over the 2019 data the model was trained on.
This script also backtests that substitution on the test period, so the UI can show how
much accuracy it costs.

Reads
    Qn_B/3-LightGBM/outputs/ac_forecaster/{model.txt, meta.json}
    Qn_B/3-LightGBM/outputs/test_predictions.parquet
    Qn_B/4-XGBoost/outputs/final_models/accuracy_first/model.json
    Qn_B/cleaned_data/question_b_model_data.parquet

Writes
    Qn_B/5-UI/public/data/live/model_<id>.json   the trees, compact, for the JS evaluators
    Qn_B/5-UI/public/data/live/inputs.json       typical week, holidays, per-model error bands + accuracy
    Qn_B/5-UI/scripts/live_check.json            sample rows + Python predictions (npm run check:live)
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import holidays
import lightgbm as lgb
import numpy as np
import pandas as pd
import xgboost as xgb

ROOT = Path(__file__).resolve().parents[3]
QB = ROOT / "Qn_B"
MODEL_DIR = QB / "3-LightGBM" / "outputs" / "ac_forecaster"
XGB_DIR = QB / "4-XGBoost" / "outputs" / "final_models" / "accuracy_first"
OUT = QB / "5-UI" / "public" / "data" / "live"
CHECK = QB / "5-UI" / "scripts" / "live_check.json"

# Day types for the typical week: 0 = Monday ... 6 = Sunday, 7 = public holiday
HOLIDAY_TYPE = 7
BAND_LOW_Q, BAND_HIGH_Q = 0.10, 0.90
HOT_DAY_QUANTILE = 0.75            # same 75th-percentile rule as StartupPlan
LAGS = {"yesterday": 1, "2_days_ago": 2, "last_week": 7}

# Building location used for the training weather (Open-Meteo matched the archive exactly here)
LOCATION = {"latitude": 13.7367, "longitude": 100.5331, "timezone": "Asia/Bangkok"}


# ----------------------------------------------------------------------------- model
def read_model_text() -> str:
    # Git on Windows can check model.txt out with CRLF, which breaks LightGBM's byte counts.
    with open(MODEL_DIR / "model.txt", newline="") as f:
        return f.read().replace("\r\n", "\n")


def export_trees(text: str) -> list[dict]:
    """Parse LightGBM's text format into compact arrays per tree."""
    trees, cur = [], None
    for line in text.split("\n"):
        if line.startswith("Tree="):
            cur = {}
            trees.append(cur)
        elif line == "end of trees":
            break
        elif cur is not None and "=" in line:
            k, v = line.split("=", 1)
            cur[k] = v.split(" ") if v else []

    def nums(t, k, cast):
        # JSON has no infinity; the largest double compares the same way for finite inputs
        return [max(min(cast(x), sys.float_info.max), -sys.float_info.max) for x in t.get(k, [])]

    out = []
    for t in trees:
        tree = {"v": nums(t, "leaf_value", float)}
        if int(t["num_leaves"][0]) > 1:
            tree.update(f=nums(t, "split_feature", int), t=nums(t, "threshold", float),
                        d=nums(t, "decision_type", int), l=nums(t, "left_child", int),
                        r=nums(t, "right_child", int))
            if int(t["num_cat"][0]) > 0:
                tree.update(cb=nums(t, "cat_boundaries", int), ct=nums(t, "cat_threshold", int))
        out.append(tree)
    return out


def predict(booster: lgb.Booster, meta: dict, df: pd.DataFrame) -> np.ndarray:
    X = df[meta["features"]].copy()
    X["zone_code"] = pd.Categorical(X.zone_code.astype(int), categories=meta["zone_categories"])
    return np.clip(booster.predict(X), 0, None)


def export_xgb_trees(model: dict) -> list[dict]:
    """XGBoost JSON trees as compact arrays. A leaf (l == -1) keeps its value in t."""
    return [{"l": t["left_children"], "r": t["right_children"], "f": t["split_indices"],
             "t": t["split_conditions"], "d": [int(v) for v in t["default_left"]]}
            for t in model["learner"]["gradient_booster"]["model"]["trees"]]


def load_models() -> list[dict]:
    """Each model: id, display name, features, a Python predict(df), and its browser export."""
    meta = json.loads((MODEL_DIR / "meta.json").read_text())
    text = read_model_text()
    booster = lgb.Booster(model_str=text)

    xjson = json.loads((XGB_DIR / "model.json").read_text())
    learner = xjson["learner"]
    assert learner["gradient_booster"]["name"] == "gbtree" and learner["objective"]["name"] == "reg:squarederror"
    xfeats = learner["feature_names"]
    xbooster = xgb.Booster(model_file=str(XGB_DIR / "model.json"))
    xtrees = export_xgb_trees(xjson)

    return [
        {"id": "lgbm", "name": "LightGBM (final)", "features": meta["features"], "trees": booster.num_trees(),
         "predict": lambda df: predict(booster, meta, df),
         "export": {"kind": "lgbm", "features": meta["features"], "trees": export_trees(text)}},
        {"id": "xgb", "name": "XGBoost (accuracy-first)", "features": xfeats, "trees": len(xtrees),
         "predict": lambda df: np.clip(xbooster.predict(xgb.DMatrix(df[xfeats].astype(float))), 0, None),
         "export": {"kind": "xgb", "features": xfeats, "base": float(learner["learner_model_param"]["base_score"].strip("[]")),
                    "trees": xtrees}},
    ]


# ----------------------------------------------------------------------------- calendar
def thai_holidays(years) -> dict[str, str]:
    return {str(d): n for d, n in sorted(holidays.Thailand(years=years, language="en_US").items())}


def day_type(d: pd.Series, hol: set[str]) -> pd.Series:
    """Day type per date: weekday 0-6, or 7 for a holiday."""
    return np.where(d.dt.strftime("%Y-%m-%d").isin(hol), HOLIDAY_TYPE, d.dt.day_of_week)


# ----------------------------------------------------------------------------- metrics
def wape(y, f):
    return float(np.abs(y - f).sum() / np.abs(y).sum() * 100)


def scores(df: pd.DataFrame, cols: dict[str, str]) -> dict:
    out = {}
    for scope, sub in (("all", df), ("operating", df[df.is_operating_hours == 1])):
        out[scope] = {}
        for name, c in cols.items():
            y, f = sub.ac_load_kw.to_numpy(), sub[c].to_numpy()
            rmse = float(np.sqrt(np.mean((y - f) ** 2)))
            out[scope][name] = {"WAPE": round(wape(y, f), 2), "MAE": round(float(np.mean(np.abs(y - f))), 3),
                                "CVRMSE": round(rmse / y.mean() * 100, 2)}
    return out


def r(x, nd=2):
    return None if x is None or pd.isna(x) else round(float(x), nd)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    meta = json.loads((MODEL_DIR / "meta.json").read_text())
    models = load_models()

    data = pd.read_parquet(QB / "cleaned_data" / "question_b_model_data.parquet")
    data["date"] = data.timestamp.dt.normalize()

    # Holidays: library calendar plus any closure days the cleaned data marks
    hol = set(thai_holidays(range(2018, 2020)))
    hol |= set(data.loc[data.is_holiday == 1, "date"].dt.strftime("%Y-%m-%d"))

    # ---------------------------------------------------------------- typical week (2019 = model's training data)
    train = data[data.split.isin(["train", "validation"])].copy()
    train["dtype"] = day_type(train.date, hol)
    # The model data has no same-hour indoor temperature column (it would leak), but the
    # next day's "yesterday" lag is exactly that reading, so shift it back by a day.
    tin = data[["zone_id", "timestamp", "indoor_temp_c_yesterday"]].copy()
    tin["timestamp"] = tin.timestamp - pd.Timedelta(days=1)
    tin = tin.rename(columns={"indoor_temp_c_yesterday": "indoor_temp_c"})
    train = train.merge(tin, on=["zone_id", "timestamp"], how="left")

    prof_ac = train.groupby(["zone_id", "dtype", "hour"]).ac_load_kw.median()
    prof_tin = train.groupby(["zone_id", "dtype", "hour"]).indoor_temp_c.median()
    day_avg = (train.groupby(["zone_id", "date", "dtype"]).indoor_temp_c
               .agg(["mean", "count"]).reset_index())
    prof_tin_avg = day_avg[day_avg["count"] >= 22].groupby(["zone_id", "dtype"])["mean"].median()
    # Round once, so the backtest below uses exactly the values the browser gets
    prof_ac, prof_tin, prof_tin_avg = (p.round(3) for p in (prof_ac, prof_tin, prof_tin_avg))

    zones = sorted(meta["zone_map"], key=lambda z: (int(z[1]), int(z[4])))
    typical = {}
    for z in zones:
        typical[z] = {
            "ac": [[r(prof_ac.get((z, t, h)), 3) for h in range(24)] for t in range(8)],
            "tin": [[r(prof_tin.get((z, t, h)), 3) for h in range(24)] for t in range(8)],
            "tin_avg": [r(prof_tin_avg.get((z, t)), 3) for t in range(8)],
        }

    # ---------------------------------------------------------------- backtest: typical-week lags on the test period
    pred = pd.read_parquet(QB / "3-LightGBM" / "outputs" / "test_predictions.parquet")
    pred = pred[pred.scored == 1]
    test = data.drop(columns=["ac_load_kw", "is_operating_hours", "split"]).merge(
        pred[["zone_id", "timestamp", "ac_load_kw", "is_operating_hours",
              "B1 seasonal naive", "B2 average profile"]], on=["zone_id", "timestamp"])
    typ = test.copy()
    for name, k in LAGS.items():
        lag_date = typ.date - pd.Timedelta(days=k)
        dt = day_type(lag_date, hol)
        typ[f"ac_load_kw_{name}"] = [prof_ac.get((z, t, h), np.nan)
                                     for z, t, h in zip(typ.zone_id, dt, typ.hour)]
        if name in ("yesterday", "last_week"):
            typ[f"indoor_temp_c_{name}"] = [prof_tin.get((z, t, h), np.nan)
                                            for z, t, h in zip(typ.zone_id, dt, typ.hour)]
        if name == "yesterday":
            typ["indoor_temp_c_yesterday_avg"] = [prof_tin_avg.get((z, t), np.nan)
                                                  for z, t in zip(typ.zone_id, dt)]
    model_info = []
    for m in models:
        rd, ty = f"{m['id']} readings", f"{m['id']} typical week"
        test[rd], test[ty] = m["predict"](test), m["predict"](typ)

        cols = {"readings": rd, "typical": ty, "B1": "B1 seasonal naive", "B2": "B2 average profile"}
        accuracy = {"overall": scores(test, cols),
                    "by_zone": {z: scores(g, cols) for z, g in test.groupby("zone_id")}}

        # Error band per zone x hour, for each input mode
        bands = {}
        for mode, c in (("readings", rd), ("typical", ty)):
            q = (test.assign(res=test.ac_load_kw - test[c]).groupby(["zone_id", "hour"]).res
                 .quantile([BAND_LOW_Q, BAND_HIGH_Q]).unstack())
            bands[mode] = {z: {"lo": [r(q.loc[(z, h), BAND_LOW_Q]) for h in range(24)],
                               "hi": [r(q.loc[(z, h), BAND_HIGH_Q]) for h in range(24)]} for z in zones}

        model_info.append({"id": m["id"], "name": m["name"], "file": f"model_{m['id']}.json",
                           "trained_on": meta["metadata"]["trained_on"], "trees": m["trees"],
                           "features": m["features"], "accuracy": accuracy, "bands": bands})

    # Hot-day threshold from 2019 daily mean outdoor temperature
    temps = train.groupby("date").outdoor_temp_daily_avg_c.first()
    hot = float(temps.quantile(HOT_DAY_QUANTILE))

    this_year = date.today().year
    inputs = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "zone_map": meta["zone_map"],
        "zones": [{"id": z, "floor": int(z[1]), "zone": int(z[4])} for z in zones],
        "location": LOCATION,
        "holidays": thai_holidays(range(this_year - 1, this_year + 3)),
        "typical": typical,
        "models": model_info,
        "hot_day_temp": round(hot, 1),
        "rules": {
            "typical": "Median reading for the zone, day type (Mon–Sun or holiday) and hour over 2019, "
                       "the year the model was trained on",
            "band": f"{int(BAND_LOW_Q*100)}–{int(BAND_HIGH_Q*100)}% range of backtest errors per zone and hour, "
                    "Jul–Sep 2018 test period, for the selected input mode",
            "weather_shift": "Rain and solar radiation are taken from the next Open-Meteo hour, because "
                             "Open-Meteo labels them at the end of the hour and the training data at the start",
        },
    }

    for m in models:
        (OUT / f"model_{m['id']}.json").write_text(json.dumps(m["export"], separators=(",", ":")))
    (OUT / "model.json").unlink(missing_ok=True)        # single-model file from before
    (OUT / "inputs.json").write_text(json.dumps(inputs, separators=(",", ":")))

    # ---------------------------------------------------------------- JS evaluator check fixture
    sample = pd.concat([test.sample(300, random_state=0), typ.sample(100, random_state=1)])
    # Two test days run end to end through runForecast (calendar, typical lags, weather).
    # 2018-08-20's "last week" lag day is the 2018-08-13 holiday.
    days = ["2018-08-20", "2018-08-21"]
    wx = (data[data.zone_id == zones[0]].assign(d=lambda x: x.date.dt.strftime("%Y-%m-%d"))
          .query("d in @days").sort_values("timestamp"))
    weather = {d: {"temp": g.outdoor_temp_hourly_c.tolist(), "rh": g.outdoor_humidity_hourly_pct.tolist(),
                   "rain": g.rainfall_hourly_mm.tolist(), "solar": g.solar_radiation_hourly_wm2.tolist(),
                   "temp_avg": float(g.outdoor_temp_daily_avg_c.iloc[0]),
                   "rain_total": float(g.rainfall_daily_total_mm.iloc[0])} for d, g in wx.groupby("d")}
    e2e = test[test.date.dt.strftime("%Y-%m-%d").isin(days)]
    CHECK.write_text(json.dumps({"models": [{
        "id": m["id"], "file": f"model_{m['id']}.json",
        "rows": [[None if pd.isna(v) else v for v in row]
                 for row in sample[m["features"]].astype(float).itertuples(index=False)],
        "expected": m["predict"](sample).tolist(),
        "end_to_end": {
            "start": days[0], "days": len(days), "weather": weather,
            "holidays": sorted(d for d in hol if d.startswith("2018")),
            "expected": [[z, t.strftime("%Y-%m-%dT%H:00"), v] for z, t, v in
                         zip(e2e.zone_id, e2e.timestamp, e2e[f"{m['id']} typical week"])],
        },
    } for m in models]}))

    print(f"zones: {len(zones)} · hot day ≥ {hot:.1f} °C")
    for m in model_info:
        o = m["accuracy"]["overall"]["operating"]
        print(f"{m['name']} ({m['trees']} trees) operating-hours WAPE on Jul–Sep 2018 test: "
              + " · ".join(f"{k} {v['WAPE']}%" for k, v in o.items()))
    print(f"wrote {OUT.relative_to(ROOT)} and {CHECK.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
