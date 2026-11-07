"""Question A: read-only API over the minute-level Parquet in dashboard_data/.

Run from the repo root:   uvicorn Qn_A.api.app:app --port 8000   (see Qn_A/README.md)

Rules from the data README that this file enforces:
- filters are pushed into the Parquet scan and only the needed columns are read;
- results are sorted by timestamp after filtering (file order is not time order);
- nulls stay null: a missing reading is never turned into 0;
- timestamps are Bangkok local time and are never converted;
- responses are capped at MAX_ROWS rows per series and say so.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.dataset as ds
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("QA_DATA_DIR", REPO_ROOT / "dashboard_data" / "minute"))
MAX_ROWS = 1440  # one day of minutes for one series
END_USES = ("AC", "Lighting", "Plug", "All")
SERIES_COLS = [
    "timestamp", "power_kw", "reference_median_kw", "upper_threshold_kw",
    "status", "status_reason", "exceedance_duration_minutes",
]
SNAPSHOT_COLS = ["floor", "zone", "end_use"] + SERIES_COLS[1:]
TS_FMT = "%Y-%m-%dT%H:%M"

app = FastAPI(title="Question A minute data", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware,
    # local development only
    allow_origins=[f"http://{h}:{p}" for h in ("localhost", "127.0.0.1") for p in (5173, 4173)],
    allow_methods=["GET"],
    allow_headers=["*"],
)

_datasets: dict[Path, ds.Dataset] = {}
_meta_cache: dict[Path, dict] = {}


def dataset() -> ds.Dataset:
    if not DATA_DIR.exists():
        raise HTTPException(503, f"Minute data not found at {DATA_DIR}. Set QA_DATA_DIR or see Qn_A/README.md.")
    if DATA_DIR not in _datasets:
        _datasets[DATA_DIR] = ds.dataset(DATA_DIR, format="parquet", partitioning="hive")
    return _datasets[DATA_DIR]


# ---------------------------------------------------------------- parsing
def parse_day(value: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(422, "date must look like 2018-10-03")


def parse_clock(value: str, default: str) -> tuple[int, int]:
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", value or default)
    if not m or int(m[1]) > 23 or int(m[2]) > 59:
        raise HTTPException(422, "time must look like 20:35")
    return int(m[1]), int(m[2])


def window(date: str, start: str | None, end: str | None) -> tuple[pd.Timestamp, pd.Timestamp]:
    day = parse_day(date)
    sh, sm = parse_clock(start, "00:00")
    eh, em = parse_clock(end, "23:59")
    lo, hi = day.replace(hour=sh, minute=sm), day.replace(hour=eh, minute=em)
    if hi < lo:
        raise HTTPException(422, "end is before start")
    return pd.Timestamp(lo), pd.Timestamp(hi)


def check_end_use(end_use: str) -> str:
    if end_use not in END_USES:
        raise HTTPException(422, f"end_use must be one of {', '.join(END_USES)}")
    return end_use


def month_of(ts: pd.Timestamp) -> str:
    return ts.strftime("%Y-%m")


def records(df: pd.DataFrame) -> list[dict]:
    """JSON-ready rows: ISO-ish local timestamps, NaN -> null (never 0), categories -> str."""
    out = df.copy()
    if "timestamp" in out:
        out["timestamp"] = out["timestamp"].dt.strftime(TS_FMT)
    for col in out.columns:
        if isinstance(out[col].dtype, pd.CategoricalDtype):
            out[col] = out[col].astype(object)
    out = out.astype(object).where(out.notna(), None)
    return out.to_dict("records")


def scan(filter_, columns: list[str]) -> pd.DataFrame:
    return dataset().to_table(filter=filter_, columns=columns).to_pandas()


# ---------------------------------------------------------------- endpoints
@app.get("/api/meta")
def meta():
    """Floors, months, date range, and the zones and end uses that exist on each floor."""
    ds_ = dataset()
    if DATA_DIR not in _meta_cache:
        table = ds_.to_table(columns=["floor", "zone", "end_use", "month"])
        # dictionary columns carry per-file dictionaries; decode before grouping
        table = table.set_column(table.schema.get_field_index("end_use"), "end_use", table["end_use"].cast(pa.string()))
        combos = table.group_by(["floor", "zone", "end_use"]).aggregate([]).to_pandas()
        months = sorted(pc.unique(table["month"]).to_pylist())
        stamps = ds_.to_table(columns=["timestamp"])["timestamp"]
        lo, hi = pc.min_max(stamps).values()
        zones: dict[str, dict[str, list[str]]] = {}
        for r in combos.itertuples():
            zones.setdefault(str(r.floor), {}).setdefault(str(r.zone), []).append(str(r.end_use))
        order = {u: i for i, u in enumerate(END_USES)}
        zones = {f: {z: sorted(u, key=order.get) for z, u in sorted(zs.items(), key=lambda kv: int(kv[0]))}
                 for f, zs in sorted(zones.items(), key=lambda kv: int(kv[0]))}
        _meta_cache[DATA_DIR] = {
            "floors": [int(f) for f in zones],
            "months": months,
            "date_min": lo.as_py().strftime("%Y-%m-%d"),
            "date_max": hi.as_py().strftime("%Y-%m-%d"),
            "zones": zones,
            "end_uses": list(END_USES),
            "max_rows": MAX_ROWS,
            "timezone_note": "Bangkok local time, not converted",
        }
    return _meta_cache[DATA_DIR]


@app.get("/api/series")
def series(
    floor: int = Query(..., ge=1, le=7),
    zone: int = Query(..., ge=1),
    end_use: str = "All",
    date: str = Query(...),
    start: str | None = None,
    end: str | None = None,
):
    """One zone and end use for one date, sorted by time. Gaps are not filled."""
    check_end_use(end_use)
    lo, hi = window(date, start, end)
    f = (
        (ds.field("floor") == floor) & (ds.field("month") == month_of(lo)) & (ds.field("zone") == zone)
        & (ds.field("end_use") == end_use) & (ds.field("timestamp") >= lo) & (ds.field("timestamp") <= hi)
    )
    df = scan(f, SERIES_COLS).sort_values("timestamp")
    truncated = len(df) > MAX_ROWS
    return {
        "floor": floor, "zone": zone, "end_use": end_use,
        "rows": records(df.head(MAX_ROWS)), "count": min(len(df), MAX_ROWS),
        "truncated": truncated, "max_rows": MAX_ROWS,
    }


@app.get("/api/snapshot")
def snapshot(timestamp: str = Query(...), floor: int | None = Query(None, ge=1, le=7)):
    """Every zone and end use at one minute. Leave floor out to get the whole building."""
    try:
        ts = pd.Timestamp(datetime.strptime(timestamp, TS_FMT))
    except ValueError:
        raise HTTPException(422, "timestamp must look like 2018-10-03T20:35")
    f = (ds.field("month") == month_of(ts)) & (ds.field("timestamp") == ts)
    if floor is not None:
        f = f & (ds.field("floor") == floor)
    df = scan(f, SNAPSHOT_COLS).sort_values(["floor", "zone", "end_use"])
    return {"timestamp": ts.strftime(TS_FMT), "rows": records(df), "count": len(df)}


@app.get("/api/compare")
def compare(
    floors: str = Query(..., description="comma separated, e.g. 1,2,3"),
    end_use: str = "AC",
    date: str = Query(...),
    start: str | None = None,
    end: str | None = None,
):
    """Floor totals for one end use: the sum over the floor's zones that have it.

    A minute is null if any of those zones has no reading, so a partial sum is never shown as a total.
    """
    check_end_use(end_use)
    try:
        wanted = sorted({int(x) for x in floors.split(",") if x.strip()})
    except ValueError:
        raise HTTPException(422, "floors must be integers separated by commas")
    if not wanted or any(not 1 <= x <= 7 for x in wanted):
        raise HTTPException(422, "floors must be between 1 and 7")
    lo, hi = window(date, start, end)
    f = (
        ds.field("floor").isin(wanted) & (ds.field("month") == month_of(lo)) & (ds.field("end_use") == end_use)
        & (ds.field("timestamp") >= lo) & (ds.field("timestamp") <= hi)
    )
    df = scan(f, ["floor", "zone", "timestamp", "power_kw"])
    out: dict[str, list[dict]] = {}
    for fl in wanted:
        part = df[df["floor"] == fl]
        n_zones = part["zone"].nunique()
        g = part.groupby("timestamp")["power_kw"].agg(total="sum", n="count")
        g["power_kw"] = g["total"].where(g["n"] == n_zones)
        rows = g[["power_kw"]].reset_index().sort_values("timestamp").head(MAX_ROWS)
        out[str(fl)] = records(rows)
    return {"end_use": end_use, "floors": out, "max_rows": MAX_ROWS}
