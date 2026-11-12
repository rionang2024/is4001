# Question A — After-Hours Energy

> How does after-hours energy use vary across floors and day-types (weekday nights vs. weekends)?

**Daytime** = weekdays 08:00–17:00 · **After-hours** = Mon–Fri 17:01–07:59 and all weekend · public holidays excluded.

> **Status:** the minute-level data and the website tab are in. The notebooks and output CSVs from the analysis are **not yet committed to this folder**; the layout below is the agreed structure for when they land.

## What is in this folder now

| Path | What it is |
|---|---|
| [`api/`](api/) | Read-only Python API (FastAPI) over the minute-level Parquet. Reads `dashboard_data/`, filters in the scan, caps response size. Tests use a tiny generated fixture. |
| `../Qn_B/5-UI/` → **After-hours energy** tab | The website page for this question: replay control, building explorer (3D floors, zone cards, AC / lighting / plug switches) and a load-profile chart. React, same stack as the Question B tab. |
| `../docs/qa/` | Context, data contract and task list used while building the page, and the original standalone prototype (reference only). |

## The data

Minute-level, cleaned CU-BEMS Parquet for all 7 floors, Jul 2018 to Dec 2019: power per zone and end use, with a historical median, a P99 threshold, a status (green / amber / red / grey / neutral) and a `status_reason` for every minute. It is about 860 MB and is committed to git, so `git pull` brings it in (126 Parquet files, none over 8 MB). Don't add more large data to the repo without asking the team: it stays in history for every clone.

It sits here, as received (`minute.zip` unzips to a `minute/` folder):

```
dashboard_data/minute/floor=1/month=2018-10/part-00000.parquet
dashboard_data/minute/floor=2/...
```

Field definitions and the rules for reading status colours are in [`../docs/qa/dashboard_data_README.md`](../docs/qa/dashboard_data_README.md) and [`../docs/qa/DATA_CONTRACT.md`](../docs/qa/DATA_CONTRACT.md).

**Check against the analysis above:** summing AC, lighting and plug per floor, Jul to Dec 2018, public holidays excluded, the minute data gives a Floor 1 weekday after-hours ratio of 1.92 and a weekend ratio of 1.56, the same as the Key findings table. Every other floor is below 1 (0.08 to 0.17 on weekday nights).

## Run it

Two terminals, from the repo root.

```bash
# 1. the data API (Python 3.10+)
python3 -m venv .venv && .venv/bin/pip install -r Qn_A/api/requirements.txt
cd Qn_A/api && ../../.venv/bin/uvicorn app:app --port 8000
```

```bash
# 2. the website (proxies /api to the API)
cd Qn_B/5-UI && npm install && npm run dev
```

Open the **After-hours energy** tab (`#/qn-a`). It opens on 2018-10-03 20:35: Floor 1, Zone 2, AC is red (amber from 20:31, red from 20:35, green again at 20:44).

**Alerts sidebar.** The sidebar reads `Qn_B/5-UI/public/data/qa_alerts.json`, a short list of alert events built from the minute data by `Qn_A/scripts/build_alerts.py`.
Re-run it after the minute data changes: `.venv/bin/python Qn_A/scripts/build_alerts.py` (Windows: `.venv\Scripts\python Qn_A\scripts\build_alerts.py`).
The joining and filter rules (10-min gaps, 30+ min and 5+ kW above P99, priority by how often a zone and load recurs: recurring = high, intermittent = medium, occasional = low) are at the top of the script and are the team's choice on top of the data README.
The committed file is built from all 7 floors.

**Live view.** The sidebar follows the replay clock: it shows an alert only from its `qualified_at` minute, rebuilds problems, priorities and totals from the alerts known by then, lists **Active now** (alerts running at that minute) and **Watching** (loads amber or red at that minute that are not an alert yet, with what they still need, from `/api/series`). Clicking a load in a floor's problem list on the building opens it in the sidebar (`QA_BUILDING.selectLoad` / `onLoadSelect` in `src/qaBuilding.js`). An event becomes an alert at the first minute it passes all three filters, so a few alerts whose average later drops below 5 kW still count.

API tests: `cd Qn_A/api && ../../.venv/bin/python -m pytest`. To read data from another folder, set `QA_DATA_DIR` to the `minute/` folder.

The API is for local use. A static host such as GitHub Pages cannot run it, so the Question A tab needs the API running somewhere reachable (set `VITE_QA_API` to its address when building).

## Alert rule: median + 3 SD (new) or P99 (original)

