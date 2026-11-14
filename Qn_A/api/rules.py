"""Alert rules for Question A.

Two rules can be served, chosen per request with ?rule= (or for the whole API with QA_DEFAULT_RULE):

  p99   the rule stored in the minute data (above the frozen 56-day P99 for 1-4 min = amber, 5+ min = red).
        Nothing here touches it: the stored columns are returned as they are.
  sd    median + max(K x SD, MIN_KW) from the same frozen reference, amber for 1..RED_MIN-1 minutes, red for RED_MIN+.
        Built from the files in api/rules/ (see Qn_A/scripts/build_rules_sd.py). Applied here, per request, to the stored minutes.

To go back to the original rule everywhere: set QA_DEFAULT_RULE=p99, or delete api/rules/. The page also has a switch.

How a minute is restated under `sd`
  eligible  its stored status is green, amber or red (so in scope, a valid reading, a reference exists), and a threshold exists
  above     eligible and power > threshold
  run       consecutive minutes above (resets on a gap, an ineligible minute, a minute at or below threshold, or a month boundary)
  status    green (run 0), amber (1..RED_MIN-1), red (RED_MIN or more); ineligible minutes keep their stored status
  All       the worst of its eligible components; its duration is the longest component run
Runs are measured from RED_MIN-1 minutes before the first requested minute. A run that reaches back past that is at least
RED_MIN long, so its true start comes from episodes_sd.parquet (every run of RED_MIN+ minutes).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

RULES_DIR = Path(os.environ.get("QA_RULES_DIR", Path(__file__).resolve().parent / "rules"))
P99_RULE = {"id": "p99", "label": "Original: above the frozen P99, red after 5 min", "red_min": 5}
RANK = {"green": 0, "amber": 1, "red": 2}
BY_RANK = {v: k for k, v in RANK.items()}
ELIGIBLE = ("green", "amber", "red")
ONE_MIN = pd.Timedelta(minutes=1)


class SdRule:
    def __init__(self, folder: Path):
        self.params = json.loads((folder / "sd_params.json").read_text())
        self.k = float(self.params["k"])
        self.min_kw = float(self.params["min_kw"])
        self.red_min = int(self.params["red_min"])
        ref = pd.read_parquet(folder / "reference_sd.parquet")
        ref["end_use"] = ref["end_use"].astype(str)
        # one lookup table per month, indexed by floor, zone, load, weekday, hour
        self.ref = {m: g.drop(columns="month").set_index(["floor", "zone", "end_use", "dow", "hour"]).sort_index()
                    for m, g in ref.groupby("month")}
        self.episodes = pd.read_parquet(folder / "episodes_sd.parquet")
        self.episodes["end_use"] = self.episodes["end_use"].astype(str)

    @property
    def lookback(self) -> int:
        """Minutes to read before the first requested minute."""
        return self.red_min - 1

    def info(self) -> dict:
        return {"id": "sd", "label": self.params["label"], "k": self.k, "min_kw": self.min_kw, "red_min": self.red_min}

    # ------------------------------------------------------------ thresholds
    def thresholds(self, df: pd.DataFrame) -> pd.Series:
        """New threshold per row (NaN when the month has no reference for that zone, load, weekday and hour)."""
        out = pd.Series(np.nan, index=df.index)
        months = df["timestamp"].dt.strftime("%Y-%m")
        for m, idx in df.groupby(months).groups.items():
            ref = self.ref.get(m)
            if ref is None:
                continue
            part = df.loc[idx]
            key = pd.MultiIndex.from_arrays([part["floor"], part["zone"], part["end_use"],
                                             part["timestamp"].dt.day_of_week, part["timestamp"].dt.hour])
            r = ref.reindex(key)
            out.loc[idx] = np.maximum(r["med"].to_numpy() + self.k * r["sd"].to_numpy(), r["med"].to_numpy() + self.min_kw)
        return out

    # ------------------------------------------------------------ restate
    def restate(self, df: pd.DataFrame) -> pd.DataFrame:
        """Rows in (stored columns, `end_use` as str, including All rows) -> same rows with the new threshold, status and duration."""
        df = df.copy()
        df["end_use"] = df["end_use"].astype(str)
        comp = df[df["end_use"] != "All"].sort_values(["floor", "zone", "end_use", "timestamp"]).copy()
        keys = ["floor", "zone", "end_use"]
        comp["thr"] = self.thresholds(comp)
        elig = comp["status"].astype(str).isin(ELIGIBLE) & comp["thr"].notna() & comp["power_kw"].notna()
        above = elig & (comp["power_kw"] > comp["thr"])
        first = comp.groupby(keys).cumcount() == 0
        gap = comp.groupby(keys)["timestamp"].diff() != ONE_MIN
        rid = ((~above) | gap).cumsum()
        pos = above.groupby(rid).cumsum().where(above, 0)

        # a run that starts on the first row we read may have started earlier: ask the episode table (runs of red_min+)
        base = pd.Series(0, index=comp.index)
        starts = comp[above & (pos == 1) & first]
        if len(starts) and len(self.episodes):
            hit = starts.reset_index()[["index", *keys, "timestamp"]].merge(self.episodes, on=keys)
            hit = hit[(hit["start"] <= hit["timestamp"]) & (hit["timestamp"] <= hit["end"])]
            for r in hit.itertuples():
                base.loc[rid[r.index] == rid] = int((r.timestamp - r.start) / ONE_MIN)
        run = (pos + base).where(above, 0).astype(int)

        stored = comp["status"].astype(str)
        new_status = pd.Series(np.where(run >= self.red_min, "red", np.where(run >= 1, "amber", "green")), index=comp.index)
        comp["status"] = new_status.where(elig, stored)
        reason = pd.Series(np.where(run >= self.red_min, "above_threshold_red",
                                    np.where(run >= 1, "above_threshold_amber", "at_or_below_threshold")), index=comp.index)
        comp["status_reason"] = reason.where(elig, comp["status_reason"].astype(str))
        comp["exceedance_duration_minutes"] = run.where(elig, 0)
        comp["upper_threshold_kw"] = comp["thr"].where(comp["thr"].notna(), comp["upper_threshold_kw"])

        # All rows: worst eligible component, longest run
        allrows = df[df["end_use"] == "All"].copy()
        if len(allrows):
            e = comp[elig].assign(rk=comp.loc[elig, "status"].map(RANK), run=run[elig])
            g = e.groupby(["floor", "zone", "timestamp"]).agg(rk=("rk", "max"), run=("run", "max")).reset_index()
            allrows = allrows.merge(g, on=["floor", "zone", "timestamp"], how="left")
            use = allrows["rk"].notna() & allrows["status"].astype(str).isin(ELIGIBLE)
            worst = allrows["rk"].map(BY_RANK)
            allrows["status"] = worst.where(use, allrows["status"].astype(str))
            allrows["status_reason"] = pd.Series(
                np.select([worst == "red", worst == "amber"], ["highest_component_red", "highest_component_amber"],
                          "all_components_at_or_below_threshold"), index=allrows.index).where(use, allrows["status_reason"].astype(str))
            allrows["exceedance_duration_minutes"] = allrows["run"].where(use, 0).fillna(0).astype(int)
            allrows = allrows.drop(columns=["rk", "run"])
        comp = comp.drop(columns=["thr"])
        return pd.concat([comp, allrows], ignore_index=True)


_cache: dict[Path, SdRule | None] = {}


def sd_rule() -> SdRule | None:
    """The sd rule, or None when its files are not there (the API then serves p99 only)."""
    if RULES_DIR not in _cache:
        need = ("sd_params.json", "reference_sd.parquet", "episodes_sd.parquet")
        _cache[RULES_DIR] = SdRule(RULES_DIR) if all((RULES_DIR / n).exists() for n in need) else None
    return _cache[RULES_DIR]


def default_rule() -> str:
    want = os.environ.get("QA_DEFAULT_RULE", "sd")
    return "sd" if want == "sd" and sd_rule() else "p99"
