# 5 · UI

> **Status:** first working version on branch `ui-dashboard`. Qn B tab uses the real LightGBM + baseline test predictions; XGBoost slots in once exported. Qn A tab is a placeholder.

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

The **AC forecast · upcoming** tab runs a trained model in the browser on real future dates. Two can be picked on the page: **LightGBM (final)** (default) and **XGBoost (accuracy-first)**.

- **Weather**: live Open-Meteo forecast for the building (same source and grid as the training weather). Used by LightGBM only.
- **Calendar**: weekday/weekend plus Thai public holidays; office closures can be marked per day.
- **Last 7 days of AC load and indoor temperature**: the models need these, and the CU-BEMS record ends in Dec 2019. Until real readings are uploaded (CSV, template on the page), they are filled with a **typical 2019 week** (median per zone, day type and hour).

Backtest on the Jul–Sep 2018 test period, operating-hours WAPE (real readings / typical-week stand-in): LightGBM **12.5 % / 18.2 %**, XGBoost **10.8 % / 19.3 %**; B2 average-profile baseline 19.5 %. LightGBM is the default because readings are not connected yet.

```bash
npm run data:live    # export models + typical week + backtest to public/data/live/ (needs lightgbm, xgboost, holidays)
npm run check:live   # confirm the browser evaluators reproduce the Python predictions
```

Re-run both whenever `../3-LightGBM/outputs/ac_forecaster/` or `../4-XGBoost/outputs/final_models/accuracy_first/` changes.

## How data gets in

`scripts/build_data.py` reads the model outputs and writes small JSON files to `public/data/`. The UI only reads those JSON files, so **re-run `npm run data` whenever a model's outputs change**.

| Reads | Used for |
|---|---|
| `../3-LightGBM/outputs/test_predictions.parquet` | actuals, baselines B1–B3, LightGBM predictions |
| `../4-XGBoost/outputs/test_predictions.parquet` | **picked up automatically when it exists.** Same shape as the LightGBM file (`zone_id`, `timestamp`, plus one column per model, e.g. `XGB final`) |
| `../cleaned_data/question_b_model_data.parquet` | weather + calendar for the same hours |
| `../3-LightGBM/outputs/test_diebold_mariano.csv`, `feature_group_importance.csv` | stored in `meta.json` for later panels |

Thresholds (error band, deviation rule, start-up hour) are constants at the top of the script and are written into `meta.json`, so the UI always shows the rule it used.

## Components (Qn B tab)

| Component | File | Detail |
|---|---|---|
| Zone selector | `ZonePicker.jsx` | Floor → zone, all 23 zones |
| KPI tiles | `KpiTiles.jsx` | Operating-hours WAPE, skill vs comparison, CV(RMSE) and NMBE against ASHRAE 14 |
| Forecast vs actual | `ForecastChart.jsx` | Next day or 7 days; 10–90% error band; alert dots |
| 7-day outlook | `OutlookStrip.jsx` | Forecast peak kW, outdoor temp, rain, start hour per day |
| Start-up & pre-cooling plan | `StartupPlan.jsx` | Building forecast profile + staggered start times for zones that would switch on together |
| Accuracy table | `AccuracyTable.jsx` | Per zone, always next to the comparison model; sortable |
| Alerts sidebar | `AlertsPanel.jsx` | Above / below forecast and after-hours running; click to jump to zone + day |
| Assumptions footer | `Assumptions.jsx` | Exclusions, observed-weather caveat, no occupancy data |

## Open items

- **Error band** currently uses test-period residuals. Swap to validation residuals once P2/P3 export validation predictions.
- **Stagger / pre-cool thresholds** (`StartupPlan.jsx`) are placeholders for the group to agree.
- **Qn A tab**: see `src/pages/AfterHoursPage.jsx` for where its data and charts go.

## Framing that must survive into the UI

- A deviation is a **lead for inspection, not a confirmed fault**. There is no occupancy or schedule data behind these numbers.
- The accuracy panel is only meaningful **relative to the baseline**, so every accuracy number is shown next to its comparison.
