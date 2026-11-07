"""
Build PRELIMINARY dashboard data for Question A (after-hours energy) from the raw CU-BEMS CSVs.

This is a stand-in for Person 1's cleaned output. It applies quick, documented rules so the
charts can be built against realistic numbers. When Person 1's files are ready, they replace
the CSVs in data/dashboard/ (same file names and columns) and nothing in the JS has to change.

Usage:
    python scripts/build_mock_data.py --raw data/raw --out data/dashboard

Agreed definitions used here:
    Weekday Daytime      Mon-Fri 08:00-16:59
    Weekday After-Hours  Mon-Fri 17:00-07:59
    Weekend              Sat, Sun (all hours)
    Public holidays      removed completely (see detect_non_working_days)
"""
import argparse
import re
from pathlib import Path

import numpy as np
import pandas as pd

DAY_START, DAY_END = 8, 17          # daytime = hour >= 8 and hour < 17
MIN_MINUTES_PER_HOUR = 45            # an hour counts only if >= 45 of 60 minutes are present
MIN_COVERAGE = 0.70                  # below this, a cell is "Insufficient data"
EXCESS_FLAG_KW = 1.0                 # excess must exceed this to be flagged
PRIORITY_HIGH_KW, PRIORITY_MED_KW = 10.0, 3.0
HOLIDAY_THRESHOLD = 0.15             # weekday with daytime AC < 15% of median = non-working day

COL_RE = re.compile(r"^z(\d+)_(AC(\d+)|Light|Plug)\(kW\)$")
DT_AFTER, DT_DAY, DT_WEEKEND = "Weekday After-Hours", "Weekday Daytime", "Weekend"
AFTER_TYPES = [DT_AFTER, DT_WEEKEND]


# ---------------------------------------------------------------- loading
def load_hourly(path: Path):
    """Read one raw file, light cleaning, return hourly mean kW per column (NaN if < 45 min)."""
    df = pd.read_csv(path, low_memory=False)
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date"])                       # drops the corrupt last row of 2019 Floor 6
    kw_cols = [c for c in df.columns if COL_RE.match(c)]
    x = df[kw_cols].apply(pd.to_numeric, errors="coerce")
    x = x.mask(x < 0)
    # Spike rule: anything far above the column's normal range is treated as a meter glitch.
    cap = 5 * x.quantile(0.999) + 5
    x = x.mask(x > cap)
    hour = df["Date"].dt.floor("h")
    g = x.groupby(hour)
    mean, count = g.mean(), g.count()
    return mean.where(count >= MIN_MINUTES_PER_HOUR)


def to_series(hourly: pd.DataFrame, year: int, floor: int):
    """Wide hourly -> long rows per zone/end-use, plus AC unit rows."""
    zone_rows, unit_rows = [], []
    zones = sorted({int(COL_RE.match(c).group(1)) for c in hourly.columns})
    for z in zones:
        ac = [c for c in hourly.columns if c.startswith(f"z{z}_AC")]
        if ac:
            total = hourly[ac].sum(axis=1, min_count=len(ac))
            total[hourly[ac].isna().any(axis=1)] = np.nan   # zone AC only valid if every unit is
            zone_rows.append(("Z%d" % z, "AC", total))
            for c in ac:
                unit_rows.append(("Z%d" % z, c.split("_")[1].replace("(kW)", ""), hourly[c]))
        for eu in ("Light", "Plug"):
            col = f"z{z}_{eu}(kW)"
            if col in hourly.columns:
                zone_rows.append(("Z%d" % z, eu, hourly[col]))

    def frame(rows, key):
        parts = []
        for zone, name, s in rows:
            parts.append(pd.DataFrame({"Timestamp": s.index, "Year": year, "Floor": floor,
                                       "Zone": zone, key: name, "kW": s.values}))
        return pd.concat(parts, ignore_index=True)

    zone_df = frame(zone_rows, "End_Use")
    # Floor total: sum of every zone series, valid only when all of them are present.
    wide = zone_df.pivot(index="Timestamp", columns=["Zone", "End_Use"], values="kW")
    ftot = wide.sum(axis=1, min_count=wide.shape[1])
    ftot[wide.isna().any(axis=1)] = np.nan
    # Floor x end-use totals
    extra = [pd.DataFrame({"Timestamp": ftot.index, "Year": year, "Floor": floor, "Zone": "All",
                           "End_Use": "All", "kW": ftot.values})]
    for eu in ("AC", "Light", "Plug"):
        sub = wide.loc[:, wide.columns.get_level_values(1) == eu]
        if sub.shape[1]:
            s = sub.sum(axis=1, min_count=sub.shape[1])
            s[sub.isna().any(axis=1)] = np.nan
            extra.append(pd.DataFrame({"Timestamp": s.index, "Year": year, "Floor": floor,
                                       "Zone": "All", "End_Use": eu, "kW": s.values}))
    zone_df = pd.concat([zone_df] + extra, ignore_index=True)
    return zone_df, frame(unit_rows, "Unit")


