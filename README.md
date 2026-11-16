# Smarter Buildings, Lower Loads

**IS4001 (G1) · Smart Building Analytics · Final Project · Group 6**

Daphne · Huai En · Renee · Riona · Zheng Han · Zheng Long · Zi Chian

After-hours energy waste and AC demand forecasting on the **CU-BEMS** dataset.

---

## The two questions

| | Question | Folder |
|---|---|---|
| **A** | How does after-hours energy use vary across floors and day-types (weekday nights vs. weekends)? | [`Qn_A/`](Qn_A/) |
| **B** | Can we accurately forecast a zone's AC energy demand by combining historical indoor environmental conditions with external weather forecasts? | [`Qn_B/`](Qn_B/) |

Both questions are written for the same audience: the **Facilities Manager / Building Ops** team, who own the BMS schedules and setpoints and can act on the findings directly. The **Sustainability / ESG Manager** is the secondary reader, for whom after-hours load is a cost and carbon metric and a forecast is a baseline for verifying savings.

## Shared definitions

- **Daytime** — weekdays 08:00–17:00
- **After-hours** — Mon–Fri 17:01–07:59 and all weekend
- **Public holidays** — 2018–19 Thai calendar, treated as a separate category and excluded from the ratio calculations
- **Zone** — a *meter grouping*, not a room. Zone numbers are **not** comparable across floors.

## Data

**Source — CU-BEMS.** Seven floors of zone-level AC, lighting and plug power at 1-minute resolution, July 2018 – December 2019, plus indoor temperature and humidity sensors.

Known structural gaps, which drive most of the scoping decisions in both questions:

- **Floor 1** has no temperature or humidity sensors.
- **Zone 3** on floors 3–7 is a staircase and has no AC.
- **Floor 6**'s record ends in October 2019 — the missing tail is *unavailable*, not zero.
- **January–June 2018** was never supplied.

**External.** Bangkok hourly temperature, humidity and rainfall from **Open-Meteo**'s historical archive. NOAA ISD records and Thai Meteorological Department stations were also evaluated.

## Run the website

The website is one React app with a tab per question. Question B works on its own. Question A also needs a small Python API that reads the minute-level data.

**You need:** Node 18+, Python 3.10+, and the full repo (`git clone` or `git pull` brings the 860 MB of minute data in `dashboard_data/`, so allow some time).

Open two terminals at the repo root.

**Terminal 1: the data API (Question A)**

```bash
python3 -m venv .venv
.venv/bin/pip install -r Qn_A/api/requirements.txt          # Windows: .venv\Scripts\pip install -r Qn_A\api\requirements.txt
cd Qn_A/api && ../../.venv/bin/uvicorn app:app --port 8000   # Windows: ..\..\.venv\Scripts\uvicorn app:app --port 8000
```

**Terminal 2: the website**

```bash
cd Qn_B/5-UI
npm install
npm run dev
```

