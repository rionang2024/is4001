"""A tiny generated Parquet fixture in the same layout as dashboard_data/minute (real data is never committed)."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def minutes(day, n):
    return pd.date_range(f"{day} 00:00", periods=n, freq="min")


def build_rows(floor, zone, end_use, ts, power, status, reason="at_or_below_p99"):
    return pd.DataFrame({
        "timestamp": ts, "floor": np.int32(floor), "zone": np.int16(zone), "end_use": end_use,
        "power_kw": power, "reference_median_kw": 45.7, "upper_threshold_kw": 51.2,
        "status": status, "status_reason": reason,
        "exceedance_duration_minutes": np.int32(0),
    })


def make_dataset(root: Path):
    ts = minutes("2018-10-03", 24 * 60)
    # Floor 1, Zone 2, AC: amber 20:31-20:34, red from 20:35 to 20:43, green again at 20:44
    power, status, run = [], [], 0
    for t in ts:
        hm = t.strftime("%H:%M")
        high = "20:30" < hm < "20:44"
        run = run + 1 if high else 0
        power.append(85.0 if high else 40.0)
        status.append("red" if run >= 5 else "amber" if run >= 1 else "green")
    ac = build_rows(1, 2, "AC", ts, power, status)
    # a missing minute (null power, status missing) and an absent minute (no row at all)
    miss = ac["timestamp"] == pd.Timestamp("2018-10-03 12:00")
    ac.loc[miss, ["power_kw", "status", "status_reason"]] = [np.nan, "missing", "required_data_unavailable"]
    ac = ac[ac["timestamp"] != pd.Timestamp("2018-10-03 12:01")]
    lighting = build_rows(1, 2, "Lighting", ts, 17.5, "green")
    z1 = build_rows(1, 1, "Lighting", ts, 0.5, "neutral", "outside_alert_scope")
    z1_all = build_rows(1, 1, "All", ts, 0.5, "neutral", "outside_alert_scope")
    f2 = build_rows(2, 1, "AC", ts, 3.0, "green")
    f2b = build_rows(2, 2, "AC", ts, 4.0, "green")
    f2b.loc[f2b["timestamp"] == pd.Timestamp("2018-10-03 20:35"), "power_kw"] = np.nan
    by_floor = {1: pd.concat([ac, lighting, z1, z1_all]), 2: pd.concat([f2, f2b])}
    for fl, df in by_floor.items():
        d = root / f"floor={fl}" / "month=2018-10"
        d.mkdir(parents=True)
        # shuffle: file order is not time order in the real data
        df.sample(frac=1, random_state=1).to_parquet(d / "part-00000.parquet", index=False)


@pytest.fixture(scope="session")
def client(tmp_path_factory):
    import app as qa_app
    from fastapi.testclient import TestClient

    root = tmp_path_factory.mktemp("minute")
    make_dataset(root)
    qa_app.DATA_DIR = root
    return TestClient(qa_app.app)
