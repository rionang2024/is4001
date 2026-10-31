# 1 · EDA

Exploratory analysis for Question B — what the AC load actually looks like, which sensors can be trusted, and whether outdoor weather carries any signal worth modelling.

## `eda_ac_forecasting.ipynb`

Reads [`../cleaned_data/question_b_hourly_data.parquet`](../cleaned_data/). Sections:

| | Section | Why it matters |
|---|---|---|
| 1 | Check for dead sensors | Decides which AC meters and zones are usable downstream |
| 2 | AC demand pattern | Daily and weekly shape of the load |
| 3 | Indoor conditions vs AC load | Whether indoor T / RH carry signal |
| 4 | Seasonal variation in AC load | |
| 5 | Working hours vs after hours | |
| 6 | AC load by zone | |
| 7 | AC data completeness by zone | Per-meter completeness; sets the coverage gates |
| 8 | Was the office open on Labour Day 2019? | Sanity-checks the holiday calendar against observed load |
| 9 | AC load vs outdoor weather | The rainfall and temperature correlations |
| 10 | AC load vs outdoor weather, by hour | |
| 11 | Charts for the slides | Writes `slide_rainfall.png` and `slide_temperature.png` into this folder |

A **Further analysis** section follows, covering availability by zone for AC load and indoor temperature.

## Headline results

Floor 2 zone 2 (13 working AC units, 1 dead meter excluded), working weekdays 08:00–17:00, Mar–Dec 2019, against Open-Meteo hourly Bangkok weather:

| Relationship | Pearson r | Reading |
|---|---|---|
| AC load vs hourly **rainfall** | **-0.003** | No clear linear relationship. Average load is 29.9 kW in hours with ≥0.1 mm of rain against 30.0 kW in hours with less — effectively identical. |
| AC load vs hourly **outdoor temperature** | **0.468** | Moderate positive. Hotter hours tend to carry a higher AC load. |

The practical conclusion for stages 2–4: **outdoor temperature is worth carrying into the model; rainfall is not**, at least not as a linear term.

## Running it

```bash
pip install pandas numpy matplotlib pyarrow
```

Run from this folder — the notebook's data path is relative (`../cleaned_data/...`).

> **Known issue.** The notebook was written against a *minute-level* `cleaned_data.parquet` with a `Date` column, which is not in this repo. The committed dataset is **hourly** with an `Hour` column. The data now loads, but cells that assume minute resolution still fail — they filter on counts like `0.9 * 540` minutes per day or `0.9 * 60` per hour, look for 07:30 readings, and measure gaps in `24 * 60` rows. Running it end-to-end needs either the original minute-level file or those thresholds rewritten for hourly data.
