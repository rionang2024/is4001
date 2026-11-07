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
