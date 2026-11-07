// Chart components for Question A. Each function: render(element, data, options).
// They only read the arrays from QA_DATA and never touch files or page layout.
window.QA_CHARTS = (() => {
  const C = window.QA_CONFIG;
  const L = C.labels;
  const AFTER = [L.afterHours, L.weekend];
  const DAY_ORDER = [L.daytime, L.afterHours, L.weekend];
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const CAP = C.ratioCap;

  // ---------------------------------------------------------------- helpers
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const theme = () => ({
    ink: css("--ink"), muted: css("--muted"), rule: css("--rule"), panel: css("--panel"),
    day: css("--day"), night: css("--night"), weekend: css("--weekend"), flag: css("--flag"),
    none: css("--none"), font: css("--font"),
    seq: [css("--seq-0"), css("--seq-1"), css("--seq-2"), css("--seq-3")],
  });
  const show = (k) => C.display[k] || k;
  const num = (v) => v !== null && v !== undefined && !Number.isNaN(v);
  const fmt = (v, d = 1) => (num(v) ? Number(v).toFixed(d) : "–");
  const isOk = (r) => r && r.status === L.ok;
  const uniq = (a) => [...new Set(a)];
  const floorsOf = (rows) => uniq(rows.map((r) => r.floor)).sort((a, b) => a - b);
  const dayColor = (t, dt) => (dt === L.daytime ? t.day : dt === L.weekend ? t.weekend : t.night);
  const seriesName = (r) => `F${r.floor} ${r.zone} ${show(r.endUse)}`;
  const zoneSort = (a, b) => Number(String(a).replace(/\D/g, "")) - Number(String(b).replace(/\D/g, ""));

  function alpha(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function mix(h1, h2, p) {
    const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
    const ch = (s) => Math.round(((a >> s) & 255) * (1 - p) + ((b >> s) & 255) * p);
    return "#" + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("");
  }
  const seqScale = (t) => [[0, t.seq[0]], [0.15, t.seq[1]], [0.5, t.seq[2]], [1, t.seq[3]]];
  const greyScale = (t) => [[0, t.none], [1, t.none]];
  const priorityColor = (t, p) =>
    p === "High" ? t.flag : p === "Medium" ? alpha(t.flag, 0.62) : p === "Low" ? alpha(t.flag, 0.32) : t.none;
  const rank = { High: 3, Medium: 2, Low: 1, "": 0 };

  function layout(t, extra = {}) {
    const axis = { gridcolor: t.rule, linecolor: t.rule, zerolinecolor: t.rule, tickfont: { color: t.muted }, automargin: true };
    const base = {
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: t.font, color: t.ink, size: 12 },
      margin: { l: 8, r: 12, t: 8, b: 8 },
      hoverlabel: { font: { family: t.font } },
      legend: { orientation: "h", y: -0.18, x: 0, font: { color: t.muted } },
      xaxis: { ...axis }, yaxis: { ...axis },
    };
    for (const k of Object.keys(extra)) {
      base[k] = typeof extra[k] === "object" && !Array.isArray(extra[k]) && base[k] ? { ...base[k], ...extra[k] } : extra[k];
    }
    return base;
  }
  const cfg = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"] };
  function draw(el, data, lay) {
    const empty = el.querySelector(".empty");
    if (empty) el.innerHTML = "";
    Plotly.react(el, data, lay, cfg);
  }
  function emptyState(el, msg) {
    if (window.Plotly) Plotly.purge(el);
    el.innerHTML = `<p class="empty">${msg}</p>`;
  }
  const floorTotal = (r) => r.zone === L.all && r.endUse === L.all;
  const ratioText = (r) => (r >= 10 ? `×${r.toFixed(0)}` : `×${r.toFixed(2)}`);

  // ================================================================ PROPOSED
  // P1 Floor x day-type heatmap (after-hours ratio)
  function floorDayTypeHeatmap(el, D, o) {
    const t = theme();
    const rows = D.summary.filter((r) => r.year === o.year && floorTotal(r));
    if (!rows.length) return emptyState(el, "No floor totals for this year.");
    const floors = floorsOf(rows).reverse();
    const x = AFTER.map(show), y = floors.map((f) => `Floor ${f}`);
    const z = [], grey = [], text = [], cd = [];
    for (const f of floors) {
      const zr = [], gr = [], tr = [], cr = [];
      for (const dt of AFTER) {
        const r = rows.find((q) => q.floor === f && q.dayType === dt);
        const ok = isOk(r) && num(r.ratio);
        zr.push(ok ? Math.min(r.ratio, CAP) : null);
        gr.push(ok ? null : 1);
        tr.push(!r ? "No data" : ok ? r.ratio.toFixed(2) : L.insufficient);
        cr.push(r ? [fmt(r.actual), fmt(r.baseline), fmt(r.excess), `${fmt(r.benchLow, 2)} to ${fmt(r.benchHigh, 2)}`,
          r.anomaly ? "Above benchmark" : "Within benchmark", fmt(r.coverage, 0)] : Array(6).fill("–"));
      }
      z.push(zr); grey.push(gr); text.push(tr); cd.push(cr);
    }
    draw(el, [
      { type: "heatmap", x, y, z: grey, colorscale: greyScale(t), showscale: false, hoverinfo: "skip", xgap: 4, ygap: 4 },
      {
        type: "heatmap", x, y, z, zmin: 0, zmax: CAP, colorscale: seqScale(t), xgap: 4, ygap: 4,
        text, texttemplate: "%{text}", textfont: { size: 14 }, customdata: cd,
        hovertemplate: "<b>%{y}, %{x}</b><br>After-hours ratio %{text}<br>%{customdata[0]} kW after hours vs %{customdata[1]} kW by day" +
          "<br>Above benchmark by %{customdata[2]} kW<br>Benchmark (Floors 2–7) %{customdata[3]}<br>Coverage %{customdata[5]}%<extra>%{customdata[4]}</extra>",
        colorbar: { title: { text: "Ratio", side: "right" }, thickness: 10, tickvals: [0, 0.5, 1, 1.5, 2], ticktext: ["0", "0.5", "1", "1.5", "≥2"], outlinewidth: 0 },
      },
    ], layout(t, { xaxis: { side: "top", gridcolor: "rgba(0,0,0,0)" }, yaxis: { gridcolor: "rgba(0,0,0,0)" }, margin: { l: 8, r: 8, t: 30, b: 8 } }));
  }

  // P2 Zone x end-use heatmap (excess kW above benchmark) for one floor
  function zoneEndUseHeatmap(el, D, o) {
    const t = theme();
    const yearRows = D.summary.filter((r) => r.year === o.year && r.zone !== L.all && r.dayType === o.dayType);
    const rows = yearRows.filter((r) => r.floor === o.floor);
    if (!rows.length) return emptyState(el, `No zone data for Floor ${o.floor}.`);
    const zmax = Math.max(1, ...yearRows.filter(isOk).map((r) => r.excess || 0));
    const zones = uniq(rows.map((r) => r.zone)).sort(zoneSort).reverse();
    const z = [], grey = [], text = [], cd = [];
    for (const zn of zones) {
      const zr = [], gr = [], tr = [], cr = [];
      for (const eu of C.endUses) {
        const r = rows.find((q) => q.zone === zn && q.endUse === eu);
        if (!r) { zr.push(null); gr.push(null); tr.push("No meter"); cr.push(Array(6).fill("–")); continue; }
        const ok = isOk(r);
        zr.push(ok ? r.excess || 0 : null);
        gr.push(ok ? null : 1);
        const label = !ok ? L.insufficient : `${fmt(r.excess)} kW` + (num(r.ratio) ? `<br>${ratioText(r.ratio)}` : "");
        tr.push(r.anomaly ? `<b>${label}</b>` : label);
        cr.push([fmt(r.actual), fmt(r.baseline), num(r.ratio) ? r.ratio.toFixed(2) : "n/a (daytime near 0)",
          r.anomaly ? `Flagged, ${r.priority} priority` : "Not flagged", fmt(r.coverage, 0), fmt(r.excess)]);
      }
      z.push(zr); grey.push(gr); text.push(tr); cd.push(cr);
    }
    const x = C.endUses.map(show);
    draw(el, [
      { type: "heatmap", x, y: zones, z: grey, colorscale: greyScale(t), showscale: false, hoverinfo: "skip", xgap: 4, ygap: 4 },
      {
        type: "heatmap", x, y: zones, z, zmin: 0, zmax, colorscale: seqScale(t), xgap: 4, ygap: 4,
        text, texttemplate: "%{text}", textfont: { size: 13 }, customdata: cd,
        hovertemplate: "<b>Floor " + o.floor + ", %{y} %{x}</b><br>%{customdata[0]} kW now vs %{customdata[1]} kW by day" +
          "<br>Ratio %{customdata[2]}<br>Above benchmark by %{customdata[5]} kW<br>Coverage %{customdata[4]}%<extra>%{customdata[3]}</extra>",
        colorbar: { title: { text: "kW above<br>benchmark", side: "right" }, thickness: 10, outlinewidth: 0 },
      },
    ], layout(t, { xaxis: { side: "top", gridcolor: "rgba(0,0,0,0)" }, yaxis: { gridcolor: "rgba(0,0,0,0)" }, margin: { l: 8, r: 8, t: 30, b: 8 } }));
  }

  // P3 Absolute power: same load in three periods
  function absolutePowerBars(el, D, o) {
    const t = theme();
    const rows = D.summary.filter((r) => r.year === o.year && r.floor === o.floor && r.zone !== L.all);
    if (!rows.length) return emptyState(el, `No zone data for Floor ${o.floor}.`);
    const keys = uniq(rows.map((r) => `${r.zone}|${r.endUse}`));
    const get = (k, dt) => rows.find((r) => `${r.zone}|${r.endUse}` === k && r.dayType === dt);
    keys.sort((a, b) => ((get(b, L.afterHours) || {}).actual || 0) - ((get(a, L.afterHours) || {}).actual || 0));
    const x = keys.map((k) => { const [zn, eu] = k.split("|"); return `${zn} ${show(eu)}`; });
    const data = DAY_ORDER.map((dt) => ({
      type: "bar", name: show(dt), x, marker: { color: dayColor(t, dt) },
      y: keys.map((k) => { const r = get(k, dt); return isOk(r) ? r.actual : null; }),
      hovertemplate: "%{x}<br>" + show(dt) + ": %{y:.1f} kW<extra></extra>",
    }));
    draw(el, data, layout(t, { barmode: "group", bargap: 0.25, yaxis: { title: { text: "Average power (kW)" } } }));
  }

  // ================================================================ CANDIDATES
  // C1 24-hour profile as % of daytime, against the Floors 2-7 band
  function profileBand(el, D, o) {
    const t = theme();
    const eu = o.endUse;
    const base = {};
    D.summary.filter((r) => r.year === o.year && r.zone === L.all && r.endUse === eu && r.dayType === L.daytime)
      .forEach((r) => { base[r.floor] = r.baseline; });
    const rows = D.profile.filter((r) => r.year === o.year && r.zone === L.all && r.endUse === eu && r.weekPart === o.weekPart);
    const hours = [...Array(24).keys()];
    const curve = (f) => hours.map((h) => {
      const r = rows.find((q) => q.floor === f && q.hour === h);
      return r && num(r.meanKw) && base[f] > 0.1 ? (100 * r.meanKw) / base[f] : null;
    });
    const peers = floorsOf(rows).filter((f) => f >= 2 && f !== o.floor);
    if (!peers.length) return emptyState(el, "Not enough comparison floors.");
    const pc = peers.map(curve);
    const pick = (fn) => hours.map((_, i) => { const v = pc.map((c) => c[i]).filter(num); return v.length ? fn(v) : null; });
    const lo = pick((v) => Math.min(...v)), hi = pick((v) => Math.max(...v));
    const med = pick((v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; });
    const shapes = o.weekPart === "Weekday"
      ? [{ type: "rect", xref: "x", yref: "paper", x0: C.officeHours[0] - 0.5, x1: C.officeHours[1] - 0.5, y0: 0, y1: 1, fillcolor: alpha(t.day, 0.1), line: { width: 0 }, layer: "below" }]
      : [];
    draw(el, [
      { x: hours, y: hi, mode: "lines", line: { width: 0 }, hoverinfo: "skip", showlegend: false },
      { x: hours, y: lo, mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: alpha(t.muted, 0.22), name: `Floors ${peers.join(", ")} range`, hoverinfo: "skip" },
      { x: hours, y: med, mode: "lines", line: { color: t.muted, width: 1.5, dash: "dot" }, name: "Their median", hovertemplate: "%{x}:00 median %{y:.0f}%<extra></extra>" },
      { x: hours, y: curve(o.floor), mode: "lines+markers", marker: { size: 5 }, line: { color: t.night, width: 3 }, name: `Floor ${o.floor}`, hovertemplate: "%{x}:00 Floor " + o.floor + " %{y:.0f}% of its daytime average<extra></extra>" },
    ], layout(t, {
      shapes,
      annotations: shapes.length ? [{ x: 12, y: 1, xref: "x", yref: "paper", yanchor: "bottom", text: "Office hours", showarrow: false, font: { color: t.muted, size: 11 } }] : [],
      xaxis: { title: { text: "Hour of day" }, tickvals: [0, 3, 6, 9, 12, 15, 18, 21], ticktext: ["00", "03", "06", "09", "12", "15", "18", "21"], range: [-0.5, 23.5] },
      yaxis: { title: { text: "% of the floor's weekday daytime average" }, rangemode: "tozero", ticksuffix: "%" },
      margin: { l: 8, r: 12, t: 22, b: 8 },
    }));
  }

  // C2 Dumbbell: daytime vs after-hours per zone/end use
  function dumbbell(el, D, o) {
    const t = theme();
    const rows = D.summary
      .filter((r) => r.year === o.year && r.zone !== L.all && r.dayType === o.dayType && isOk(r) && num(r.baseline))
      .sort((a, b) => (b.excess || 0) - (a.excess || 0) || b.actual - a.actual)
      .slice(0, o.topN || 15)
      .reverse();
    if (!rows.length) return emptyState(el, "No rows to compare.");
    el.style.height = `${Math.max(320, rows.length * 26 + 100)}px`;
    const y = rows.map(seriesName);
    const lx = [], ly = [];
    rows.forEach((r, i) => { lx.push(r.baseline, r.actual, null); ly.push(y[i], y[i], null); });
    const ac = dayColor(t, o.dayType);
    draw(el, [
      { x: lx, y: ly, mode: "lines", line: { color: t.rule, width: 3 }, hoverinfo: "skip", showlegend: false },
      { x: rows.map((r) => r.baseline), y, mode: "markers", name: "Weekday day", marker: { size: 11, color: t.day }, hovertemplate: "%{y}<br>Weekday day %{x:.1f} kW<extra></extra>" },
      {
        x: rows.map((r) => r.actual), y, mode: "markers", name: show(o.dayType),
        marker: { size: 11, color: ac, line: { color: rows.map((r) => (r.anomaly ? t.flag : ac)), width: 2.5 } },
        customdata: rows.map((r) => [r.anomaly ? `Flagged, ${r.priority}` : "Not flagged", fmt(r.excess)]),
        hovertemplate: "%{y}<br>" + show(o.dayType) + " %{x:.1f} kW<br>Above benchmark by %{customdata[1]} kW<extra>%{customdata[0]}</extra>",
      },
    ], layout(t, { xaxis: { title: { text: "Average power (kW)" }, rangemode: "tozero" }, yaxis: { gridcolor: alpha(t.rule, 0.5) } }));
  }

  // C3 Pareto of excess kWh per year
  function pareto(el, D, o) {
    const t = theme();
    const agg = {};
    D.summary.filter((r) => r.year === o.year && r.zone !== L.all && AFTER.includes(r.dayType) && isOk(r))
      .forEach((r) => {
        const k = `${r.floor}|${r.zone}|${r.endUse}`;
        agg[k] = agg[k] || { r, mwh: 0, pr: "", any: false };
        agg[k].mwh += (r.excessKwh || 0) / 1000;
        if (rank[r.priority || ""] > rank[agg[k].pr]) agg[k].pr = r.priority;
        agg[k].any = agg[k].any || r.anomaly;
      });
    const items = Object.values(agg).filter((a) => a.mwh >= 0.5).sort((a, b) => b.mwh - a.mwh);
    if (!items.length) return emptyState(el, "No load above benchmark this year.");
    const total = items.reduce((s, a) => s + a.mwh, 0);
    let run = 0;
    const cum = items.map((a) => ((run += a.mwh) / total) * 100);
    const x = items.map((a) => seriesName(a.r));
    draw(el, [
      {
        type: "bar", x, y: items.map((a) => a.mwh), name: "Excess per year",
        marker: { color: items.map((a) => priorityColor(t, a.any ? a.pr : "")) },
        customdata: items.map((a) => (a.any ? `${a.pr} priority` : "Not flagged")),
        hovertemplate: "%{x}<br>%{y:.0f} MWh a year above benchmark<extra>%{customdata}</extra>",
      },
      { x, y: cum, yaxis: "y2", mode: "lines+markers", name: "Cumulative share", line: { color: t.ink, width: 2 }, marker: { size: 5 }, hovertemplate: "%{x}<br>Top items so far: %{y:.0f}%<extra></extra>" },
    ], layout(t, {
      yaxis: { title: { text: "MWh per year above benchmark" } },
      yaxis2: { overlaying: "y", side: "right", range: [0, 105], ticksuffix: "%", showgrid: false, tickfont: { color: t.muted }, linecolor: t.rule },
      shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, yref: "y2", y0: 80, y1: 80, line: { color: t.muted, width: 1, dash: "dot" } }],
      xaxis: { tickangle: -40 },
    }));
  }

  // C4 Day-of-week x hour heatmap for one series
  function dowHourHeatmap(el, D, o) {
    const t = theme();
    const [f, zn, eu] = String(o.series).split("|");
    const rows = D.dowHour.filter((r) => r.year === o.year && r.floor === Number(f) && r.zone === zn && r.endUse === eu);
    if (!rows.length) return emptyState(el, "No data for this selection.");
    const hours = [...Array(24).keys()];
    const z = DOW.map((_, d) => hours.map((h) => { const r = rows.find((q) => q.dow === d && q.hour === h); return r && num(r.meanKw) ? r.meanKw : null; }));
    const [a, b] = C.officeHours;
    draw(el, [{
      type: "heatmap", x: hours, y: DOW, z, colorscale: seqScale(t), xgap: 1, ygap: 2,
      hovertemplate: "%{y} %{x}:00<br>%{z:.1f} kW<extra></extra>",
      colorbar: { title: { text: "kW", side: "right" }, thickness: 10, outlinewidth: 0 },
    }], layout(t, {
      yaxis: { autorange: "reversed", gridcolor: "rgba(0,0,0,0)" },
      xaxis: { title: { text: "Hour of day" }, tickvals: [0, 3, 6, 9, 12, 15, 18, 21], ticktext: ["00", "03", "06", "09", "12", "15", "18", "21"], gridcolor: "rgba(0,0,0,0)" },
      shapes: [{ type: "rect", x0: a - 0.5, x1: b - 0.5, y0: -0.5, y1: 4.5, line: { color: t.day, width: 2, dash: "dash" }, fillcolor: "rgba(0,0,0,0)" }],
      annotations: [{ x: (a + b - 1) / 2, y: -0.5, yanchor: "bottom", text: "Office hours", showarrow: false, font: { color: t.muted, size: 11 } }],
      margin: { l: 8, r: 8, t: 22, b: 8 },
    }));
  }

  // C5 Month x floor ratio heatmap
  function monthFloorHeatmap(el, D, o) {
    const t = theme();
    const rows = D.monthly.filter((r) => r.year === o.year && floorTotal(r) && r.dayType === o.dayType);
    if (!rows.length) return emptyState(el, "No monthly data.");
    const months = uniq(rows.map((r) => r.month)).sort();
    const floors = floorsOf(rows).reverse();
    const mLabel = (m) => new Date(m + "-01T00:00:00").toLocaleString("en-GB", { month: "short", year: "2-digit" });
    const z = [], grey = [], text = [];
    for (const f of floors) {
      const zr = [], gr = [], tr = [];
      for (const m of months) {
        const r = rows.find((q) => q.floor === f && q.month === m);
        const ok = isOk(r) && num(r.ratio);
        zr.push(ok ? Math.min(r.ratio, CAP) : null); gr.push(ok ? null : 1);
        tr.push(ok ? r.ratio.toFixed(2) : "–");
      }
      z.push(zr); grey.push(gr); text.push(tr);
    }
    const x = months.map(mLabel), y = floors.map((f) => `Floor ${f}`);
    draw(el, [
      { type: "heatmap", x, y, z: grey, colorscale: greyScale(t), showscale: false, xgap: 3, ygap: 3, hovertemplate: "%{y}, %{x}<br>" + L.insufficient + "<extra></extra>" },
      { type: "heatmap", x, y, z, zmin: 0, zmax: CAP, colorscale: seqScale(t), xgap: 3, ygap: 3, text, texttemplate: "%{text}", textfont: { size: 11 },
        hovertemplate: "%{y}, %{x}<br>Ratio %{text}<extra></extra>",
        colorbar: { title: { text: "Ratio", side: "right" }, thickness: 10, tickvals: [0, 1, 2], ticktext: ["0", "1", "≥2"], outlinewidth: 0 } },
    ], layout(t, { xaxis: { side: "top", gridcolor: "rgba(0,0,0,0)" }, yaxis: { gridcolor: "rgba(0,0,0,0)" }, margin: { l: 8, r: 8, t: 30, b: 8 } }));
  }

  // C6 Box plot of nightly ratios by floor
  function nightlyBox(el, D, o) {
    const t = theme();
    const rows = D.nightly.filter((r) => r.year === o.year && r.dayType === o.dayType && num(r.nightRatio) && r.nightRatio > 0);
    if (!rows.length) return emptyState(el, "No nightly data.");
    const floors = floorsOf(rows);
    const b = D.summary.filter((r) => r.year === o.year && floorTotal(r) && r.dayType === o.dayType && num(r.benchLow))[0];
    const c = dayColor(t, o.dayType);
    const data = floors.map((f) => ({
      type: "box", name: `Floor ${f}`, y: rows.filter((r) => r.floor === f).map((r) => r.nightRatio),
      marker: { color: c, size: 3 }, line: { color: c, width: 1.5 }, fillcolor: alpha(c, 0.18), boxpoints: "outliers",
      hovertemplate: `Floor ${f}<br>Ratio %{y:.2f}<extra></extra>`, showlegend: false,
    }));
    const yv = (v) => (o.scale === "log" ? Math.log10(v) : v);  // shapes on log axes take log10 values
    const shapes = b ? [{ type: "rect", xref: "paper", x0: 0, x1: 1, yref: "y", y0: yv(b.benchLow), y1: yv(b.benchHigh), fillcolor: alpha(t.muted, 0.18), line: { width: 0 }, layer: "below" }] : [];
    draw(el, data, layout(t, {
      yaxis: { type: o.scale === "log" ? "log" : "linear", title: { text: "After-hours ÷ daytime, one value per day" } },
      shapes,
      annotations: b ? [{ xref: "paper", x: 1, xanchor: "right", y: yv(b.benchHigh), yanchor: "bottom", text: "Floors 2–7 benchmark range", showarrow: false, font: { size: 11, color: t.muted } }] : [],
    }));
  }

  // C7 Stacked AC units within one zone
  function acUnitStack(el, D, o) {
    const t = theme();
    const [f, zn] = String(o.zone).split("|");
    const rows = D.units.filter((r) => r.year === o.year && r.floor === Number(f) && r.zone === zn);
    if (!rows.length) return emptyState(el, "No AC units for this zone.");
    const units = uniq(rows.map((r) => r.unit)).sort(zoneSort);
    const x = DAY_ORDER.map(show);
    const data = units.map((u, i) => {
      const color = units.length === 1 ? t.night : mix(t.night, t.day, i / (units.length - 1));
      return {
        type: "bar", name: u, x, marker: { color, line: { color: t.panel, width: 1 } },
        y: DAY_ORDER.map((dt) => { const r = rows.find((q) => q.unit === u && q.dayType === dt); return r && num(r.meanKw) ? r.meanKw : 0; }),
        customdata: DAY_ORDER.map((dt) => { const r = rows.find((q) => q.unit === u && q.dayType === dt); return r ? fmt(r.share, 0) : "–"; }),
        hovertemplate: `${u}<br>%{x}: %{y:.1f} kW (%{customdata}% of zone AC)<extra></extra>`,
      };
    });
    draw(el, data, layout(t, { barmode: "stack", bargap: 0.45, yaxis: { title: { text: "Average power (kW)" } }, legend: { orientation: "v", x: 1.02, y: 1 } }));
  }

  // C8 Treemap of excess by floor > zone > end use
  function excessTreemap(el, D, o) {
    const t = theme();
    const agg = {};
    D.summary.filter((r) => r.year === o.year && r.zone !== L.all && AFTER.includes(r.dayType) && isOk(r))
      .forEach((r) => {
        const k = `F${r.floor}/${r.zone}/${r.endUse}`;
        agg[k] = agg[k] || { r, mwh: 0, pr: "" };
        agg[k].mwh += (r.excessKwh || 0) / 1000;
        if (r.anomaly && rank[r.priority] > rank[agg[k].pr]) agg[k].pr = r.priority;
      });
    const leaves = Object.entries(agg).filter(([, a]) => a.mwh >= 0.5);
    if (!leaves.length) return emptyState(el, "No load above benchmark this year.");
    const ids = ["all"], labels = ["All floors"], parents = [""], values = [0], colors = [t.panel];
    const add = (id, label, parent, v, color) => {
      const i = ids.indexOf(id);
      if (i >= 0) { values[i] += v; return; }
      ids.push(id); labels.push(label); parents.push(parent); values.push(v); colors.push(color);
    };
    for (const [k, a] of leaves) {
      const fId = `F${a.r.floor}`, zId = `${fId}/${a.r.zone}`;
      add(fId, `Floor ${a.r.floor}`, "all", a.mwh, alpha(t.muted, 0.12));
      add(zId, a.r.zone, fId, a.mwh, alpha(t.muted, 0.22));
      add(k, show(a.r.endUse), zId, a.mwh, priorityColor(t, a.pr));
    }
    // Parents must be >= the sum of their children, so recompute bottom-up with a tiny margin.
    for (let i = ids.length - 1; i >= 0; i--) {
      const kids = ids.map((id, j) => (parents[j] === ids[i] ? values[j] : 0)).reduce((s, v) => s + v, 0);
      if (kids > 0) values[i] = kids * (1 + 1e-9);
    }
    draw(el, [{
      type: "treemap", ids, labels, parents, values, branchvalues: "total",
      marker: { colors, line: { color: t.panel, width: 2 } },
      texttemplate: "%{label}<br>%{value:.0f} MWh", textfont: { family: t.font },
      hovertemplate: "%{id}<br>%{value:.0f} MWh a year above benchmark<extra></extra>", pathbar: { visible: true },
    }], layout(t, { margin: { l: 4, r: 4, t: 28, b: 4 } }));
  }

  // C9 Data coverage heatmap (floor x month)
  function coverageHeatmap(el, D, o) {
    const t = theme();
    const rows = D.monthly.filter((r) => r.year === o.year && floorTotal(r) && r.dayType === L.allDayTypes);
    if (!rows.length) return emptyState(el, "No coverage data.");
    const months = uniq(rows.map((r) => r.month)).sort();
    const floors = floorsOf(rows).reverse();
    const mLabel = (m) => new Date(m + "-01T00:00:00").toLocaleString("en-GB", { month: "short", year: "2-digit" });
    const z = floors.map((f) => months.map((m) => { const r = rows.find((q) => q.floor === f && q.month === m); return r ? r.coverage : null; }));
    draw(el, [{
      type: "heatmap", x: months.map(mLabel), y: floors.map((f) => `Floor ${f}`), z, zmin: 0, zmax: 100, xgap: 3, ygap: 3,
      colorscale: [[0, t.flag], [0.69, alpha(t.flag, 0.35)], [0.7, t.seq[1]], [1, t.seq[0]]],
      text: z.map((r) => r.map((v) => (num(v) ? `${v.toFixed(0)}` : ""))), texttemplate: "%{text}", textfont: { size: 11 },
      hovertemplate: "%{y}, %{x}<br>%{z:.0f}% of hours usable<extra></extra>",
      colorbar: { title: { text: "% usable", side: "right" }, thickness: 10, tickvals: [0, 70, 100], ticktext: ["0", "70 (cut-off)", "100"], outlinewidth: 0 },
    }], layout(t, { xaxis: { side: "top", gridcolor: "rgba(0,0,0,0)" }, yaxis: { gridcolor: "rgba(0,0,0,0)" }, margin: { l: 8, r: 8, t: 30, b: 8 } }));
  }

  // C10 Bullet chart: each floor's ratio against the benchmark band
  function bulletRatios(el, D, o) {
    const t = theme();
    const rows = D.summary.filter((r) => r.year === o.year && floorTotal(r) && AFTER.includes(r.dayType));
    if (!rows.length) return emptyState(el, "No floor totals.");
    const floors = floorsOf(rows).reverse();
    const y = floors.map((f) => `Floor ${f}`);
    const data = [], shapes = [], annotations = [];
    AFTER.forEach((dt, i) => {
      const ax = i === 0 ? "x" : "x2";
      const sub = floors.map((f) => rows.find((r) => r.floor === f && r.dayType === dt));
      const b = sub.find((r) => r && num(r.benchLow));
      if (b) shapes.push({ type: "rect", xref: ax, yref: "paper", x0: Math.log10(b.benchLow), x1: Math.log10(b.benchHigh), y0: 0, y1: 1, fillcolor: alpha(t.muted, 0.2), line: { width: 0 }, layer: "below" });
      data.push({
        x: sub.map((r) => (isOk(r) ? r.ratio : null)), y, xaxis: ax, mode: "markers", showlegend: false,
        marker: { size: 13, symbol: "line-ns", line: { width: 4, color: sub.map((r) => (r && r.anomaly ? t.flag : t.ink)) } },
        hovertemplate: "%{y}<br>" + show(dt) + " ratio %{x:.2f}<extra></extra>",
      });
      annotations.push({ xref: `${ax} domain`, yref: "paper", x: 0, y: 1.02, xanchor: "left", yanchor: "bottom", text: `<b>${show(dt)}</b>`, showarrow: false, font: { size: 12 } });
    });
    const axis = { type: "log", range: [Math.log10(0.02), Math.log10(4)], tickvals: [0.03, 0.1, 0.3, 1, 3], ticktext: ["0.03", "0.1", "0.3", "1", "3"], title: { text: "Ratio (log scale)" } };
    draw(el, data, layout(t, {
      xaxis: { ...axis, domain: [0, 0.47] }, xaxis2: { ...axis, domain: [0.53, 1], gridcolor: t.rule, linecolor: t.rule, tickfont: { color: t.muted }, anchor: "y" },
      yaxis: { gridcolor: alpha(t.rule, 0.5) }, shapes, annotations, margin: { l: 8, r: 12, t: 26, b: 8 },
    }));
  }

  return {
    p1: floorDayTypeHeatmap, p2: zoneEndUseHeatmap, p3: absolutePowerBars,
    c1: profileBand, c2: dumbbell, c3: pareto, c4: dowHourHeatmap, c5: monthFloorHeatmap,
    c6: nightlyBox, c7: acUnitStack, c8: excessTreemap, c9: coverageHeatmap, c10: bulletRatios,
  };
})();
