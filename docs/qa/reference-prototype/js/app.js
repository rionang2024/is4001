// Page wiring: loads data once, fills dropdowns from the data, and re-renders a chart
// when its controls change. Person 3 can replace this with the real app shell.
(async () => {
  const C = window.QA_CONFIG;
  const L = C.labels;
  const statusEl = document.getElementById("status");
  const yearSel = document.getElementById("year");
  const uniq = (a) => [...new Set(a)];
  let D;

  function setStatus(msg, kind) {
    statusEl.hidden = !msg;
    statusEl.className = `status ${kind || ""}`;
    statusEl.innerHTML = msg || "";
  }

  if (!window.Plotly || !window.Papa) {
    const missing = [!window.Plotly && "Plotly", !window.Papa && "PapaParse"].filter(Boolean).join(" and ");
    setStatus(`<strong>${missing} did not load, so the charts can't be drawn.</strong> These libraries come from the internet. ` +
      "Open this file in Chrome, Edge or Safari while online, not inside a file previewer, and check that a firewall or ad blocker isn't blocking cdnjs.cloudflare.com or cdn.jsdelivr.net.", "error");
    return;
  }

  try {
    const res = await window.QA_DATA.loadAll();
    D = res.data;
    if (res.problems.length) {
      setStatus(`<strong>The data does not match the expected format.</strong> Fix these in the CSVs or in js/config.js: <ul>${res.problems.map((p) => `<li>${p}</li>`).join("")}</ul>`, "warn");
    }
  } catch (e) {
    const hint = location.protocol === "file:"
      ? " Opened as a file: run <code>python -m http.server</code> in the project folder and open http://localhost:8000, or use preview.html."
      : "";
    setStatus(`<strong>Charts could not load.</strong> ${e.message}${hint}`, "error");
    return;
  }

  // ---------------------------------------------------------------- controls
  const years = uniq(D.summary.map((r) => r.year)).sort();
  const yearLabel = (y) => (y === 2018 ? "Jul to Dec 2018" : String(y));
  yearSel.innerHTML = years.map((y) => `<option value="${y}">${yearLabel(y)}</option>`).join("");
  yearSel.value = years.includes(2019) ? "2019" : String(years[years.length - 1]);
  const year = () => Number(yearSel.value);

  const euName = { AC: "AC", Light: "lighting", Plug: "plug load" };
  function seriesLabel(f, zn, eu) {
    if (zn === L.all && eu === L.all) return `Floor ${f}, whole floor`;
    if (zn === L.all) return `Floor ${f}, all ${euName[eu] || eu}`;
    return `Floor ${f}, ${zn} ${euName[eu] || eu}`;
  }

  function options(kind) {
    const y = year();
    if (kind === "floors") {
      return uniq(D.summary.filter((r) => r.year === y).map((r) => r.floor)).sort((a, b) => a - b)
        .map((f) => [String(f), `Floor ${f}`]);
    }
    if (kind === "series") {
      const keys = uniq(D.dowHour.filter((r) => r.year === y).map((r) => `${r.floor}|${r.zone}|${r.endUse}`));
      return keys.sort().map((k) => [k, seriesLabel(...k.split("|"))]);
    }
    if (kind === "acZones") {
      const counts = {};
      D.units.filter((r) => r.year === y).forEach((r) => {
        const k = `${r.floor}|${r.zone}`;
        (counts[k] = counts[k] || new Set()).add(r.unit);
      });
      return Object.entries(counts).filter(([, s]) => s.size >= 2).map(([k, s]) => k).sort()
        .map((k) => { const [f, zn] = k.split("|"); return [k, `Floor ${f}, ${zn} (${counts[k].size} units)`]; });
    }
    return [];
  }

  function fillControls() {
    document.querySelectorAll("select[data-fill]").forEach((sel) => {
      const keep = sel.value || sel.dataset.default;
      const opts = options(sel.dataset.fill);
      sel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
      if (opts.some(([v]) => v === keep)) sel.value = keep;
      else if (opts.some(([v]) => v === sel.dataset.default)) sel.value = sel.dataset.default;
    });
  }

  function readOptions(section) {
    const o = { year: year() };
    section.querySelectorAll("[data-opt]").forEach((c) => {
      if (c.type === "radio" && !c.checked) return;
      o[c.dataset.opt] = c.dataset.num !== undefined ? Number(c.value) : c.value;
    });
    return o;
  }

  // ---------------------------------------------------------------- rendering
  function render(section) {
    const id = section.dataset.chart;
    const fn = window.QA_CHARTS[id];
    const el = section.querySelector(".plot");
    if (!fn || !el) return;
    try {
      fn(el, D, readOptions(section));
    } catch (e) {
      console.error(id, e);
      el.innerHTML = `<p class="empty">This chart could not be drawn: ${e.message}</p>`;
    }
  }
  const sections = [...document.querySelectorAll("[data-chart]")];
  const renderAll = () => sections.forEach(render);

  sections.forEach((s) => s.addEventListener("change", (e) => { if (e.target.matches("[data-opt]")) render(s); }));
  yearSel.addEventListener("change", () => { fillControls(); renderAll(); if (window.QA_BUILDING) window.QA_BUILDING.refresh(); });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);

  // ---------------------------------------------------------------- shortlist
  const tray = document.getElementById("shortlist-items");
  const copyBtn = document.getElementById("copy-shortlist");
  function picked() {
    return sections.filter((s) => s.querySelector(".pick[aria-pressed='true']"))
      .map((s) => `${s.dataset.chart.toUpperCase()} ${s.querySelector("h3").textContent}`);
  }
  function updateTray() {
    const p = picked();
    tray.textContent = p.length ? p.join(", ") : "None yet. Use Shortlist on any chart.";
    copyBtn.disabled = !p.length;
  }
  document.querySelectorAll(".pick").forEach((b) => b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "Shortlisted" : "Shortlist";
    updateTray();
  }));
  copyBtn.addEventListener("click", async () => {
    const text = "Question A chart shortlist: " + picked().join("; ");
    try { await navigator.clipboard.writeText(text); copyBtn.textContent = "Copied"; }
    catch { window.prompt("Copy this:", text); }
    setTimeout(() => (copyBtn.textContent = "Copy list"), 1600);
  });

  fillControls();
  updateTray();
  renderAll();

  // Building explorer sits above the charts and reads the same summary rows.
  if (window.QA_BUILDING) window.QA_BUILDING.init(D, { getYear: year });
})();
