# 5 · UI

> **Status:** both tabs work. The Qn B tabs use one model, the team's choice: **LightGBM with feature set M4**. The Qn A tab (**After-hours energy**) reads the minute-level data through the API in `Qn_A/api/`; to run it, see the repo root [README](../../README.md#run-the-website).

The Facilities Manager–facing dashboard: one site, one tab per question.

## Run it

Needs Node 18+ and Python with `pandas` + `pyarrow`.

```bash
cd Qn_B/5-UI
npm install          # first time only
npm run data         # rebuild public/data/*.json from the model outputs
npm run dev          # open the printed http://localhost:5173 link
```

`npm run build` produces a static site in `dist/` (works on GitHub Pages or any static host).

## Upcoming forecast tab (today + next 7 days)

The **AC forecast · upcoming** tab runs **LightGBM, feature set M4** (calendar, AC lags, indoor and outdoor weather) in the browser on real future dates. There is no model choice on the page.

- **Weather**: live Open-Meteo forecast for the building (same source and grid as the training weather).
- **Calendar**: weekday/weekend plus Thai public holidays; office closures can be marked per day.
- **Last 7 days of AC load, indoor temperature and indoor humidity**: the model needs these, and the CU-BEMS record ends in Dec 2019. Until real readings are uploaded (CSV, template on the page), they are filled with a **typical 2019 week** (median per zone, day type and hour).

Test scores shown on the page are the ones on the slides (Jul–Sep 2018, operating hours): LightGBM M4 WAPE **12.43 %**, CV(RMSE) 20.34 %, NMBE −0.51 %; it beat XGBoost M4 (13.03 %, 20.50 %, −2.19 %). With the typical-week stand-in instead of real readings, WAPE is 18.4 %.

```bash
npm run data:live    # export the model + typical week + backtest to public/data/live/ (needs lightgbm, holidays)
npm run check:live   # confirm the browser evaluator reproduces the Python predictions
```

Re-run both whenever `../3-LightGBM/outputs/ac_forecaster/` changes.

### Pre-cooling plan (both tabs)

The building switches AC on at one time, so the plan is building-level. In Question A's minute data, Floors 3–7 (20 zones) switch on together at about 07:45 (median 07:47, usually within 10 minutes of each other); Floor 2 Z1/Z4 at about 07:42 in 2018 and 08:03 in 2019; F2 Z2 runs overnight. `npm run data:schedule` (`scripts/build_schedule.py`) writes these per working day to `public/data/schedule.json`.

The plan takes the AC-on time from the meters on the last working day the forecast could see (typical 2019 time when there is none), and starts pre-cooling 30 min before it (45 min on hot days). LightGBM decides which zones run that day and how much energy they use. An earlier version planned per zone from the first forecast hour reaching 25 % of the day's peak; with AC coming on at about 07:45 that rule flipped zones between 07:00 and 08:00 at random, so it was dropped.

### Mock BMS feed (2026)

The project has no access to a real BMS, so `public/data/bms/` holds a **mock meter history** from 1 Dec 2025 to yesterday: hourly AC load, indoor temperature and indoor humidity for all 23 zones, as monthly CSV exports in the upload format. The upcoming tab reads the last 7 days from it by default, so the forecast for the coming week runs as if the meters were connected.

