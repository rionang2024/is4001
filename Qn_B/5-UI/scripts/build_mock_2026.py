"""Mock BMS history up to yesterday, so the upcoming tab can forecast next week as if the building's
meters were connected (the project has no access to a real BMS).

Run from anywhere (needs internet for the weather); re-run before a demo to extend it to yesterday:

    python Qn_B/5-UI/scripts/build_mock_2026.py

Weather is REAL: observed hourly weather for the building's grid point from the Open-Meteo archive
(the same source as the training weather), topped up with Open-Meteo's recent past for the last days
the archive has not published yet.

AC load and indoor temperature are MOCK. Each day copies how the building actually ran on its closest
2018-19 "analogue" day (same weekday, or a holiday; nearest daily mean temperature and rainfall), with
+-3% noise, so the history reacts to weather and holidays the way this building did. Two zones' meters
are blanked for two days before the September storm, to exercise the missing-data fallback.

Writes
    Qn_B/5-UI/public/data/bms/YYYY-MM.csv     monthly "BMS exports" in the upload format
    Qn_B/5-UI/public/data/bms/index.json      months, date range, replay presets
    Qn_B/5-UI/public/data/bms/weather.json    observed weather per day, in the page's format (replays)
"""

from __future__ import annotations

import json
import shutil
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import holidays
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
QB = ROOT / "Qn_B"
OUT = QB / "5-UI" / "public" / "data" / "bms"
LOCATION = {"latitude": 13.7367, "longitude": 100.5331, "timezone": "Asia/Bangkok"}
HOURLY = "temperature_2m,relative_humidity_2m,precipitation,shortwave_radiation"
FIRST_DAY = date(2025, 12, 1)            # a month before 2026, so early-January replays have inputs
NOISE = 0.03
SENSOR_GAP = {"zones": ["F2_Z4", "F7_Z5"], "days": ["2026-09-19", "2026-09-20"]}
DAYS_SHOWN = 8                           # replay window, as on the page

# "As of" dates the page can replay: forecast from the history before, compare with the history after.
PRESETS = [
    {"id": "cool", "start": "2026-01-05", "label": "Cool snap · Jan 2026",
     "edge": "Coolest days of the year (8–11 Jan, daily mean ~24 °C, lows 18 °C). The inputs include the New Year holidays."},
    {"id": "hot", "start": "2026-04-07", "label": "Hot spell · Apr 2026",
     "edge": "Hottest days of the year (up to 38 °C): hot-day rule and earlier starts. Chakri Day (6 Apr) is in the inputs."},
    {"id": "songkran", "start": "2026-04-13", "label": "Songkran · Apr 2026",
     "edge": "Three public holidays (13–15 Apr), office closed. Back to work on Thu 16 Apr with holiday inputs."},
    {"id": "flood", "start": "2026-09-21", "label": "Storm & flooding · Sep 2026",
     "edge": "124 mm of rain on Fri 25 Sep and heavy rain to the 28th, about 3x the wettest training day. "
             "Two zones' meters were offline on 19–20 Sep, so they fall back to the typical week."},
]


# ----------------------------------------------------------------------------- weather
def get(url: str, params: dict) -> pd.DataFrame:
    with urllib.request.urlopen(url + "?" + urllib.parse.urlencode(params), timeout=60) as r:
        h = json.load(r)["hourly"]
    df = pd.DataFrame(h)
    df["time"] = pd.to_datetime(df.time)
    return df.set_index("time").dropna()


def fetch_weather(first: date, last: date) -> pd.DataFrame:
    """Archive for as far as it is published, recent past from the forecast API for the rest."""
    arch = get("https://archive-api.open-meteo.com/v1/archive",
               {**LOCATION, "hourly": HOURLY, "start_date": str(first), "end_date": str(last)})
    recent = get("https://api.open-meteo.com/v1/forecast",
                 {**LOCATION, "hourly": HOURLY, "past_days": 14, "forecast_days": 2})
    return pd.concat([arch, recent[recent.index > arch.index.max()]])


def by_day(w: pd.DataFrame, d: date) -> dict | None:
    """Same shape and rules as fetchWeather() in src/live/forecast.js: rain and solar for hour h
    come from Open-Meteo hour h+1 (labelled at the end of the hour)."""
    t0 = pd.Timestamp(d)
    hrs = w.loc[t0: t0 + pd.Timedelta(hours=24)]
    if len(hrs) < 25:
        return None
    temp, rh = hrs.temperature_2m.iloc[:24].tolist(), hrs.relative_humidity_2m.iloc[:24].tolist()
    rain, solar = hrs.precipitation.iloc[1:25].tolist(), hrs.shortwave_radiation.iloc[1:25].tolist()
    return {"temp": temp, "rh": rh, "rain": [round(x, 2) for x in rain], "solar": solar,
            "temp_avg": round(float(np.mean(temp)), 3), "rain_total": round(float(np.sum(rain)), 2)}


