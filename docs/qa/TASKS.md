# Tasks (for the existing repo)

Do these in order, one branch and one pull request each. T0 writes no code: it ends with a plan Chris approves.

## T0. Audit the repo and propose where Question A goes (read-only)
Report, briefly and with file paths:
1. Stack: framework, language, bundler, package manager, how to install, run and build; how the site is deployed.
2. Structure: where Question B's pages and charts live, the shared layout and navigation, how pages are added.
3. Data: how Question B gets its data (static files, API, backend?). Is there already a backend or API that could also serve Question A's minute data?
4. Styling: design tokens, CSS approach, dark mode, charting library and version (is Plotly already there?).
5. Conventions: existing `CLAUDE.md`, lint/format, tests, branch and PR rules.
Then propose: (a) the route/tab/section for Question A, (b) how to bring in the building explorer and charts (wrap as components, or port to the site's framework),
(c) how Question A's data reaches the browser, (d) risks and clashes (CSS class names, global variables like `window.QA_*`, duplicate libraries).
**Stop and wait for Chris's approval before changing anything.**

## T1. Data access for the minute data
Reuse the site's existing backend or API if there is one; otherwise add the smallest thing that works (a Python service reading `dashboard_data/` with
`pyarrow.dataset`, hive partitions `floor` and `month`).
Suggested endpoints (adapt to the site's conventions):
- `GET /api/meta` -> floors, months available, zones per floor, end uses per zone.
- `GET /api/series?floor=1&zone=2&end_use=AC&date=2018-10-03&start=20:25&end=20:48`
  -> rows `[timestamp, power_kw, reference_median_kw, upper_threshold_kw, status, status_reason, exceedance_duration_minutes]`, sorted by timestamp.
- `GET /api/snapshot?floor=1&timestamp=2018-10-03T20:35` -> one row per zone and end use at that minute (for the floor plan).
Requirements: push filters into the scan and select only needed columns; sort after filtering; cap response size and say so; keep nulls as null and gaps as gaps;
local-dev CORS only; tests with a tiny generated Parquet fixture (never commit real data); document the run command.
Done when: Floor 1, Zone 2, AC, 2018-10-03 20:25-20:48 returns amber at 20:31, red at 20:35 and green at 20:44.

## T2. Floor plan with zone metrics, filtered by AC / lighting / plug load
Bring the building explorer (`reference-prototype/js/building.js`, `css/building.css` and the markup in `index.html`) into the site, driven by the real data.
- Each floor shows its power at the chosen minute or window; clicking opens the 3D floor with one block per zone.
- Zone cards show AC, lighting and plug load (kW) with a status colour per the data README. Grey and neutral are shown as such, never as normal.
- The three animated switches turn each end use on or off on every floor; blocks and totals update in place.
- Replace the old period buttons (weekday night / day / weekend) with a time control that fits the minute data (see open questions).
- `status_reason` in tooltips; `missing` shows "no data", never 0.
- Keep: 3D default camera, flat-plan toggle, drag to rotate, dark mode, phone layout, keyboard use and Escape to go back.
Done when: Floor 1 at 2018-10-03 20:35 shows Zone 2 AC red, and switching AC off removes it from totals and block heights.

## T3. Load-profile line chart with a floor filter
A new chart in the style of `docs/assets/demo_chart.png`.
- x = time (Bangkok local), y = power (kW) for the selected date and window. Filter by floor; also end use and zone.
- Single series: markers coloured by status, dotted median line, dashed P99 line, legend explaining them.
- Gaps stay gaps (`connectgaps: false`). Title says "illustrative, not a confirmed fault" when a red run is shown.
- Hover shows time, kW, status and `status_reason`.
- Comparing several floors at once: drop status colours and threshold lines and say why in a note.
Done when: Floor 1, Zone 2, AC on 2018-10-03 reproduces the demo chart.

## T4 (later). Port the charts Chris shortlists
From `reference-prototype/js/charts.js`, after Chris picks. Decide with Chris whether they move to the minute data.

## Open questions for Chris
1. Floor plan time control: a replay slider over one day, a fixed incident minute, or the latest minute in a chosen window?
2. What should each floor label show: the floor total (`end_use = All`) at that minute, or the sum of the switched-on loads?
3. Line chart: a time series for one date (like the demo) or an average 24-hour profile per floor? Compare several floors in one chart?
4. Do the older charts stay on the mock CSVs for now, or move to the minute data?
5. Default floor, date and window on load (the data README suggests Floor 1, 2018-10-03)?
6. Where does Question A sit in the site (own page, a tab next to Question B, a section on a shared overview)?