# ---------------------------------------------------------------- calendar
def full_hour_index(year):
    if year == 2018:
        return pd.date_range("2018-07-01", "2018-12-31 23:00", freq="h")
    return pd.date_range(f"{year}-01-01", f"{year}-12-31 23:00", freq="h")


def detect_non_working_days(series: pd.DataFrame) -> pd.DataFrame:
    """Team method: weekdays where Floors 2-7 daytime AC is under 15% of its usual level.
    Weekdays with no AC data at all on most floors are logged as meter gaps, not holidays."""
    ac = series[(series.Floor >= 2) & (series.Zone == "All") & (series.End_Use == "AC")].copy()
    ac = ac[(ac.Timestamp.dt.weekday < 5) & ac.Timestamp.dt.hour.between(DAY_START, DAY_END - 1)]
    ac["Day"] = ac.Timestamp.dt.normalize()
    per_floor = ac.groupby(["Floor", "Day"])["kW"].mean().unstack(0)
    floors_present = per_floor.notna().sum(axis=1)
    norm = per_floor / per_floor.median()                  # each floor relative to its own norm
    level = norm.median(axis=1)
    out = []
    for day, v in level.items():
        if floors_present[day] < 3:
            out.append((day, "Meter gap"))
        elif v < HOLIDAY_THRESHOLD:
            out.append((day, "Public holiday (detected)"))
    all_days = pd.date_range(series.Timestamp.min().normalize(), series.Timestamp.max().normalize())
    wk = all_days[all_days.weekday < 5]
    missing = sorted(set(wk) - set(level.index))
    out += [(d, "Meter gap") for d in missing]
    return pd.DataFrame(out, columns=["Date", "Reason"]).sort_values("Date")


def day_type(ts: pd.Series) -> pd.Series:
    wd, h = ts.dt.weekday, ts.dt.hour
    return np.where(wd >= 5, DT_WEEKEND,
                    np.where((h >= DAY_START) & (h < DAY_END), DT_DAY, DT_AFTER))


# ---------------------------------------------------------------- outputs
def status(cov):
    return np.where(cov >= MIN_COVERAGE, "OK", "Insufficient data")


