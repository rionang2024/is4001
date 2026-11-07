# Question A work inside the team's existing website

Context for Claude Code. This file is **not** a project-wide rule set: the repo you are in already has a base built by the Question B side.
Follow that repo's structure, tooling and conventions. Read any existing `CLAUDE.md`, README and docs first and do not overwrite them.

## What this is
IS4001 Group 6, CU-BEMS smart building (7 floors, Bangkok). **Question A: after-hours energy.** Where and when does the building use energy after
hours, and what should facility management check first? Question B (AC demand forecasting and scheduling) is already built into the site.
Chris is **Person 2 on Question A (charts and visuals)**. Person 1 owns the data logic, Person 3 owns the app shell, alerts and work-order flow.
Stay in the visual components unless asked.

## What already exists on the Question A side
A working standalone prototype, in `reference-prototype/` (vanilla HTML/CSS/JS + Plotly.js, no build step). It is **reference code to port**, not something
to drop in or copy blindly:
- `js/building.js` + `css/building.css`: the building explorer. An isometric 7-storey building with a kW label per floor; click a floor and it swings into a
  3D (CSS 3D) model of that floor with one block per zone (height = kW), flat-plan toggle, drag to rotate, and animated AC / lighting / plug switches.
  Self-contained: `QA_BUILDING.init(data, { getYear })` and `QA_BUILDING.refresh()`.
- `js/charts.js`: 13 chart functions, each `render(el, data, options)` (floor x day-type heatmap, zone x end-use heatmap, 24-hour profile against other floors,
  dumbbell, Pareto, and so on). Chris is choosing a shortlist.
- `js/config.js` and `js/data.js`: column names, labels and a loader with a schema check. Charts never read files; they receive arrays.
- `data/dashboard/*.csv`: small mock files built from the raw CSVs by `scripts/build_mock_data.py` (hourly aggregates). A stand-in only.

## The real data
Minute-level Parquet, too big for the browser and for GitHub, kept locally in `dashboard_data/` (add it to `.gitignore`).
Read `docs/DATA_CONTRACT.md` and `docs/dashboard_data_README.md` before using it.

## Interfaces worth knowing when porting
- Every chart is a pure function of arrays: `fn(element, { summary, profile, ... }, options)`. In a framework, wrap each as a component that calls it in an effect, or reimplement the Plotly traces.
- The explorer needs a container with the markup in the prototype's `index.html` (`#explorer`), the icon `<symbol>`s, and `css/building.css`. Its data comes from `summary` rows
  (`floor, zone, endUse, dayType, actual, baseline, ratio, excess, anomaly, status`). With the minute data these rows will come from the backend instead.
- Colours come from CSS custom properties (`--panel`, `--ink`, `--flag`, ...). Map them to the site's tokens so light and dark mode keep working.

## Data rules that must never be broken (from the data README)
- Status colours: green, amber (1-4 consecutive minutes above P99), red (5+), grey = missing / insufficient_reference / not_assessed, neutral = outside the after-hours alert scope.
  **Grey and neutral are not "normal".** Always show `status_reason`.
- Preserve gaps in charts. Never substitute zero for missing.
- Timestamps are Bangkok local time, no timezone conversion. Row order in files is not time order: sort after filtering.
- `All` end use: never add component thresholds; its median/threshold/reference_id are null by design.
- Never send the whole dataset to the browser. Filter on the server, cap response size.
- Wording: red means "investigate", not confirmed fault, waste or savings. Say "above threshold" or "above benchmark", not "waste".
- Floor 1 has no sensor; Floors 1-2 use the four-zone plan and Floors 3-7 the five-zone plan; zone 3 has no AC meter.

## Gotchas already hit in the prototype
- A CSS class named `.top` already styles the page header in the prototype; the 3D floor faces use `.tface`. Check for class-name clashes with the existing site's CSS.
- Plotly and PapaParse came from cdnjs with a jsDelivr fallback. If `Plotly is not defined`, the CDN was blocked or the file was opened in a previewer.
- The 3D floor is pure CSS 3D: zones are `.zp` prisms scaled in Z, labels are billboards that counter-rotate the camera. Default camera `DEF` in `building.js`; drag tilt is clamped to 32-72 degrees.
- Mock end uses are `AC`/`Light`/`Plug` with zones `Z1..Z5`; the real data uses `AC`/`Lighting`/`Plug` with integer zones.

## Working style
- One feature branch per task, small commits, a pull request into the team's main branch. Do not push to main.
- Check work in a real browser (Playwright is fine) and look at screenshots: desktop, 390px phone width, light and dark mode.
- Match the existing site's code style and dependencies; do not add a framework or build step the site does not already use.
