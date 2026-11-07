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

## Repo layout

```
.
├── Qn_A/                  Question A — after-hours energy analysis
│   └── api/               Minute-data API for the website's Question A tab
└── Qn_B/                  Question B — zone AC demand forecasting
    ├── cleaned_data/      Cleaned hourly dataset (input to everything below)
    ├── 1-eda/             Exploratory analysis
    ├── 2-baselines/       Seasonal naive, average profile, feature baseline
    ├── 3-LightGBM/        Main forecasting model
    ├── 4-XGBoost/         Comparator model
    └── 5-UI/              Website: Question B dashboard and the Question A tab
```

The 860 MB minute-level data for Question A lives in `dashboard_data/` and is not in git. See [`Qn_A/README.md`](Qn_A/README.md).

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