The minute data carries the original rule: above the zone and load's frozen P99 for 1-4 minutes is amber, 5+ is red. It flags small loads a lot (a 0.1 kW plug load can go red), so the page now defaults to a second rule, **`sd`**:

- threshold = **median + max(3 x SD, 0.5 kW)**, from the same frozen 56-day, same weekday and hour reference;
- amber = above threshold for 1-14 consecutive minutes, red = 15 or more;
- scope, validity, gaps and the month-boundary reset follow the data README.

Across Sep 2018 to Dec 2019 this takes red from 2.94% to about 0.6% of after-hours minutes, and from about 25 to about 7 zone-load alert-days a day, keeping about half of the kWh above the median (the part lost is mostly short blips).

The stored data is not changed. The API restates each minute under `sd` from two small files in `Qn_A/api/rules/` (reference median and SD, and every run of 15+ minutes above threshold), built by `Qn_A/scripts/build_rules_sd.py` (about 3 minutes; run it from the repo root with the venv).

**Going back to the original rule**, any of these:

- on the page: the **Alert rule** switch in the replay panel (Median + 3 SD / Original (P99));
- API call: add `?rule=p99` to `/api/series` or `/api/snapshot`;
- for the whole API: start it with `QA_DEFAULT_RULE=p99`, or delete `Qn_A/api/rules/`.

The numbers (3 SD, 0.5 kW, 15 minutes) are constants at the top of the build script. The alerts sidebar is still built from the original P99 status (`build_alerts.py`), so it does not change with the switch.

## Anomaly glow, red zones and the page hooks

At the minute chosen in the replay control, the page points at what is wrong:

- **Building.** A floor with a red reading glows and pulses red, an amber one glows amber more softly, and a floor with nothing wrong has no glow. A floor where nothing could be checked is muted, never green: grey (missing, too little history, excluded) is a solid tint, neutral (outside the after-hours schedule) a dashed outline. Each floor label carries an icon and a tooltip, e.g. "Floor 1 · Zone 2 · AC · red since 20:35". With `prefers-reduced-motion` the glow is static. The existing kW labels and window brightness are unchanged.
- **"At 20:35" list** above the building: each problem floor with its numbers; click one to open its plan.
- **Floor plan.** The same minute. The breached zone's block turns red and only the breaching load is red, with its numbers in red: "AC 85.2 kW vs 51.2 kW threshold · 5 min above P99 · Above P99 for 5+ minutes". Other zones and loads keep their colours.

How it is worked out (`Qn_B/5-UI/src/components/qn_a/anomaly.js`), from the minute snapshot the page already loads, with no extra endpoint:

- A load is a problem when its `status` is `amber` or `red`, for the loads that are switched on.
- `exceedance_duration_minutes` is the run of consecutive minutes above P99 up to that minute, so *above P99 since* = minute − (duration − 1) and *red since* = minute − (duration − 5). For 2018-10-03 20:35 (duration 5): amber from 20:31, red from 20:35.
- If an alert from `public/data/qa_alerts.json` (the sidebar's file) covers that floor, zone, load and minute, its start, end and peak are added to the tooltip. Short runs the sidebar filters out still glow; they just have no alert line.
- Red means investigate, not a confirmed fault.

### Event shape

An event is one entry of `alerts` in `qa_alerts.json` (built by `scripts/build_alerts.py`):

```js
{
  id: 'F1-Z2-AC-2018-10-03T18:50',
  floor: 1, zone: 2, end_use: 'AC',          // end_use: 'AC' | 'Lighting' | 'Plug'
  start: '2018-10-03T18:50', end: '2018-10-04T00:45',   // Bangkok local time, no timezone
  qualified_at: '2018-10-03T19:19',          // the minute it first passed all three filters: a live view shows it from here
  peak_at: '2018-10-03T19:08', peak_kw: 98.2,
  span_minutes, minutes_above, red_minutes,  // minutes above P99 in total, and how many of them were red
  avg_kw, p99_kw, median_kw, kw_above, kwh_above,   // kw_above = mean kW above P99
  priority: 'High' | 'Medium' | 'Low', recurrence, months_with_alerts, months_assessed
}
```

### Hooks for other parts of the app

`src/qaBuilding.js` sets `window.QA_BUILDING` while the Question A tab is open (before that, calls do nothing):

```js
QA_BUILDING.setTime('2018-10-03T20:35')   // building, floor plan and chart jump to that minute; returns false if it is not a valid minute in the data
QA_BUILDING.selectEvent(alert)            // same as clicking that alert in the sidebar (moves to its peak minute and focuses the chart)
const off = QA_BUILDING.onEventSelect((alert) => { /* ... */ })   // runs whenever an alert is picked; off() unsubscribes
QA_BUILDING.getTime()                     // 'YYYY-MM-DDTHH:MM', the minute on show
```

You can also `import { QA_BUILDING } from './qaBuilding.js'`. The page binds itself in `AfterHoursPage.jsx`.

## Scope

| | |
|---|---|
| **Period** | Jul 2018 – Dec 2019, all 7 floors, up to 525,600 rows |
| **Zones** | F1 = 4, F2 = 4, F3–7 = 5 (on F3–7, Z3 is a staircase with no AC) |
| **Used** | Date; AC, lighting and plug power (kW) per zone. Derived: hour, weekday, day-type, kWh |
| **Not used** | Temperature, RH, lux — this is an energy-only question, and Floor 1 has no sensors |

All 7 floors are in scope because the question is a comparison *across* floors over many weeknights and weekends.

### Comparison windows

| Year | Main floor comparison | Monthly checks | Caveat |
|---|---|---|---|
| 2018 | Jul 1 – Dec 31 | all 6 calendar months | Jan–Jun was not supplied |
| 2019 | Jan 1 – Oct 21 | all 12 calendar months | Floor 6's missing tail is unavailable, not zero |

Matched season for the year-on-year view: **Jul 1 – Oct 21 in both years.**

## The metric

```
After-hours ratio = after-hours kWh ÷ daytime kWh
```

Below 1 means lower power after hours; above 1 means higher. The baseline is same-year, same-month and coverage-gated. It is **not** proof of waste, occupancy or annual change.

**Coverage gates:** ≥90% valid minutes per hour · ≥70% calendar support per period · daytime > 0.10 kW. Comparisons below these thresholds are withheld rather than reported.

## Analytics plan

1. **Clean** — all 7 floors, Jul 2018 – Dec 2019. Gaps kept as missing, no imputation. 1-min → hourly kW.
2. **Label** — weekday day / weekday night / weekend; public holidays a separate, excluded category.
3. **Profile** — 24-hour weekday vs weekend load curve per floor; operating hours taken from where load rises and falls.
4. **KPI** — after-hours ratio by floor, zone and end use.
5. **Benchmark** — "normal" = each floor, zone and end use's own weekday daytime mean. No outliers excluded.
6. **Check persistence** — shortlist the highest after-hours kW and ratios, drill down floor → zone → end use, then test whether the pattern recurs month to month.
7. **Recommend** — produce a ranked list of leads for the FM team to verify.

## Key findings

**Floor 1 is the outlier, and it is consistent.**

| | 2018 | 2019 |
|---|---|---|
| F1 weekday after-hours ratio | 1.92 | 2.06 |
| F1 weekend ratio | 1.56 | 1.67 |

Every other supported floor total is below 1. Floor 1 sits above its daytime baseline in **4/4 available months in 2018 and 12/12 in 2019**, for both after-hours periods.

**Where it comes from** — Floor 1, 2018, average kW:

| Zone / end use | Daytime | Weekday after-hours | Weekend |
|---|---|---|---|
| Z2 · AC (4 channels) | 13.81 | 40.25 | 40.97 |
| Z4 · Lighting | 1.15 | 27.69 | 16.64 |

Z2's AC *rises* after hours and holds near 40–42 kW. Z4 lighting has a very small daytime baseline, so read its large ratio against the absolute kW, not the ratio alone.

## Expected output

- Which floors reduce power outside office hours and which do not.
- The equipment and zones behind the exceptions.
- Whether those exceptions recur across months or appear only in isolated periods.

## Folder layout

```
Qn_A/
├── api/         minute-data API and tests (in)
├── A1–A3, A9    Cleaning, labelling and coverage gating        (planned)
├── A5           Floor-level ratios        → floor_ratios.csv   (planned)
├── A6           Zone-level ratios         → zone_ratios.csv    (planned)
└── A8           Monthly persistence       → monthly_floors.csv, persistence.csv (planned)
```

## Actions and KPIs

**Actions** — audit Z2 and Z4 at night to verify meter mapping and rule out faulty equipment; confirm whether the zone houses critical 24/7 infrastructure before changing any schedule; then install occupancy sensors for Z4 lighting and reprogram BMS setbacks for Z2 AC.

**KPIs** — post-intervention after-hours ratio (target: well below 1.0); absolute percentage drop in after-hours average kW; projected vs actual savings and carbon avoided.