- **Weather is real:** observed hourly weather from the Open-Meteo archive (the training weather's source).
- **Readings are mock:** each day copies how this building ran on its closest 2018–19 day (same weekday or holiday, nearest temperature and rain), with ±3% noise. So the history reacts to the cool season, heat, holidays and the September storm the way the building did.
- **A planted fault:** two zones' meters (F2 Z4, F7 Z5) are blank on 19–20 Sep, to show the missing-data fallback.

The **Meter data** menu can also **replay a past week**. The forecast is made "as of" that day from the history before it, with that week's observed weather, and the history after it is drawn as "Actual (mock BMS)". The actuals are never given to the model.

| Replay | As of | Edge case |
|---|---|---|
| Cool snap | Mon 5 Jan 2026 | Coolest days of the year (~24 °C daily mean); New Year holidays in the inputs |
| Hot spell | Tue 7 Apr 2026 | Up to 38 °C: hot-day rule, 45 min pre-cooling |
| Songkran | Mon 13 Apr 2026 | 3 holidays (office closed); back to work with holiday inputs |
| Storm & flooding | Mon 21 Sep 2026 | 124 mm/day, 3× the wettest training day; 2 meters offline beforehand |

```bash
npm run data:mock    # extend the history to yesterday (needs internet for the weather); re-run before a demo
```

The mock comes from the same 2018–19 behaviour the models learned, so a close match in a replay shows the pipeline works end to end. It does not prove the models are accurate in 2026.

### Replay on real CU-BEMS data (links to Question A)

**Meter data → Replay · real CU-BEMS data** runs the same forecast on the building's real 2018–19 readings, from `public/data/cubems/` (built by `npm run data:history`). These are the same meters as the After-hours energy tab: the hourly AC load is the hourly mean of Question A's minute data. Pick the day the forecast is made ("Forecast made on"): the model gets the week of readings before it and that week's observed weather. Readings from that day on are only drawn as actuals.

- **AC on times from the meters** (above the plan): when Floors 3–7 and Floor 2 switched on during the last working day the forecast could see. The plan starts pre-cooling 30 min before that.
- **Meters, this day**: the tile and the solid marker on the timetable show when the AC actually came on during the plan day.
- **See this morning in Question A**: opens the After-hours energy tab at 07:00 on the plan day (`#/qn-a?t=YYYY-MM-DDTHH:MM`), so the pre-cooling can be replayed minute by minute.
- Dates: Jul–Sep 2018 is the test period (the model never saw it). Mar–Dec 2019 is the year it was trained on, so matches there are optimistic. Question A's status colours start in September 2018.

## How data gets in

`scripts/build_data.py` reads the model outputs and writes small JSON files to `public/data/`. The UI only reads those JSON files, so **re-run `npm run data` whenever a model's outputs change**.

| Reads | Used for |
|---|---|
| `../3-LightGBM/outputs/test_predictions.parquet` | actuals, baselines B1–B3, LightGBM M4 predictions |
| `../cleaned_data/question_b_model_data.parquet` | weather + calendar for the same hours |
| `../3-LightGBM/outputs/test_diebold_mariano.csv`, `feature_group_importance.csv` | stored in `meta.json` for later panels |

Thresholds (error band, deviation rule) are constants at the top of the script and are written into `meta.json`, so the UI always shows the rule it used.

## Components (Qn B tab)

| Component | File | Detail |
|---|---|---|
| Zone selector | `ZonePicker.jsx` | Floor → zone, all 23 zones |
| KPI tiles | `KpiTiles.jsx` | Operating-hours WAPE, skill vs comparison, CV(RMSE) and NMBE against ASHRAE 14 |
| Forecast vs actual | `ForecastChart.jsx` | Next day or 7 days; 10–90% error band; alert dots |
| 7-day outlook | `OutlookStrip.jsx` | Forecast peak kW, outdoor temp, rain per day |
| Pre-cooling plan | `StartupPlan.jsx` | One building-wide AC-on time (Floor 2 separate) from the minute data, pre-cooling before it, building forecast profile |
| Accuracy table | `AccuracyTable.jsx` | Per zone, always next to the comparison model; sortable |
| Alerts sidebar | `AlertsPanel.jsx` | Above / below forecast and after-hours running; click to jump to zone + day |
| Assumptions footer | `Assumptions.jsx` | Exclusions, observed-weather caveat, no occupancy data |

## Open items

- **Error band** currently uses test-period residuals. Swap to validation residuals once P2/P3 export validation predictions.
- **Stagger / pre-cool thresholds** (`StartupPlan.jsx`) are placeholders for the group to agree.
- **Qn A tab**: its page code lives in `Qn_A/ui/` (entry: `AfterHoursPage.jsx`); `src/App.jsx` imports it from there.

## Framing that must survive into the UI

- A deviation is a **lead for inspection, not a confirmed fault**. There is no occupancy or schedule data behind these numbers.
- The accuracy panel is only meaningful **relative to the baseline**, so every accuracy number is shown next to its comparison.