def build(raw: Path, out: Path):
    zone_parts, unit_parts = [], []
    for year in (2018, 2019):
        for floor in range(1, 8):
            p = raw / f"{year}Floor{floor}.csv"
            if not p.exists():
                print("missing", p)
                continue
            print("reading", p.name)
            hourly = load_hourly(p).reindex(full_hour_index(year))
            hourly.index.name = "Timestamp"
            z, u = to_series(hourly, year, floor)
            zone_parts.append(z)
            unit_parts.append(u)
    S = pd.concat(zone_parts, ignore_index=True)
    U = pd.concat(unit_parts, ignore_index=True)

    excl = detect_non_working_days(S)
    excl.assign(Date=excl.Date.dt.strftime("%Y-%m-%d")).to_csv(out / "excluded_days.csv", index=False)
    drop = set(excl.Date)
    S = S[~S.Timestamp.dt.normalize().isin(drop)].copy()
    U = U[~U.Timestamp.dt.normalize().isin(drop)].copy()
    for d in (S, U):
        d["Day_Type"] = day_type(d.Timestamp)
    keys = ["Year", "Floor", "Zone", "End_Use"]

    # ---- summary.csv : one row per floor/zone/end-use/day-type
    g = S.groupby(keys + ["Day_Type"])["kW"]
    summ = pd.DataFrame({"Actual_kW": g.mean(), "Valid_h": g.count(), "Total_h": g.size()}).reset_index()
    summ["Coverage_Pct"] = 100 * summ.Valid_h / summ.Total_h
    base = summ[summ.Day_Type == DT_DAY].set_index(keys)["Actual_kW"].rename("Daytime_Baseline_kW")
    summ = summ.join(base, on=keys)
    summ["After_Hours_Ratio"] = np.where(summ.Daytime_Baseline_kW >= 0.1,
                                         summ.Actual_kW / summ.Daytime_Baseline_kW, np.nan)
    summ["Data_Status"] = status(summ.Coverage_Pct / 100)

    # Benchmark = range of Floors 2-7 floor-level ratios with enough data, per year, day type
    # and end use (lighting naturally keeps more of its load at night than AC does).
    ft = summ[(summ.Zone == "All") & (summ.Floor >= 2)
              & (summ.Data_Status == "OK") & summ.Day_Type.isin(AFTER_TYPES)]
    bench = ft.groupby(["Year", "Day_Type", "End_Use"])["After_Hours_Ratio"].agg(["min", "max"])
    bench.columns = ["Benchmark_Low", "Benchmark_High"]
    summ = summ.join(bench, on=["Year", "Day_Type", "End_Use"])

    # Annualised hours per day type (2018 covers Jul-Dec only, so it is scaled to 12 months)
    hours = S.drop_duplicates(["Year", "Timestamp"]).groupby(["Year", "Day_Type"]).size()
    period = S.drop_duplicates(["Year", "Timestamp"]).groupby("Year").size()
    annual = (hours / period.reindex(hours.index, level=0) * 8760).rename("Annual_h")
    summ = summ.join(annual, on=["Year", "Day_Type"])

    after = summ.Day_Type.isin(AFTER_TYPES)
    expected = summ.Benchmark_High * summ.Daytime_Baseline_kW
    summ["Excess_kW"] = np.where(after, (summ.Actual_kW - expected).clip(lower=0), np.nan)
    summ["Excess_kWh_per_year"] = summ.Excess_kW * summ.Annual_h
    ratio_high = (summ.After_Hours_Ratio > summ.Benchmark_High) | (
        summ.After_Hours_Ratio.isna() & (summ.Actual_kW > summ.Daytime_Baseline_kW))
    summ["Is_Anomaly"] = after & ratio_high & (summ.Excess_kW > EXCESS_FLAG_KW) & (summ.Data_Status == "OK")
    summ["Priority"] = np.select(
        [summ.Is_Anomaly & (summ.Excess_kW >= PRIORITY_HIGH_KW),
         summ.Is_Anomaly & (summ.Excess_kW >= PRIORITY_MED_KW), summ.Is_Anomaly],
        ["High", "Medium", "Low"], default="")
    cols = keys + ["Day_Type", "Actual_kW", "Daytime_Baseline_kW", "After_Hours_Ratio",
                   "Benchmark_Low", "Benchmark_High", "Excess_kW", "Excess_kWh_per_year",
                   "Is_Anomaly", "Priority", "Coverage_Pct", "Data_Status"]
    summ = summ[cols].sort_values(keys + ["Day_Type"])
    blank = summ.Data_Status != "OK"
    summ.loc[blank, ["After_Hours_Ratio", "Excess_kW", "Excess_kWh_per_year"]] = np.nan
    summ.to_csv(out / "summary.csv", index=False, float_format="%.3f")

    # ---- profile.csv : 24-hour mean profile, weekday vs weekend
    S["Week_Part"] = np.where(S.Timestamp.dt.weekday >= 5, "Weekend", "Weekday")
    S["Hour"] = S.Timestamp.dt.hour
    prof = S.groupby(keys + ["Week_Part", "Hour"])["kW"].mean().rename("Mean_kW").reset_index()
    prof.to_csv(out / "profile.csv", index=False, float_format="%.3f")

    # ---- dow_hour.csv : day-of-week x hour mean
    S["DOW"] = S.Timestamp.dt.weekday
    dh = S.groupby(keys + ["DOW", "Hour"])["kW"].mean().rename("Mean_kW").reset_index()
    dh.to_csv(out / "dow_hour.csv", index=False, float_format="%.2f")

    # ---- monthly.csv : month x day type, with that month's own ratio
    S["Month"] = S.Timestamp.dt.strftime("%Y-%m")
    g = S.groupby(keys + ["Month", "Day_Type"])["kW"]
    mon = pd.DataFrame({"Mean_kW": g.mean(), "Valid_h": g.count(), "Total_h": g.size()}).reset_index()
    mb = mon[mon.Day_Type == DT_DAY].set_index(keys + ["Month"])["Mean_kW"].rename("Base")
    mon = mon.join(mb, on=keys + ["Month"])
    mon["After_Hours_Ratio"] = np.where(mon.Base >= 0.1, mon.Mean_kW / mon.Base, np.nan)
    allh = S.groupby(keys + ["Month"])["kW"].agg(["count", "size"]).reset_index()
    allh = allh.assign(Day_Type="All", Mean_kW=np.nan, Valid_h=allh["count"], Total_h=allh["size"])
    mon = pd.concat([mon, allh[mon.columns.drop(["Base", "After_Hours_Ratio"])]], ignore_index=True)
    mon["Coverage_Pct"] = 100 * mon.Valid_h / mon.Total_h
    mon["Data_Status"] = status(mon.Coverage_Pct / 100)
    mon.loc[mon.Data_Status != "OK", ["Mean_kW", "After_Hours_Ratio"]] = np.nan
    mon = mon[keys + ["Month", "Day_Type", "Mean_kW", "After_Hours_Ratio", "Coverage_Pct", "Data_Status"]]
    mon.to_csv(out / "monthly.csv", index=False, float_format="%.3f")

    # ---- nightly.csv : one value per floor per day (after-hours only), for spread/consistency
    F = S[(S.Zone == "All") & (S.End_Use == "All") & S.Day_Type.isin(AFTER_TYPES)].copy()
    F["Date"] = F.Timestamp.dt.strftime("%Y-%m-%d")
    g = F.groupby(["Year", "Floor", "Date", "Day_Type"])["kW"]
    ni = pd.DataFrame({"Mean_kW": g.mean(), "Valid_h": g.count(), "Total_h": g.size()}).reset_index()
    ni = ni[ni.Valid_h / ni.Total_h >= MIN_COVERAGE]
    fb = summ[(summ.Zone == "All") & (summ.End_Use == "All") & (summ.Day_Type == DT_AFTER)]
    ni = ni.join(fb.set_index(["Year", "Floor"])["Daytime_Baseline_kW"], on=["Year", "Floor"])
    ni["Ratio"] = ni.Mean_kW / ni.Daytime_Baseline_kW
    ni[["Year", "Floor", "Date", "Day_Type", "Mean_kW", "Ratio"]].to_csv(
        out / "nightly.csv", index=False, float_format="%.3f")

    # ---- units.csv : AC unit share within each zone
    g = U.groupby(["Year", "Floor", "Zone", "Unit", "Day_Type"])["kW"]
    un = pd.DataFrame({"Mean_kW": g.mean()}).reset_index()
    un["Share_Pct"] = 100 * un.Mean_kW / un.groupby(["Year", "Floor", "Zone", "Day_Type"])["Mean_kW"].transform("sum")
    un.to_csv(out / "units.csv", index=False, float_format="%.3f")

    print("done. excluded days:", len(excl))
    print(bench)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--out", default="data/dashboard")
    a = ap.parse_args()
    Path(a.out).mkdir(parents=True, exist_ok=True)
    build(Path(a.raw), Path(a.out))
