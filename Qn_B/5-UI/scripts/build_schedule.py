"""When the building's AC actually switches on, from Question A's minute data, for the start-up plan.

Run from anywhere:

    python Qn_B/5-UI/scripts/build_schedule.py

On each working day (weekday, not a public holiday) a zone's switch-on minute is the first minute its AC
reaches 25% of that day's 09:00-16:00 median (days with a median under 1 kW count as AC off).
Floors 3-7 switch on together, about 07:45 (one building schedule), so the plan is building-level.
Floor 2 Z1 and Z4 follow their own time (08:00 in 2019). Zones on before 06:00 on most days run
overnight and get no start-up.

Reads   dashboard_data/minute   (Question A's minute data)
Writes  Qn_B/5-UI/public/data/schedule.json
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.dataset as ds

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "Qn_B" / "5-UI" / "public" / "data" / "schedule.json"
ON_SHARE, MIN_LEVEL_KW = 0.25, 1.0
OVERNIGHT_BEFORE = 6 * 60          # switched on before 06:00 ...
OVERNIGHT_SHARE = 0.5              # ... on most days = runs overnight
GROUPS = [                         # zones that switch on together
    {"id": "building", "label": "Floors 3–7", "floors": [3, 4, 5, 6, 7]},
    {"id": "f2", "label": "Floor 2", "floors": [2]},
]
ROUND_MIN = 5                      # plan times are rounded down to this


def main() -> None:
    t = ds.dataset(ROOT / "dashboard_data" / "minute", format="parquet", partitioning="hive").to_table(
        filter=(ds.field("end_use") == "AC") & (ds.field("floor") >= 2),
        columns=["timestamp", "floor", "zone", "power_kw", "day_type", "is_public_holiday"]).to_pandas()
    t = t[(t.day_type == "weekday") & ~t.is_public_holiday]
    t["zone_id"] = "F" + t.floor.astype(str) + "_Z" + t.zone.astype(str)
    t["date"] = t.timestamp.dt.strftime("%Y-%m-%d")
    t["m"] = t.timestamp.dt.hour * 60 + t.timestamp.dt.minute

    level = t[(t.m >= 9 * 60) & (t.m < 16 * 60)].groupby(["zone_id", "date"]).power_kw.median().rename("level")
    t = t.join(level, on=["zone_id", "date"])
    t = t[t.level >= MIN_LEVEL_KW]
    on = t[t.power_kw >= ON_SHARE * t.level].groupby(["zone_id", "date"]).m.min().rename("on").reset_index()

    overnight = sorted(z for z, g in on.groupby("zone_id") if (g.on < OVERNIGHT_BEFORE).mean() > OVERNIGHT_SHARE)
    on = on[~on.zone_id.isin(overnight) & (on.on >= OVERNIGHT_BEFORE)]

    groups, days = [], {}
    for g in GROUPS:
        zones = sorted({z for z in on.zone_id if int(z[1]) in g["floors"]}, key=lambda z: (int(z[1]), int(z[4])))
        sub = on[on.zone_id.isin(zones)]
        per_day = sub.groupby("date").on.agg(["median", "count"])
        per_day = per_day[per_day["count"] >= (len(zones) + 1) // 2]          # at least half the group's zones
        for d, m in per_day["median"].items():
            days.setdefault(d, {})[g["id"]] = int(round(m))
        latest = per_day[per_day.index >= "2019-01-01"]["median"]             # how the building runs most recently
        typical = int(latest.median() // ROUND_MIN * ROUND_MIN)
        groups.append({"id": g["id"], "label": g["label"], "zones": zones, "typical": typical,
                       "spread": [int(latest.quantile(0.25)), int(latest.quantile(0.75))]})
        print(f"{g['label']}: {len(zones)} zones, typical {typical // 60:02d}:{typical % 60:02d}, "
              f"2018 median {per_day[per_day.index < '2019-01-01']['median'].median():.0f} min, "
              f"2019 median {latest.median():.0f} min, {len(per_day)} days")

    OUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rule": f"First minute a zone's AC reaches {int(ON_SHARE * 100)}% of its 09:00–16:00 level, from the minute data",
        "round_min": ROUND_MIN, "groups": groups, "overnight": overnight,
        "days": dict(sorted(days.items())),
    }, separators=(",", ":")))
    print(f"overnight: {overnight} · {len(days)} days · wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
