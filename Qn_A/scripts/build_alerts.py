"""Build the alert list for the Question A sidebar.

Reads the minute-level Parquet in dashboard_data/minute/ and writes one small JSON file,
Qn_B/5-UI/public/data/qa_alerts.json, that the website reads. The minute data stays on disk.

How an alert is built (the P99 status comes from the data processing, see docs/qa/dashboard_data_README.md):
  1. Take every minute that is amber or red, per floor, zone and end use (end_use "All" is skipped so nothing counts twice).
  2. Join runs of the same floor, zone and end use when the gap between them is GAP_MINUTES or less,
     so one unit switching on and off all evening is one alert, not dozens.
  3. Keep an event only if it has at least one red minute, at least MIN_MINUTES_ABOVE minutes above P99 in total,
     and an average of at least MIN_KW_ABOVE kW above P99. These cut alert fatigue: the README rule alone gives
     188 red runs for Floor 1 in October 2018.
  4. Give each alert a priority by how often its floor, zone and end use comes back:
       Recurring (High)     alerts in at least half of the months it was assessed, and in RECURRING_MIN_MONTHS+ months
       Intermittent (Medium) alerts in 2 or more months
       Occasional (Low)     alerts in one month only
     "Assessed" = months with any green, amber or red after-hours minute for that zone and end use.
     Within each priority, alerts are ranked by kWh above P99.

These cut-offs are the team's choice on top of the README, not part of it. Change them below and re-run.

Run from the repo root (uses the same Python environment as Qn_A/api):
    .venv/bin/python Qn_A/scripts/build_alerts.py          (macOS / Linux)
    .venv\\Scripts\\python Qn_A\\scripts\\build_alerts.py    (Windows)
Set QA_DATA_DIR to read the minute/ folder from somewhere else.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pyarrow.dataset as ds

GAP_MINUTES = 10        # join runs with a gap this short or shorter
MIN_MINUTES_ABOVE = 30  # minutes above P99 in the joined event
MIN_KW_ABOVE = 5.0      # average kW above P99 in the joined event
RECURRING_SHARE = 0.5     # alerts in at least this share of assessed months ...
RECURRING_MIN_MONTHS = 3  # ... and in at least this many months, to count as recurring
PRIORITY = {"Recurring": "High", "Intermittent": "Medium", "Occasional": "Low"}

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("QA_DATA_DIR", REPO_ROOT / "dashboard_data" / "minute"))
OUT = REPO_ROOT / "Qn_B" / "5-UI" / "public" / "data" / "qa_alerts.json"
COLUMNS = ["timestamp", "floor", "zone", "end_use", "power_kw", "reference_median_kw", "upper_threshold_kw", "status"]
KEY = ["floor", "zone", "end_use"]


def flagged_minutes() -> pd.DataFrame:
    """Amber and red minutes only, read one partition at a time to keep memory low."""
    dataset = ds.dataset(DATA_DIR, format="parquet", partitioning="hive")
    keep = ds.field("status").isin(["amber", "red"]) & (ds.field("end_use") != "All")
    parts = []
    for frag in dataset.get_fragments(filter=keep):
        t = frag.to_table(columns=COLUMNS, filter=keep)
        if t.num_rows:
            parts.append(t.to_pandas())
    if not parts:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.concat(parts, ignore_index=True)
    for c in ("status", "end_use"):
        df[c] = df[c].astype(str)
    df["floor"] = df["floor"].astype(int)
    df["zone"] = df["zone"].astype(int)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df.dropna(subset=["power_kw", "upper_threshold_kw"]).sort_values(KEY + ["timestamp"], ignore_index=True)


def assessed_months() -> pd.DataFrame:
    """Months with any green, amber or red minute (so the zone and end use was checked), per floor, zone and end use."""
    dataset = ds.dataset(DATA_DIR, format="parquet", partitioning="hive")
    keep = ds.field("status").isin(["green", "amber", "red"]) & (ds.field("end_use") != "All")
    parts = []
    for frag in dataset.get_fragments(filter=keep):
        t = frag.to_table(columns=["floor", "zone", "end_use"], filter=keep).to_pandas().drop_duplicates()
        if len(t):
            parts.append(t.assign(month=ds.get_partition_keys(frag.partition_expression)["month"]))
    out = pd.concat(parts, ignore_index=True)
    out["end_use"] = out["end_use"].astype(str)
    out["floor"] = out["floor"].astype(int)
    out["zone"] = out["zone"].astype(int)
    return out.drop_duplicates().groupby(KEY).size().rename("months_assessed").reset_index()


def recurrence(ev: pd.DataFrame) -> pd.DataFrame:
    ev = ev.assign(month=ev["start"].dt.strftime("%Y-%m"))
    seen = ev.groupby(KEY)["month"].nunique().rename("months_with_alerts").reset_index()
    seen = seen.merge(assessed_months(), on=KEY, how="left")
    share = seen["months_with_alerts"] / seen["months_assessed"]
    seen["recurrence"] = "Occasional"
    seen.loc[seen["months_with_alerts"] >= 2, "recurrence"] = "Intermittent"
    seen.loc[(share >= RECURRING_SHARE) & (seen["months_with_alerts"] >= RECURRING_MIN_MONTHS), "recurrence"] = "Recurring"
    ev = ev.merge(seen, on=KEY, how="left")
    ev["priority"] = ev["recurrence"].map(PRIORITY)
    rank = {"High": 0, "Medium": 1, "Low": 2}
    return ev.assign(_r=ev["priority"].map(rank)).sort_values(["_r", "kwh_above"], ascending=[True, False], ignore_index=True)


def events(df: pd.DataFrame) -> pd.DataFrame:
    gap = df.groupby(KEY)["timestamp"].diff().dt.total_seconds().div(60)
    df = df.assign(event=(gap.isna() | (gap > GAP_MINUTES + 1)).cumsum(),
                   over=df["power_kw"] - df["upper_threshold_kw"],
                   is_red=df["status"] == "red")
    g = df.groupby(KEY + ["event"])
    out = g.agg(start=("timestamp", "min"), end=("timestamp", "max"), minutes_above=("status", "size"),
                red_minutes=("is_red", "sum"), avg_kw=("power_kw", "mean"), p99_kw=("upper_threshold_kw", "mean"),
                median_kw=("reference_median_kw", "mean"), kw_above=("over", "mean"), kwh_above=("over", "sum")).reset_index()
    peak = df.loc[g["power_kw"].idxmax(), KEY + ["event", "timestamp", "power_kw"]]
    out = out.merge(peak.rename(columns={"timestamp": "peak_at", "power_kw": "peak_kw"}), on=KEY + ["event"])
    out["kwh_above"] = out["kwh_above"] / 60
    out["span_minutes"] = ((out["end"] - out["start"]).dt.total_seconds() / 60 + 1).astype(int)
    keep = (out["red_minutes"] > 0) & (out["minutes_above"] >= MIN_MINUTES_ABOVE) & (out["kw_above"] >= MIN_KW_ABOVE)
    return out[keep].sort_values("kwh_above", ascending=False, ignore_index=True), len(out)


def main() -> None:
    if not DATA_DIR.exists():
        raise SystemExit(f"Minute data not found at {DATA_DIR}. See Qn_A/README.md, or set QA_DATA_DIR.")
    df = flagged_minutes()
    ev, joined = events(df) if len(df) else (pd.DataFrame(), 0)
    if len(ev):
        ev = recurrence(ev)
    stamp = lambda t: t.strftime("%Y-%m-%dT%H:%M")
    alerts = [{
        "id": f"F{r.floor}-Z{r.zone}-{r.end_use}-{stamp(r.start)}",
        "floor": int(r.floor), "zone": int(r.zone), "end_use": r.end_use,
        "start": stamp(r.start), "end": stamp(r.end), "peak_at": stamp(r.peak_at),
        "span_minutes": int(r.span_minutes), "minutes_above": int(r.minutes_above), "red_minutes": int(r.red_minutes),
        "peak_kw": round(float(r.peak_kw), 1), "avg_kw": round(float(r.avg_kw), 1), "p99_kw": round(float(r.p99_kw), 1),
        "median_kw": None if pd.isna(r.median_kw) else round(float(r.median_kw), 1),
        "kw_above": round(float(r.kw_above), 1), "kwh_above": round(float(r.kwh_above), 1),
        "priority": r.priority, "recurrence": r.recurrence,
        "months_with_alerts": int(r.months_with_alerts), "months_assessed": int(r.months_assessed),
    } for r in ev.itertuples()]
    floors = sorted({int(f.split("=")[1]) for f in os.listdir(DATA_DIR) if f.startswith("floor=")})
    meta = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "floors_in_data": floors,
        "period": [stamp(df["timestamp"].min()), stamp(df["timestamp"].max())] if len(df) else None,
        "rule": {"gap_minutes": GAP_MINUTES, "min_minutes_above": MIN_MINUTES_ABOVE,
                 "min_kw_above": MIN_KW_ABOVE, "recurring_share": RECURRING_SHARE,
                 "recurring_min_months": RECURRING_MIN_MONTHS, "priority": PRIORITY},
        "events_before_filter": int(joined), "events": len(alerts),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"meta": meta, "alerts": alerts}, indent=1))
    print(f"{len(alerts)} alerts (from {joined} joined events) written to {OUT.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
