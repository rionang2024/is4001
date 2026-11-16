"""Real CU-BEMS meter history for the upcoming tab, so its forecast can be replayed on the same
2018-19 data the After-hours energy tab (Question A) shows.

Run from anywhere:

    python Qn_B/5-UI/scripts/build_history.py

The readings are the hourly AC load, indoor temperature and indoor humidity per zone from the
Question B model data. Its AC load is the hourly mean of Question A's minute data
(dashboard_data/minute), so both tabs show the same meters. Weather is the observed weather the
model was trained and tested with, already aligned to the start of each hour (no Open-Meteo shift).

Only Jul-Sep 2018 (the test period, which the model never saw) and Mar-Dec 2019 (the year it was
trained on) are in the Question B data; the page says which one an "as of" date falls in.

Writes
    Qn_B/5-UI/public/data/cubems/YYYY-MM.csv     monthly exports in the upload format
    Qn_B/5-UI/public/data/cubems/weather.json    observed weather per day, in the page's format
    Qn_B/5-UI/public/data/cubems/index.json      months, date ranges, holidays, presets
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import holidays
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
QB = ROOT / "Qn_B"
OUT = QB / "5-UI" / "public" / "data" / "cubems"
LAG_DAYS = 7                         # an "as of" date needs this many days of readings before it

# "As of" dates the page offers first. The forecast is made that morning from the week before. The first is the
# default: September onwards, because Question A's status colours start on 2018-09-01 (Jul-Aug 2018 is its warm-up).
PRESETS = [
    {"id": "test-sep", "start": "2018-09-18", "label": "Tue 18 Sep 2018 · test period",
     "edge": "An ordinary working week in the test period, which the model never saw."},
    {"id": "test-monday", "start": "2018-09-10", "label": "Mon 10 Sep 2018 · after a weekend",
     "edge": "A Monday: the last working day the forecast can see is the Friday before."},
    {"id": "test-holiday", "start": "2018-08-14", "label": "Tue 14 Aug 2018 · after a holiday",
     "edge": "Back to work after Mother's Day (Mon 13 Aug): the 'yesterday' inputs come from a closed day. "
             "Question A has no status colours before September 2018."},
    {"id": "2019-may", "start": "2019-05-14", "label": "Tue 14 May 2019 · training year",
     "edge": "In 2019, the year the model was trained on, so the match with the meters is optimistic."},
]


def main() -> None:
    data = pd.read_parquet(QB / "cleaned_data" / "question_b_model_data.parquet")
    # Same-hour indoor temperature and humidity = the next day's "yesterday" lags (see build_live.py)
    same = data[["zone_id", "timestamp", "indoor_temp_c_yesterday", "indoor_humidity_pct_yesterday"]].copy()
    same["timestamp"] -= pd.Timedelta(days=1)
    data = data.merge(same.rename(columns={"indoor_temp_c_yesterday": "tin", "indoor_humidity_pct_yesterday": "rh_in"}),
                      on=["zone_id", "timestamp"], how="left")
    data["d"] = data.timestamp.dt.strftime("%Y-%m-%d")
    data["m"] = data.timestamp.dt.strftime("%Y-%m")
    zones = sorted(data.zone_id.unique(), key=lambda z: (int(z[1]), int(z[4])))

    def num(x, nd):
        return "" if pd.isna(x) else f"{x:.{nd}f}"

    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    months = []
    for m, g in data.sort_values(["timestamp", "zone_id"]).groupby("m"):
        rows = [f"{z},{t:%Y-%m-%d %H:%M},{num(a, 3)},{num(ti, 2)},{num(h, 1)}"
                for z, t, a, ti, h in zip(g.zone_id, g.timestamp, g.ac_load_kw, g.tin, g.rh_in)]
        (OUT / f"{m}.csv").write_text("zone_id,timestamp,ac_load_kw,indoor_temp_c,indoor_humidity_pct\n"
                                      + "\n".join(rows) + "\n")
        months.append(m)

    # Weather is building-wide: take one zone's rows per hour, keep only days with all 24 hours
    w = data.drop_duplicates("timestamp").sort_values("timestamp")
    weather = {}
    for d, g in w.groupby("d"):
        if len(g) != 24 or g[["outdoor_temp_hourly_c", "outdoor_humidity_hourly_pct", "rainfall_hourly_mm",
                              "solar_radiation_hourly_wm2"]].isna().any().any():
            continue
        weather[d] = {"temp": g.outdoor_temp_hourly_c.round(2).tolist(), "rh": g.outdoor_humidity_hourly_pct.round(1).tolist(),
                      "rain": g.rainfall_hourly_mm.round(2).tolist(), "solar": g.solar_radiation_hourly_wm2.round(1).tolist(),
                      "temp_avg": float(g.outdoor_temp_daily_avg_c.iloc[0]), "rain_total": float(g.rainfall_daily_total_mm.iloc[0]),
                      "rh_avg": float(g.outdoor_humidity_daily_avg_pct.iloc[0]),
                      "solar_total": float(g.solar_radiation_daily_total_mjm2.iloc[0])}
    (OUT / "weather.json").write_text(json.dumps(weather, separators=(",", ":")))

    # Continuous stretches of data, and the holidays inside them (library calendar + closures the data marks)
    days = pd.to_datetime(sorted(data.d.unique()))
    breaks = days.to_series().diff().dt.days.fillna(1).ne(1).cumsum()
    ranges = [[str(g.min().date()), str(g.max().date())] for _, g in days.to_series().groupby(breaks.values)]
    hol = {str(d): n for d, n in holidays.Thailand(years=[2018, 2019], language="en_US").items()}
    for d in data.loc[data.is_holiday == 1, "d"].unique():
        hol.setdefault(d, "Office closed (marked in the data)")

    (OUT / "index.json").write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "months": months, "ranges": ranges, "lag_days": LAG_DAYS,
        "test": [str(data.loc[data.split == "test", "timestamp"].min().date()),
                 str(data.loc[data.split == "test", "timestamp"].max().date())],
        "holidays": dict(sorted(hol.items())),
        "zones": zones,
        "presets": PRESETS,
    }, indent=1))

    size = sum(f.stat().st_size for f in OUT.iterdir()) / 1e6
    print(f"CU-BEMS history {ranges}: {len(months)} monthly files, {len(weather)} weather days, {size:.1f} MB")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
