# 5 · UI

> **Status:** empty — nothing committed yet.

The Facilities Manager–facing dashboard: **AC Demand Forecast — Facilities Manager View**.

## Components

| Component | Detail |
|---|---|
| **Zone selector** | All 23 zones across floors 2–7 |
| **Forecast vs actual chart** | Day-ahead hourly forecast with a prediction band; next day and 7-day views |
| **Weather + peak strip** | 7-day outlook alongside forecast peak kW |
| **Accuracy panel** | CV(RMSE), WAPE and NMBE per zone, benchmarked against the seasonal-naive baseline |
| **Alert table** | Ranks zones and hours forecast to peak, or deviating from forecast: zone, hour, forecast, actual, flag |
| **Assumptions footer** | States the exclusions and that observed weather stands in for a forecast |

## What the FM does with it

- Set pre-cooling and **stagger AC start-up** for zones forecast to peak together.
- Adjust setpoints and schedules ahead of hot or rainy days.
- Follow up zones whose actual demand deviates sharply from forecast.

## Framing that must survive into the UI

Two things are easy to lose when results become a dashboard, and both change how the FM should act:

- A deviation is a **lead for inspection, not a confirmed fault**. There is no occupancy or schedule data behind these numbers.
- The accuracy panel is only meaningful **relative to the naive baseline**. A low WAPE on a highly periodic load is not by itself evidence the model is working — show the comparison, not just the number.

The assumptions footer is where the exclusions live: Floor 1 and the dead AC sensors are out of scope, and the forecasts are scored against observed weather rather than a true forecast.

## Inputs

Model predictions and per-zone metrics from [`../3-LightGBM/`](../3-LightGBM/) and [`../4-XGBoost/`](../4-XGBoost/), with baselines from [`../2-baselines/`](../2-baselines/).
