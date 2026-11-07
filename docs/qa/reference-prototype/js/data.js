// Loads every dashboard CSV, renames columns to internal keys, and checks the schema.
// Charts never read files themselves: they receive the arrays this returns.
window.QA_DATA = (() => {
  const C = window.QA_CONFIG;

  async function loadText(name, url) {
    // A bundled preview can embed the CSVs so it opens without a local server.
    if (window.EMBEDDED_CSV && window.EMBEDDED_CSV[name]) return window.EMBEDDED_CSV[name];
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
    return res.text();
  }

  function normalise(rows) {
    const keys = Object.keys(C.cols);
    return rows.map((r) => {
      const o = {};
      for (const k of keys) {
        const col = C.cols[k];
        if (!(col in r)) continue;
        const v = r[col];
        o[k] = v === "" || v === undefined ? null : v;
      }
      if ("anomaly" in o) o.anomaly = String(o.anomaly).toLowerCase() === "true";
      if ("zone" in o && o.zone != null) o.zone = String(o.zone);
      return o;
    });
  }

  function checkColumns(name, fields) {
    const missing = (C.required[name] || [])
      .filter((k) => !fields.includes(C.cols[k]))
      .map((k) => C.cols[k]);
    return missing.length ? `${name}: missing column(s) ${missing.join(", ")}` : null;
  }

  function checkLabels(name, rows) {
    const L = C.labels;
    const allowed = new Set([L.daytime, L.afterHours, L.weekend, L.allDayTypes]);
    const bad = new Set(rows.filter((r) => r.dayType != null && !allowed.has(r.dayType)).map((r) => r.dayType));
    return bad.size ? `${name}: unexpected day type(s) ${[...bad].join(", ")}` : null;
  }

  async function loadAll() {
    const out = {};
    const problems = [];
    await Promise.all(
      Object.entries(C.files).map(async ([name, url]) => {
        const text = await loadText(name, url);
        const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
        const colProblem = checkColumns(name, parsed.meta.fields || []);
        if (colProblem) problems.push(colProblem);
        out[name] = normalise(parsed.data);
        const labelProblem = checkLabels(name, out[name]);
        if (labelProblem) problems.push(labelProblem);
      })
    );
    return { data: out, problems };
  }

  return { loadAll };
})();