# ----------------------------------------------------------------------------- analogue days
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def load_history() -> tuple[dict, pd.DataFrame, list[str]]:
    """2018-19 hourly AC + indoor temperature per zone-day, and one row per date with weather + kind."""
    data = pd.read_parquet(QB / "cleaned_data" / "question_b_model_data.parquet",
                           columns=["zone_id", "timestamp", "hour", "ac_load_kw", "is_holiday",
                                    "indoor_temp_c_yesterday", "outdoor_temp_daily_avg_c",
                                    "rainfall_daily_total_mm"])
    # Same-hour indoor temperature = the next day's "yesterday" lag (see build_live.py)
    tin = data[["zone_id", "timestamp", "indoor_temp_c_yesterday"]].copy()
    tin["timestamp"] -= pd.Timedelta(days=1)
    data = data.merge(tin.rename(columns={"indoor_temp_c_yesterday": "tin"}), on=["zone_id", "timestamp"], how="left")
    data["date"] = data.timestamp.dt.date

    days = data.groupby("date").agg(t=("outdoor_temp_daily_avg_c", "first"), rain=("rainfall_daily_total_mm", "first"),
                                    hol=("is_holiday", "max")).reset_index()
    days["kind"] = ["holiday" if h else WEEKDAYS[d.weekday()] for d, h in zip(days.date, days.hol)]
    hist = {k: g.set_index("hour").reindex(range(24)) for k, g in data.groupby(["zone_id", "date"])}
    zones = sorted(data.zone_id.unique(), key=lambda z: (int(z[1]), int(z[4])))
    return hist, days, zones


def analogue_ranking(days: pd.DataFrame, kind: str, t: float, rain: float) -> list:
    pool = days[days.kind == kind]
    if kind == "holiday":                                     # few holidays: quiet Sundays behave alike
        pool = days[days.kind.isin(["holiday", "sun"])]
    dist = (pool.t - t).abs() + 1.5 * (np.log1p(pool.rain) - np.log1p(rain)).abs()
    return pool.assign(dist=dist).sort_values("dist").date.tolist()


def mock_day(hist: dict, ranking: list, zone: str, rng: np.random.Generator):
    """24 h of AC + indoor temperature for one zone, from the first analogue day with full data.
    A random pick among the 3 nearest keeps runs of similar days from being identical."""
    order = ranking[:3]
    rng.shuffle(order)
    for d in order + ranking[3:]:
        g = hist.get((zone, d))
        if g is not None and g.ac_load_kw.notna().sum() >= 22 and g.tin.notna().sum() >= 20:
            g = g[["ac_load_kw", "tin"]].interpolate(limit_direction="both")   # fills a missing hour or two
            return (np.clip(g.ac_load_kw.to_numpy() * rng.normal(1, NOISE, 24), 0, None),
                    g.tin.to_numpy() + rng.normal(0, 0.1, 24))
    raise ValueError(f"no analogue day with data for {zone}")


# ----------------------------------------------------------------------------- main
def main() -> None:
    rng = np.random.default_rng(2026)
    hist, days, zones = load_history()
    yesterday = datetime.now(timezone(timedelta(hours=7))).date() - timedelta(days=1)   # Bangkok time
    w = fetch_weather(FIRST_DAY, yesterday + timedelta(days=1))
    hol = {str(d) for d in holidays.Thailand(years=range(FIRST_DAY.year, yesterday.year + 1), language="en_US")}

    weather, months = {}, {}
    d = FIRST_DAY
    while d <= yesterday:
        wd = by_day(w, d)
        if wd is None:
            print(f"no weather for {d}, history stops at {d - timedelta(days=1)}")
            break
        weather[str(d)] = wd
        kind = "holiday" if str(d) in hol else WEEKDAYS[d.weekday()]
        ranking = analogue_ranking(days, kind, wd["temp_avg"], wd["rain_total"])
        rows = months.setdefault(d.strftime("%Y-%m"), [])
        for z in zones:
            ac, tin = mock_day(hist, ranking, z, rng)
            offline = z in SENSOR_GAP["zones"] and str(d) in SENSOR_GAP["days"]
            for h in range(24):
                a, t = ("", "") if offline else (f"{ac[h]:.3f}", f"{tin[h]:.2f}")
                rows.append(f"{z},{d} {h:02d}:00,{a},{t}")
        d += timedelta(days=1)
    last = d - timedelta(days=1)

    shutil.rmtree(OUT, ignore_errors=True)
    shutil.rmtree(OUT.parent / "demo", ignore_errors=True)    # superseded scenario files
    OUT.mkdir(parents=True)
    for m, rows in months.items():
        (OUT / f"{m}.csv").write_text("zone_id,timestamp,ac_load_kw,indoor_temp_c\n" + "\n".join(rows) + "\n")
    (OUT / "weather.json").write_text(json.dumps(weather, separators=(",", ":")))

    # Replays need weather for the whole window shown and history for the 7 days before
    presets = [p for p in PRESETS if str(date.fromisoformat(p["start"]) + timedelta(days=DAYS_SHOWN - 1)) in weather]
    (OUT / "index.json").write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "first": str(FIRST_DAY), "last": str(last), "months": list(months),
        "sensor_gap": SENSOR_GAP,
        "note": "MOCK BMS data: each day copies the closest 2018–19 day for this building (same weekday or holiday, "
                "nearest temperature and rain), ±3% noise. Weather is real (Open-Meteo archive).",
        "presets": presets,
    }, indent=1))

    n = sum(len(r) for r in months.values())
    print(f"mock BMS history {FIRST_DAY} – {last}: {len(months)} monthly files, {n:,} zone-hours, {len(presets)} replay presets")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