Open the link it prints (normally <http://localhost:5173>). The two tabs are **After-hours energy** (Question A, `#/qn-a`) and **AC forecast** (Question B). If the API is not running, the Question A tab loads but shows no data. Check the API with <http://127.0.0.1:8000/api/meta>.

Tests for the API: `cd Qn_A/api && ../../.venv/bin/python -m pytest`.

More detail: [`Qn_A/README.md`](Qn_A/README.md) (the data, the alert rule, the page hooks) and [`Qn_B/5-UI/README.md`](Qn_B/5-UI/README.md) (the forecast tab).

## What the code does

### Question A: after-hours energy dashboard

For every minute from July 2018 to December 2019 the building has a power reading per floor, zone and end use (AC, lighting, plug). Each reading is compared with its own **normal upper limit**, which is the median plus 3 standard deviations (at least 0.5 kW above the median) of the same weekday and hour over the previous 8 weeks.

- **Green:** at or below the limit.
- **Amber:** above the limit for 1 to 14 minutes in a row.
- **Red:** above the limit for 15 minutes or more. Red means investigate, not a confirmed fault.
- **Alert:** outside office hours, a load that has been red at some point, above its limit for 30+ minutes in total (short dips of 10 minutes or less are joined) and on average 5+ kW above it.

The **After-hours energy** tab lets the Facilities Manager replay any night and see what needed attention:

- **Replay controls:** pick a date, scrub or play through the day at 1, 5 or 15 minutes a step. "After-hours only" greys out office hours (weekdays 08:00 to 17:00). **Example simulation** jumps to Friday 13 September 2019 at 17:01.
- **Building explorer:** a 3D building with a kW label per floor. Floors glow amber or red when a load is over its limit, and the list on the left says which one and since when. Click a floor to open its 3D plan: the zone that is over its limit shows red and hatched, with its numbers. Switches turn AC, lighting and plug loads on and off to see which one drives the problem.
- **Load profile chart:** one zone and end use over a chosen window (whole day or after-hours), with the recorded power, the historical median and the alert threshold, and the status at any minute in the tooltip. "Compare floors" puts every floor on one chart.
- **Alerts panel:** follows the replay clock and only shows what was known by that minute. Alerts are grouped into problems per floor, zone and load, ranked by how often they recur, with a suggested next check and a ticket step.

How it fits together:

| Part | Where | What it does |
|---|---|---|
| Minute data | `dashboard_data/` | Cleaned CU-BEMS Parquet, all 7 floors, with the original P99 status per minute |
| Data API | `Qn_A/api/` | FastAPI service that reads the Parquet and serves `/api/meta`, `/api/series`, `/api/snapshot` and `/api/compare`. It restates each minute under the median + 3 SD rule using the small files in `Qn_A/api/rules/` |
| Build scripts | `Qn_A/scripts/` | `build_rules_sd.py` builds the rule files. `build_alerts.py` builds the alert list the panel reads (`Qn_B/5-UI/public/data/qa_alerts_sd.json`) |
| Page | `Qn_A/ui/` | The React page: replay, building, floor plan, chart, alerts panel |
| Site shell | `Qn_B/5-UI/` | Vite + React app that hosts both tabs and proxies `/api` to the API |

### Question B: AC demand forecast

Models trained on the cleaned hourly data predict each zone's AC load from past load, indoor conditions, calendar and weather. LightGBM is the main model, XGBoost the comparator, and three simple baselines show how much the models add. The **AC forecast** tabs in the website use the real test predictions and a live 7-day Open-Meteo forecast. See [`Qn_B/README.md`](Qn_B/README.md).

## Repo layout

```
.
├── dashboard_data/        Question A minute-level data (Parquet, 860 MB)
├── docs/qa/               Question A context, data contract and the original prototype
├── Qn_A/                  Question A: after-hours energy
│   ├── api/               Minute-data API, tests, and the median + 3 SD rule files
│   ├── scripts/           Builds the rule files and the alert list
│   └── ui/                The Question A page (React)
└── Qn_B/                  Question B: zone AC demand forecasting
    ├── cleaned_data/      Cleaned hourly dataset (input to everything below)
    ├── 1-eda/             Exploratory analysis
    ├── 2-baselines/       Seasonal naive, average profile, feature baseline
    ├── 3-LightGBM/        Main forecasting model
    ├── 4-XGBoost/         Comparator model
    └── 5-UI/              The website (both tabs)
```

Each folder has its own README with the detail for that stage.

## Running the notebooks

Python 3.13 or newer:

```bash
pip install pandas numpy matplotlib pyarrow scikit-learn lightgbm xgboost
```

`pyarrow` is required — the cleaned dataset is stored as Parquet and `pd.read_parquet` will not work without it.

Notebooks read data with paths relative to their own folder (e.g. `../cleaned_data/...`), so run them from where they live rather than from the repo root.

## A note on what these results are not

Neither question has occupancy or schedule data. High after-hours load is a **lead to investigate**, not confirmed waste, and a sharp deviation from forecast is a lead for inspection, not a confirmed fault.
