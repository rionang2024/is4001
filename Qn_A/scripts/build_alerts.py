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
  4. Group alerts into one problem per floor, zone and end use, with its usual pattern
     (weeknight, weekend or early morning) and typical time window.
  5. Give each problem a priority by how often its floor, zone and end use comes back:
       Recurring (High)     alerts in at least half of the months it was assessed, and in RECURRING_MIN_MONTHS+ months
       Intermittent (Medium) alerts in 2 or more months
       Occasional (Low)     alerts in one month only
     "Assessed" = months with any green, amber or red after-hours minute for that zone and end use.
     Within each priority, alerts are ranked by kWh above P99.
  6. Give each problem a next best action from a fixed rule (ACTION_RULES below), by load and usual pattern,
     linked to a Week 4 lever (schedule, lighting, behaviour), with a first check from Qn_A/README.md.

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


def pattern(ts: pd.Timestamp) -> str:
    """When an alert starts: weekend, early morning (weekday before 08:00) or weeknight (weekday from 17:00)."""
    if ts.weekday() >= 5:
        return "Weekend"
    return "Early morning" if ts.hour < 8 else "Weeknight"


def clock(minutes: float) -> str:
    m = int(round(minutes)) % 1440
    return f"{m // 60:02d}:{m % 60:02d}"


# Next best action: a fixed rule per load and usual pattern, linked to a Week 4 optimisation lever.
# Worded as checks, because there is no occupancy data. "{start}" and "{end}" fill in the usual time window.
FIRST_CHECK = {  # from Qn_A/README.md, Actions: verify the meter and rule out 24/7 equipment before changing anything
    "AC": "Verify meter mapping and confirm there is no 24/7 equipment in this zone",
    "Lighting": "Verify meter mapping and confirm it is not security or 24/7 lighting",
    "Plug": "Verify meter mapping and confirm what is plugged in",
}
ACTION_RULES = {  # (load, usual pattern) -> (lever, action)
    ("AC", "Weeknight"): ("Schedule", "Check the BMS AC stop time: AC keeps running after office hours, usually {start} to {end}"),
    ("AC", "Weekend"): ("Schedule", "Check the weekend AC schedule: AC runs on weekends, usually {start} to {end}"),
    ("AC", "Early morning"): ("Schedule", "Check the BMS AC start time: AC comes on early, usually from {start}"),
    ("Lighting", "Weeknight"): ("Lighting", "Add a timer or occupancy sensor: lights stay on after hours, usually {start} to {end}"),
    ("Lighting", "Weekend"): ("Lighting", "Add a timer or occupancy sensor: lights are on at weekends, usually {start} to {end}"),
    ("Lighting", "Early morning"): ("Schedule", "Check the lighting start time: lights come on early, usually from {start}"),
    ("Plug", "Weeknight"): ("Behaviour", "Look for equipment left on overnight, such as servers, chargers or appliances"),
    ("Plug", "Weekend"): ("Behaviour", "Look for equipment left on at weekends, such as servers, chargers or appliances"),
    ("Plug", "Early morning"): ("Behaviour", "Look for equipment switching on early, such as timers or chargers"),
}
OCCASIONAL_ACTION = ("Behaviour", "Check whether the zone was in use that day, such as an event or booking, before changing anything")
FALLBACK_ACTION = ("None", "Investigate on site: no standard pattern matched")


def next_action(end_use: str, usual: str, recurrence: str, start: str, end: str) -> dict:
    if recurrence == "Occasional":
        lever, text = OCCASIONAL_ACTION
    else:
        lever, text = ACTION_RULES.get((end_use, usual), FALLBACK_ACTION)
    return {"lever": lever, "text": text.format(start=start, end=end),
            "first_check": FIRST_CHECK.get(end_use, "Verify meter mapping on site")}


def issues(ev: pd.DataFrame, stamp) -> list[dict]:
    """One problem per floor, zone and end use: what an FM would fix once, with its alerts listed inside."""
    ev = ev.assign(pattern=ev["start"].map(pattern))
    out = []
    for (floor, zone, end_use), g in ev.groupby(KEY, sort=False):
        usual = g["pattern"].mode().iloc[0]
        u = g[g["pattern"] == usual]
        start_min = u["start"].dt.hour * 60 + u["start"].dt.minute
        end_min = u["end"].dt.hour * 60 + u["end"].dt.minute
        end_min = end_min.where(u["end"].dt.normalize() == u["start"].dt.normalize(), end_min + 1440)  # runs past midnight
        biggest = g.loc[g["kwh_above"].idxmax()]
        first = g.iloc[0]
        out.append({
            "id": f"F{floor}-Z{zone}-{end_use}", "floor": int(floor), "zone": int(zone), "end_use": end_use,
            "priority": first.priority, "recurrence": first.recurrence,
            "months_with_alerts": int(first.months_with_alerts), "months_assessed": int(first.months_assessed),
            "alerts": int(len(g)), "usual_pattern": usual, "usual_count": int(len(u)),
            "usual_start": clock(start_min.median()), "usual_end": clock(end_min.median()),
            "usual_end_next_day": bool(end_min.median() >= 1440),
            "kw_above": round(float(g["kw_above"].mean()), 1), "kwh_above": round(float(g["kwh_above"].sum()), 1),
            "peak_kw": round(float(g["peak_kw"].max()), 1),
            "first": stamp(g["start"].min()), "last": stamp(g["start"].max()),
            "biggest_alert": f"F{floor}-Z{zone}-{end_use}-{stamp(biggest.start)}",
        })
        p = out[-1]
        p["next_action"] = next_action(end_use, usual, p["recurrence"], p["usual_start"],
                                       p["usual_end"] + (" next day" if p["usual_end_next_day"] else ""))
    rank = {"High": 0, "Medium": 1, "Low": 2}
    return sorted(out, key=lambda i: (rank[i["priority"]], -i["kwh_above"]))


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
    problems = issues(ev, stamp) if len(ev) else []
    meta["issues"] = len(problems)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"meta": meta, "issues": problems, "alerts": alerts}, indent=1))
    print(f"{len(problems)} problems, {len(alerts)} alerts (from {joined} joined events) written to {OUT.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
