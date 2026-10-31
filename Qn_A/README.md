# Question A — After-Hours Energy

> How does after-hours energy use vary across floors and day-types (weekday nights vs. weekends)?

**Daytime** = weekdays 08:00–17:00 · **After-hours** = Mon–Fri 17:01–07:59 and all weekend · public holidays excluded.

> **Status:** the analysis described here is complete and was presented, but the notebooks and output CSVs are **not yet committed to this folder**. The layout below is the agreed structure for when they land.

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

## Folder layout (planned)

```
Qn_A/
├── A1–A3, A9    Cleaning, labelling and coverage gating
├── A5           Floor-level ratios        → floor_ratios.csv
├── A6           Zone-level ratios         → zone_ratios.csv
└── A8           Monthly persistence       → monthly_floors.csv, persistence.csv
```

## Actions and KPIs

**Actions** — audit Z2 and Z4 at night to verify meter mapping and rule out faulty equipment; confirm whether the zone houses critical 24/7 infrastructure before changing any schedule; then install occupancy sensors for Z4 lighting and reprogram BMS setbacks for Z2 AC.

**KPIs** — post-intervention after-hours ratio (target: well below 1.0); absolute percentage drop in after-hours average kW; projected vs actual savings and carbon avoided.
