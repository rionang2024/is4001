# Question A: after-hours energy dashboard

Chart options for the after-hours energy question on the CU-BEMS dataset.
Python prepares the data, and the dashboard is plain HTML and JavaScript with Plotly.

## Real data and Claude Code

The real data is minute-level Parquet in `dashboard_data/` (git-ignored). See `CLAUDE.md` (project context for Claude Code),
`docs/DATA_CONTRACT.md`, `docs/TASKS.md` and `docs/HANDOFF.md`.

## Run it

Quick look: open `preview.html` (everything is bundled in, needs internet for Plotly).

Working copy:

```
python -m http.server 8000
```

then open http://localhost:8000. Opening `index.html` directly as a file will not load the CSVs.

## Folder layout

```
index.html            page layout and controls
css/style.css         styles, light and dark
js/config.js          file paths, column names, category labels (edit here when names change)
js/data.js            loads and checks the CSVs
js/charts.js          one function per chart (Person 2)
js/building.js        building explorer: isometric building, floor plans, load switches
css/building.css      styles for the building explorer
js/app.js             wires controls to charts, shortlist (Person 3 can replace)
data/dashboard/       the CSVs the dashboard reads
data/raw/             raw CU-BEMS files, not committed
scripts/build_mock_data.py   builds the preliminary CSVs from data/raw/
scripts/build_preview.py     bundles everything into preview.html
```

## Building explorer

The panel at the top of the page. Each floor of the building shows its average kW. Click a floor
(or its label) and the view swings into a 3D model of that floor: each zone is a block whose height is its
total kW for the selected loads (one scale for every floor, so floors can be compared), with an upright label
card per zone showing AC, lighting and plug load. Floors 1 and 2 use the four-zone plan and Floors 3 to 7 the
five-zone plan, as in CU-BEMS Fig. 2.

- Drag the floor to rotate it (sideways turns it, up and down tilts it on a mouse), or use the rotate buttons. Reset view restores the default angle.
- "Flat plan" lowers the blocks and straightens the camera into the classic plan view.
- The Period buttons and the three load switches filter both views, and the blocks rise or sink in place.
  The Period dropdown in the header sets the year.
- Red outline: the zone has a load flagged `Is_Anomaly`. The table under the model has the same numbers as text.

It reads only `summary.csv` (the same rows as the charts), so it needs no extra data:
floor totals use rows with `Zone = All`, zones use `Zone = Z1` to `Z5`. A zone with no row for a load shows "no meter",
and a row with `Data_Status` other than `OK` shows "insufficient data". The two zone layouts are point lists in
`js/building.js` (`PLANS`). The 3D uses plain CSS transforms, so there is no extra library.

## Swapping in Person 1's data

Replace the files in `data/dashboard/` with files that have the same names and columns,
then run `python scripts/build_preview.py` if you use the preview. No chart code changes.
If a column or label is named differently, change it in `js/config.js` only.

To rebuild the preliminary data: put the 14 raw CSVs in `data/raw/`, then

```
pip install -r requirements.txt
python scripts/build_mock_data.py
```

## Data contract

| File | One row per | Columns |
|---|---|---|
| summary.csv | year, floor, zone, end use, day type | Actual_kW, Daytime_Baseline_kW, After_Hours_Ratio, Benchmark_Low, Benchmark_High, Excess_kW, Excess_kWh_per_year, Is_Anomaly, Priority, Coverage_Pct, Data_Status |
| profile.csv | year, floor, zone, end use, weekday/weekend, hour | Mean_kW |
| dow_hour.csv | year, floor, zone, end use, day of week (0 = Mon), hour | Mean_kW |
| monthly.csv | year, month, floor, zone, end use, day type (plus "All" for coverage) | Mean_kW, After_Hours_Ratio, Coverage_Pct, Data_Status |
| nightly.csv | year, floor, date, after-hours day type | Mean_kW, Ratio |
| units.csv | year, floor, zone, AC unit, day type | Mean_kW, Share_Pct |

`Zone = All` and `End_Use = All` mean the whole floor. Day types are
`Weekday Daytime`, `Weekday After-Hours`, `Weekend`. `Data_Status` is `OK` or `Insufficient data`;
numbers are left blank when the status is not OK.

## Rules used in the preliminary data (to confirm with Person 1)

- Weekday daytime is 08:00 to 16:59. Public holidays are removed completely.
- Holidays are detected with the team's method (weekday where Floors 2 to 7 daytime AC is under 15% of normal).
  This finds 27 public holidays. The 24 Jan to 11 Feb 2019 meter gap is also removed.
- Hourly averages; an hour counts only if at least 45 minutes are present. Zone AC counts only when every unit reports.
- Spikes far above a meter's normal range are treated as glitches and removed.
- Benchmark is the range of Floors 2 to 7 floor-level ratios, per year, day type and end use.
- Excess_kW = after-hours kW minus (benchmark top × daytime kW), floored at 0.
- Flagged when ratio is above the benchmark top, excess is over 1 kW and coverage is at least 70%.
- Priority by excess: High 10 kW or more, Medium 3 to 10 kW, Low 1 to 3 kW. These cut-offs are placeholders.
- 2018 covers July to December only; its kWh per year is scaled to 12 months.
