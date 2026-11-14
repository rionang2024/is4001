"""Build the lookup files behind the "median + 3 SD" alert rule (rule id: sd).

The minute data in dashboard_data/ only carries the original P99 rule. This script leaves it alone and writes two
small files next to the API, so the API can restate every minute under the new rule, and the old rule stays one switch away:

  Qn_A/api/rules/reference_sd.parquet  per floor, zone, load, month, weekday, hour: median and SD of the frozen reference
  Qn_A/api/rules/episodes_sd.parquet   every run of RED_MIN or more consecutive minutes above the new threshold
  Qn_A/api/rules/sd_params.json        the rule's numbers (the API and the page read these)

Rule (chosen from the comparison in the chat; see Qn_A/README.md):
  threshold = median + max(K x SD, MIN_KW)         same frozen 56-day reference as the data's P99
  amber     = above threshold for 1 to RED_MIN-1 consecutive minutes
  red       = above threshold for RED_MIN or more consecutive minutes
Everything else (alert scope, validity, month-boundary reset, gaps) follows the data README.

Run from the repo root:  .venv/bin/python Qn_A/scripts/build_rules_sd.py     (about 3 minutes)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.dataset as ds

K = 3.0          # SD multiple
MIN_KW = 0.5     # minimum rise above the median, so a near-constant load cannot alert on a trivial change
RED_MIN = 15     # consecutive minutes above threshold for red
WINDOW_DAYS = 56 # same as the data's reference

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "dashboard_data" / "minute"
OUT = ROOT / "Qn_A" / "api" / "rules"
KEY = ["zone", "end_use", "dow", "hour"]
COLS = ["timestamp", "zone", "end_use", "power_kw", "upper_threshold_kw", "quality_status", "alert_scope",
        "is_public_holiday", "source_replaced_flag", "month"]


def load(d: ds.Dataset, floor: int) -> pd.DataFrame:
    t = d.to_table(columns=COLS, filter=(ds.field("floor") == floor) & (ds.field("end_use") != "All")).to_pandas()
    t["end_use"] = t["end_use"].astype(str)
    t["valid"] = (t.power_kw.notna() & (t.quality_status == "complete") & (~t.is_public_holiday)
                  & (t.source_replaced_flag.astype(str) == "No"))
    t["dow"] = t.timestamp.dt.day_of_week.astype("int8")
    t["hour"] = t.timestamp.dt.hour.astype("int8")
    return t.sort_values(["zone", "end_use", "timestamp"]).reset_index(drop=True)


def reference(t: pd.DataFrame, month: str) -> pd.DataFrame:
    start = pd.Period(month).start_time
    w = t[(t.timestamp >= start - pd.Timedelta(days=WINDOW_DAYS)) & (t.timestamp < start) & t.valid]
    g = w.groupby(KEY).power_kw
    return g.agg(med="median", sd="std")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    d = ds.dataset(SRC, format="parquet", partitioning="hive")
    refs, eps = [], []
    for floor in range(1, 8):
        t = load(d, floor)
        for m in sorted(t.month.unique()):
            cur = t[t.month == m]
            if not cur.upper_threshold_kw.notna().any():
                continue  # warm-up month: the data has no thresholds, so neither do we
            r = reference(t, m)
            x = cur.join(r, on=KEY)
            x = x[x.upper_threshold_kw.notna()].copy()      # same population as the data's own rule
            x["inscope"] = x.alert_scope & x.valid
            thr = np.maximum(x.med + K * x.sd, x.med + MIN_KW)
            ex = (x.power_kw > thr) & x.inscope
            gap = x.groupby(["zone", "end_use"]).timestamp.diff() != pd.Timedelta(minutes=1)
            rid = ((~ex) | gap).cumsum()
            ln = ex.groupby(rid).cumsum().where(ex, 0)
            runs = x[ex].assign(rid=rid[ex]).groupby("rid").agg(
                zone=("zone", "first"), end_use=("end_use", "first"), start=("timestamp", "min"), end=("timestamp", "max"),
                length=("timestamp", "size"))
            runs = runs[runs.length >= RED_MIN]
            runs.insert(0, "floor", floor)
            eps.append(runs.reset_index(drop=True))
            ref = r.reset_index()
            ref.insert(0, "month", m)
            ref.insert(0, "floor", floor)
            refs.append(ref)
        print("floor", floor, "done", flush=True)

    reference_sd = pd.concat(refs, ignore_index=True)
    reference_sd = reference_sd.astype({"floor": "int8", "zone": "int16", "dow": "int8", "hour": "int8", "med": "float64", "sd": "float64"})
    episodes = pd.concat(eps, ignore_index=True).astype({"floor": "int8", "zone": "int16", "length": "int32"})
    reference_sd.to_parquet(OUT / "reference_sd.parquet", index=False)
    episodes.to_parquet(OUT / "episodes_sd.parquet", index=False)
    (OUT / "sd_params.json").write_text(json.dumps({
        "k": K, "min_kw": MIN_KW, "red_min": RED_MIN, "window_days": WINDOW_DAYS,
        "label": f"Median + {K:g} SD, at least {MIN_KW:g} kW above the median, red after {RED_MIN} min",
    }, indent=2) + "\n")
    print(len(reference_sd), "reference rows,", len(episodes), "episodes")


if __name__ == "__main__":
    main()
