// Building explorer. Reads the same summary.csv rows as the charts (via QA_DATA),
// so it needs no extra files. Click a floor to open its plan; switches filter the loads.
window.QA_BUILDING = (() => {
  const C = window.QA_CONFIG;
  const L = C.labels;
  const EUS = ["AC", "Light", "Plug"];
  const EU_NAME = { AC: "AC", Light: "Lighting", Plug: "Plug load" };
  const EU_ICON = { AC: "ex-ico-ac", Light: "ex-ico-light", Plug: "ex-ico-plug" };
  const EU_COLOR = { AC: "var(--eu-ac)", Light: "var(--eu-light)", Plug: "var(--eu-plug)" };
  const FLOORS = [1, 2, 3, 4, 5, 6, 7];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const num = (v) => v !== null && v !== undefined && !Number.isNaN(v);
  const f1 = (v) => (num(v) ? Number(v).toFixed(1) : "–");

  // ---------------------------------------------------------------- isometric geometry
  // x runs along the long facade (right side of the picture), y along the short facade (left side).
  const G = { L: 330, W: 180, H: 42, T: 7, O: 6, OX: 360, OY: 360, c: Math.sqrt(3) / 2, s: 0.5, VW: 980, VH: 700 };
  const P = (x, y, z) => [G.OX + (y - x) * G.c, G.OY + (x + y) * G.s - z];
  const pts = (a) => a.map((p) => P(...p).map((v) => v.toFixed(1)).join(",")).join(" ");
  const poly = (a, cls, attr = "") => `<polygon class="${cls}" points="${pts(a)}" ${attr}/>`;
  const longQ = (x0, x1, z0, z1, y = G.W) => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
  const shortQ = (y0, y1, z0, z1, x = G.L) => [[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]];
  const topQ = (x0, x1, y0, y1, z) => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
  const floorMidY = (j) => G.OY + G.W * G.s - ((j - 1) * G.H + G.H / 2);

  function windows(z0, z1) {
    let s = "";
    const za = z0 + 9, zb = z1 - G.T - 7;
    const nl = 9, pl = (G.L - 28) / nl;
    for (let i = 0; i < nl; i++) {
      const q = longQ(14 + i * pl, 14 + i * pl + pl - 9, za, zb);
      s += poly(q, "win-long") + poly(q, "lit");
    }
    const ns = 5, ps = (G.W - 28) / ns;
    for (let i = 0; i < ns; i++) {
      const q = shortQ(14 + i * ps, 14 + i * ps + ps - 9, za, zb);
      s += poly(q, "win-short") + poly(q, "lit");
    }
    return s;
  }

  function floorSVG(j) {
    const z0 = (j - 1) * G.H, z1 = j * G.H, o = G.O, T = G.T;
    let s = "";
    if (j === 1) {
      s += poly(longQ(0, G.L, z0, z1 - T), "base-long") + poly(shortQ(0, G.W, z0, z1 - T), "base-short");
      for (let i = 0; i <= 11; i++) { const x = (i * (G.L - 8)) / 11; s += poly(longQ(x, x + 8, z0, z1 - T), "col-long"); }
      for (let i = 0; i <= 6; i++) { const y = (i * (G.W - 8)) / 6; s += poly(shortQ(y, y + 8, z0, z1 - T), "col-short"); }
      // the podium also glows a little, so floor 1 reads like the others
      s += poly(longQ(8, G.L - 8, z0 + 6, z1 - T - 4), "lit");
    } else {
      s += poly(longQ(0, G.L, z0, z1 - T), "wall-long") + poly(shortQ(0, G.W, z0, z1 - T), "wall-short");
      s += windows(z0, z1);
    }
    s += poly(longQ(-o, G.L + o, z1 - T, z1, G.W + o), "slab-long") + poly(shortQ(-o, G.W + o, z1 - T, z1, G.L + o), "slab-short");
    return s;
  }

  function pvArray(xa, xb, ya, yb, cols, rows, top) {
    let s = "";
    const dx = (xb - xa) / cols, dy = (yb - ya) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = xa + c * dx + 1, x1 = x0 + dx - 2, y0 = ya + r * dy + 1, y1 = y0 + dy - 2;
        const za = top + 3 + ((y0 - ya) / (yb - ya)) * 8, zb = top + 3 + ((y1 - ya) / (yb - ya)) * 8;
        s += poly([[x0, y0, za], [x1, y0, za], [x1, y1, zb], [x0, y1, zb]], "pv");
      }
    }
    return s;
  }

  function roofSVG() {
    const top = FLOORS.length * G.H, o = G.O;
    let s = poly(topQ(-o, G.L + o, -o, G.W + o, top), "roof");
    s += pvArray(30, G.L - 110, 22, 74, 9, 2, top);
    s += pvArray(30, G.L - 110, 96, 148, 9, 2, top);
    const x0 = G.L - 90, x1 = G.L - 38, y0 = G.W - 78, y1 = G.W - 30, h = 20;
    s += poly(longQ(x0, x1, top, top + h, y1), "roof-box-long") + poly(shortQ(y0, y1, top, top + h, x1), "roof-box-short") + poly(topQ(x0, x1, y0, y1, top + h), "roof-box-top");
    return s;
  }

  function buildingSVG() {
    const m = 26;
    let s = poly(topQ(-m, G.L + m, -m, G.W + m, 0), "ground");
    s += poly(topQ(G.L + 34, G.L + 66, -70, G.W + 70, 0), "road");
    s += poly(topQ(-10, G.L + 70, G.W + 34, G.W + 66, 0), "road");
    FLOORS.forEach((j, i) => {
      s += `<g class="floor-in" style="--i:${i}"><g class="floor" data-floor="${j}" style="--glow:0">${floorSVG(j)}</g></g>`;
    });
    s += roofSVG();
    const ax = G.OX + G.W * G.c + 4;
    FLOORS.forEach((j) => {
      const y = floorMidY(j).toFixed(1);
      s += `<g class="lead" data-floor="${j}"><line class="leader" x1="${ax.toFixed(1)}" y1="${y}" x2="${(G.VW * 0.562 - 6).toFixed(1)}" y2="${y}"/>` +
        `<circle class="anchor" cx="${ax.toFixed(1)}" cy="${y}" r="3.5"/>` +
        `<g class="bc" style="display:none"><circle class="beacon-ring" cx="${ax.toFixed(1)}" cy="${y}" r="5"/><circle class="beacon" cx="${ax.toFixed(1)}" cy="${y}" r="4.5"/></g></g>`;
    });
    return s;
  }

  // ---------------------------------------------------------------- floor plans (schematic, after CU-BEMS Fig. 2)
  // Zone outlines in plan units (580 x 380). Floors 1-2 use layout A, floors 3-7 layout B.
  const PLANS = {
    A: {
      title: "Floors 1 and 2 layout",
      zones: {
        Z1: { pts: [[315, 5], [550, 5], [550, 370], [340, 370], [340, 195], [270, 195], [270, 95], [315, 50]], at: [395, 142], sensor: [443, 322] },
        Z2: { pts: [[5, 5], [315, 5], [315, 50], [270, 95], [270, 195], [160, 195], [160, 165], [5, 165]], at: [120, 40], sensor: [185, 150] },
        Z3: { pts: [[160, 195], [315, 195], [315, 370], [160, 370]], at: [192, 232] },
        Z4: { pts: [[30, 165], [160, 165], [160, 370], [30, 370]], at: [38, 178], sensor: [95, 336] },
      },
      core: [315, 200, 25, 170],
    },
    B: {
      title: "Floors 3 to 7 layout",
      zones: {
        Z1: { pts: [[230, 5], [555, 5], [555, 157], [355, 157], [355, 195], [290, 195], [290, 120], [230, 120]], at: [300, 40], sensor: [510, 90] },
        Z2: { pts: [[355, 157], [555, 157], [555, 370], [355, 370]], at: [384, 178], sensor: [462, 336] },
        Z3: { pts: [[150, 195], [320, 195], [320, 370], [150, 370]], at: [184, 238] },
        Z4: { pts: [[30, 5], [230, 5], [230, 120], [290, 120], [290, 195], [150, 195], [150, 155], [30, 155]], at: [150, 50], sensor: [62, 76] },
        Z5: { pts: [[30, 155], [150, 155], [150, 370], [30, 370]], at: [34, 168], sensor: [90, 336] },
      },
      core: [320, 200, 35, 170],
    },
  };
  const PW = 580, PH = 380;               // plan size in px
  const NOM = 100;                        // nominal wall height; each zone is scaled in Z to its real height
  const ZONE_FILL = { Z1: "var(--z1)", Z2: "var(--z2)", Z3: "var(--z3)", Z4: "var(--z4)", Z5: "var(--z5)" };
  const planOf = (f) => (f <= 2 ? PLANS.A : PLANS.B);
  const DEF = { rx: 66, rz: -16 };        // default camera tilt and turn, in degrees
  const ISO = { rx: 54.7, rz: -45 };      // the building's isometric angle: the floor swings in from here

  // ---------------------------------------------------------------- state
  let D, root, getYear;
  const S = { dayType: L.afterHours, on: { AC: true, Light: true, Plug: true }, floor: null, flat: false, rx: DEF.rx, rz: DEF.rz };
  let IDX = new Map();
  let ROWS = [];
  let maxZone = 1;
  const el = {};

  const key = (f, z, e, dt) => `${f}|${z}|${e}|${dt}`;
  const get = (f, z, e, dt = S.dayType) => IDX.get(key(f, z, e, dt));
  const onEus = () => EUS.filter((e) => S.on[e]);
  const dtLong = (dt) =>
    dt === L.daytime ? "weekday daytime (08:00 to 17:00)" : dt === L.afterHours ? "weekday nights (17:00 to 08:00)" : "weekends";

  function indexData() {
    const y = getYear();
    ROWS = D.summary.filter((r) => r.year === y);
    IDX = new Map();
    ROWS.forEach((r) => IDX.set(key(r.floor, r.zone, r.endUse, r.dayType), r));
    maxZone = Math.max(1, ...ROWS.filter((r) => r.zone !== L.all && r.endUse !== L.all && r.status === L.ok && num(r.actual)).map((r) => r.actual));
  }

  function floorStats(f) {
    const eus = onEus();
    const out = { kw: 0, base: 0, excess: 0, flagged: 0, ratio: null, has: false, partial: false };
    eus.forEach((e) => {
      const r = get(f, L.all, e), b = get(f, L.all, e, L.daytime);
      if (!r) return;
      if (r.status !== L.ok || !num(r.actual)) { out.partial = true; return; }
      out.has = true;
      out.kw += r.actual;
      if (b && num(b.actual)) out.base += b.actual;
      if (num(r.excess)) out.excess += r.excess;
    });
    out.flagged = ROWS.filter((r) => r.floor === f && r.zone !== L.all && r.endUse !== L.all && eus.includes(r.endUse) && r.dayType === S.dayType && r.anomaly).length;
    if (out.has && S.dayType !== L.daytime && out.base >= 0.1) out.ratio = out.kw / out.base;
    return out;
  }

  // ---------------------------------------------------------------- numbers that count up
  function setNum(node, to) {
    const from = node._v;
    node._v = to;
    cancelAnimationFrame(node._raf);
    if (!num(to)) { node.textContent = "–"; return; }
    if (reduce || !num(from) || from === to) { node.textContent = f1(to); return; }
    const t0 = performance.now(), dur = 550;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      node.textContent = f1(from + (to - from) * e);
      if (p < 1) node._raf = requestAnimationFrame(step);
    };
    node._raf = requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- building view
  function buildLabels() {
    el.labels.innerHTML = [...FLOORS].reverse().map((j, i) => {
      const t = ((floorMidY(j) / G.VH) * 100).toFixed(2);
      return `<button type="button" class="fl" data-floor="${j}" style="--t:${t}%;--i:${i}" aria-label="Floor ${j}, open floor plan">` +
        `<span class="fl-n">Floor ${j}</span><span class="fl-v"><b data-v>–</b> <small>kW</small></span>` +
        `<span class="fl-r" data-r></span><span class="fl-bar"><i style="--w:0"></i></span><span class="fl-flag"></span></button>`;
    }).join("");
  }

  function updateBuilding() {
    const st = {};
    FLOORS.forEach((f) => (st[f] = floorStats(f)));
    const max = Math.max(1, ...FLOORS.map((f) => (st[f].has ? st[f].kw : 0)));
    const none = onEus().length === 0;
    el.hint.textContent = none ? "Turn on at least one load type to see values." : "";
    FLOORS.forEach((f) => {
      const s = st[f];
      const lab = el.labels.querySelector(`.fl[data-floor="${f}"]`);
      const g = el.svg.querySelector(`.floor[data-floor="${f}"]`);
      const bc = el.svg.querySelector(`.lead[data-floor="${f}"] .bc`);
      const share = s.has ? s.kw / max : 0;
      g.style.setProperty("--glow", s.has ? Math.min(1, 0.08 + Math.pow(share, 0.42) * 0.92).toFixed(3) : "0");
      setNum(lab.querySelector("[data-v]"), s.has && !none ? s.kw : null);
      lab.querySelector("[data-r]").textContent = s.ratio !== null ? `×${s.ratio >= 10 ? s.ratio.toFixed(0) : s.ratio.toFixed(2)}` : S.dayType === L.daytime && s.has ? "baseline" : s.partial ? "partial" : "";
      lab.querySelector(".fl-bar i").style.setProperty("--w", share.toFixed(3));
      lab.classList.toggle("flagged", s.flagged > 0);
      lab.classList.toggle("empty", !s.has);
      lab.title = !s.has ? "No data for the selected loads" : `${f1(s.kw)} kW ${dtLong(S.dayType)}` +
        (s.ratio !== null ? `, ${s.ratio.toFixed(2)}× its weekday daytime load` : "") + (s.flagged ? `, ${s.flagged} load${s.flagged > 1 ? "s" : ""} above benchmark` : "");
      bc.style.display = s.flagged > 0 ? "" : "none";
    });
    el.sub.textContent = `Average kW, ${dtLong(S.dayType)}, ${getYear() === 2018 ? "Jul to Dec 2018" : getYear()}. Window brightness shows each floor's load; a red dot marks loads above benchmark.`;
  }

  // ---------------------------------------------------------------- 3D floor model
  function rowText(r, e) {
    if (!r || r.status !== L.ok || !num(r.actual)) return null;
    const b = get(r.floor, r.zone, e, L.daytime);
    let t = `${EU_NAME[e]}: ${f1(r.actual)} kW ${dtLong(S.dayType)}`;
    if (b && num(b.actual) && S.dayType !== L.daytime) t += `; ${f1(b.actual)} kW by day`;
    if (num(r.ratio) && S.dayType !== L.daytime) t += `; ratio ${r.ratio.toFixed(2)}`;
    if (r.anomaly) t += `; above benchmark by ${f1(r.excess)} kW (${r.priority} priority)`;
    return t;
  }

  // What one zone holds for the selected loads
  function zoneData(f, z) {
    const out = { rows: [], tot: 0, n: 0, flagged: false };
    onEus().forEach((e) => {
      const r = get(f, z, e);
      if (!r) out.rows.push({ e, state: "none" });
      else if (r.status !== L.ok || !num(r.actual)) out.rows.push({ e, state: "low" });
      else {
        out.rows.push({ e, state: "ok", r });
        out.tot += r.actual; out.n++;
        if (r.anomaly) out.flagged = true;
      }
    });
    return out;
  }

  // The label card for one zone (a small svg, drawn upright so it always faces the viewer)
  function cardSVG(zd, name) {
    const w = 128, ox = 9, oy = 7, P = 19, rowsN = zd.rows.length;
    const h = oy + 22 + rowsN * P + (rowsN > 1 ? P : 0) + 8;
    let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect class="bgc" x="0" y="0" width="${w}" height="${h}" rx="8"/>` +
      `<text class="znm" x="${ox}" y="${oy + 12}">Zone ${name.replace("Z", "")}</text>`;
    zd.rows.forEach((row, i) => {
      const y = oy + 20 + i * P;
      const ic = `<use href="#${EU_ICON[row.e]}" x="${ox}" y="${y}" width="14" height="14" style="color:${EU_COLOR[row.e]}"/>`;
      if (row.state === "none") s += `<g class="row">${ic}<text class="rn" x="${ox + 19}" y="${y + 11}">no meter</text></g>`;
      else if (row.state === "low") s += `<g class="row">${ic}<text class="rn" x="${ox + 19}" y="${y + 11}">insufficient data</text></g>`;
      else {
        const r = row.r, bw = Math.max(1.5, Math.min(1, r.actual / maxZone) * 32);
        s += `<g class="row"><title>${rowText(r, row.e)}</title>${ic}<rect class="trk" x="${ox + 18}" y="${y + 3.5}" width="32" height="7" rx="3.5"/>` +
          `<rect class="bar" x="${ox + 18}" y="${y + 3.5}" width="${bw.toFixed(1)}" height="7" rx="3.5" fill="${r.anomaly ? "#c3352d" : EU_COLOR[row.e]}"/>` +
          `<text class="rv" x="${w - ox}" y="${y + 11}" text-anchor="end">${f1(r.actual)} <tspan class="rk">kW</tspan></text></g>`;
      }
    });
    if (rowsN > 1) {
      const y = oy + 20 + rowsN * P;
      s += `<line x1="${ox}" x2="${w - ox}" y1="${y - 2}" y2="${y - 2}" stroke="rgba(27,36,48,0.35)"/>` +
        `<text class="rv tot" x="${ox}" y="${y + 11}">Total</text>` +
        `<text class="rv tot" x="${w - ox}" y="${y + 11}" text-anchor="end">${zd.n ? f1(zd.tot) : "–"} <tspan class="rk">kW</tspan></text>`;
    }
    return { svg: s + "</svg>", w, h };
  }

  const shrink = (pts, k = 0.985) => {
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return pts.map((p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]);
  };
  const wall = (a, b, cls = "w") => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return `<i class="${cls}" style="left:${a[0].toFixed(1)}px;top:${a[1].toFixed(1)}px;width:${Math.hypot(dx, dy).toFixed(1)}px;` +
      `transform:rotateZ(${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(2)}deg) rotateX(90deg)"></i>`;
  };
  const dPath = (pts) => "M" + pts.map((p) => p.map((v) => v.toFixed(1)).join(" ")).join(" L") + " Z";

  function buildModel(f, fromIso) {
    const plan = planOf(f);
    const hasData = ROWS.some((r) => r.floor === f);
    let h = `<div class="slab"></div>`;
    const sl = [[0, 0], [PW, 0], [PW, PH], [0, PH]];
    sl.forEach((p, i) => (h += wall(p, sl[(i + 1) % 4], "w sw")));
    Object.entries(plan.zones).forEach(([z, def], zi) => {
      const pts = shrink(def.pts);
      const walls = pts.map((p, i) => wall(p, pts[(i + 1) % pts.length])).join("");
      const sensor = f !== 1 && def.sensor ? `<circle class="sensor" cx="${def.sensor[0]}" cy="${def.sensor[1]}" r="6"><title>Multi-sensor, approximate location</title></circle>` : "";
      h += `<div class="zp" data-z="${z}" style="--zc:${ZONE_FILL[z]};--zi:${zi};--k:0.03">${walls}` +
        `<svg class="tface" viewBox="0 0 ${PW} ${PH}"><path class="tp" d="${dPath(pts)}"><title>Zone ${z.replace("Z", "")}</title></path>${sensor}</svg></div>`;
    });
    // lift core: a low grey block
    const [cx, cy, cw, ch] = plan.core;
    const cp = [[cx, cy], [cx + cw, cy], [cx + cw, cy + ch], [cx, cy + ch]];
    let lifts = "";
    for (let i = 0; i < 3; i++) {
      const sz = Math.min(cw - 12, 18), y = cy + 14 + i * (sz + 12), x = cx + (cw - sz) / 2;
      lifts += `<rect class="lift" x="${x}" y="${y}" width="${sz}" height="${sz}"/><path class="lift" d="M${x} ${y}L${x + sz} ${y + sz}M${x + sz} ${y}L${x} ${y + sz}"/>`;
    }
    h += `<div class="cp">${cp.map((p, i) => wall(p, cp[(i + 1) % 4], "w cw")).join("")}<svg class="tface" viewBox="0 0 ${PW} ${PH}"><rect class="core" x="${cx}" y="${cy}" width="${cw}" height="${ch}"/>${lifts}</svg></div>`;
    Object.entries(plan.zones).forEach(([z, def]) => {
      h += `<div class="bill" data-z="${z}" style="--bx:${def.at[0] + 56}px;--by:${def.at[1] + 52}px;--bz:6px"></div>`;
    });
    if (!hasData) h += `<div class="nodata">No data for this floor</div>`;
    el.cam.innerHTML = h;
    el.cam.classList.toggle("flat", S.flat);
    // start the camera at the building's own angle on the first open, else where it already is
    el.cam.style.setProperty("--cs", S.flat ? "1" : "0.8");
    const t = camTarget(), start = fromIso ? ISO : t;
    el.cam.style.setProperty("--rx", start.rx + "deg");
    el.cam.style.setProperty("--rz", start.rz + "deg");
    fit(fromIso ? 0.55 : 1);
    applyModel(false);
  }

  function camTarget() { return S.flat ? { rx: 0, rz: 0 } : { rx: S.rx, rz: S.rz }; }

  function fit(mult = 1) {
    const w = el.scene.clientWidth || 900;
    const small = w < 520;
    el.scene.style.height = Math.round(Math.min(660, Math.max(small ? 320 : 390, w * (small ? 0.9 : 0.62)))) + "px";
    el.cam.style.setProperty("--sc", (Math.max(0.36, Math.min(1.55, w / (S.flat ? 620 : small ? 660 : 790))) * mult).toFixed(3));
  }

  function setCamera() {
    const t = camTarget();
    el.cam.classList.toggle("flat", S.flat);
    el.cam.style.setProperty("--rx", t.rx + "deg");
    el.cam.style.setProperty("--rz", t.rz + "deg");
    el.cam.style.setProperty("--cs", S.flat ? "1" : "0.8");
    fit(1);
    el.viewRadios.forEach((r) => (r.checked = (r.value === "flat") === S.flat));
  }

  // Heights follow kW; the same scale is used on every floor so floors can be compared
  function applyModel(raised) {
    const f = S.floor;
    if (f === null) return;
    const plan = planOf(f);
    const eus = onEus();
    const totals = new Map();
    ROWS.forEach((r) => {
      if (r.zone === L.all || r.endUse === L.all || r.dayType !== S.dayType || !eus.includes(r.endUse) || r.status !== L.ok || !num(r.actual)) return;
      const k = `${r.floor}|${r.zone}`;
      totals.set(k, (totals.get(k) || 0) + r.actual);
    });
    const maxTot = Math.max(1, ...totals.values());
    Object.keys(plan.zones).forEach((z) => {
      const zd = zoneData(f, z);
      const hpx = S.flat ? 2 : 6 + 132 * Math.sqrt(Math.min(1, zd.tot / maxTot));
      const zp = el.cam.querySelector(`.zp[data-z="${z}"]`), bill = el.cam.querySelector(`.bill[data-z="${z}"]`);
      if (!zp || !bill) return;
      zp.classList.toggle("flagged", zd.flagged);
      const card = cardSVG(zd, z);
      bill.innerHTML = card.svg;
      bill.style.width = card.w + "px";
      bill.style.height = card.h + "px";
      bill.style.marginLeft = -card.w / 2 + "px";
      bill.style.marginTop = -card.h + "px";
      bill.classList.toggle("flagged", zd.flagged);
      if (raised) {
        zp.style.setProperty("--k", (hpx / NOM).toFixed(3));
        bill.style.setProperty("--bz", (hpx + 3).toFixed(1) + "px");
      }
    });
  }

  function raiseSoon() {
    // two frames, so the browser has painted the low state and the rise animates
    requestAnimationFrame(() => requestAnimationFrame(() => { setCamera(); applyModel(true); }));
  }

  // ---------------------------------------------------------------- header, stats and table of the plan view
  function renderTop() {
    const f = S.floor, plan = planOf(f);
    el.title.textContent = `Floor ${f}`;
    el.subp.textContent = `${plan.title}. Average kW, ${dtLong(S.dayType)}.`;
    const hadFocus = el.tabs.contains(document.activeElement);
    el.tabs.innerHTML = [...FLOORS].reverse().map((j) => `<button type="button" class="ftab" data-go="${j}"${j === f ? ' aria-current="true"' : ""}>F${j}</button>`).join("");
    if (hadFocus) { const cur = el.tabs.querySelector('[aria-current="true"]'); if (cur) cur.focus({ preventScroll: true }); }
    el.note.innerHTML = `${f !== 1 ? '<span><i class="sd"></i>Approximate multi-sensor location</span>' : "<span>Floor 1 has no sensor</span>"}` +
      `<span>Block height shows the zone's total kW for the selected loads, on one scale for every floor. Red outline: load above benchmark.</span>` +
      `<span>Schematic, after CU-BEMS Fig. 2.</span>`;
  }

  function renderStats() {
    const s = floorStats(S.floor);
    const stat = (dt, dd) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`;
    el.stats.innerHTML = stat("Selected loads", s.has ? `${f1(s.kw)} <small>kW</small>` : "–") +
      (s.ratio !== null ? stat("Against weekday daytime", `×${s.ratio.toFixed(2)}`) : "") +
      (S.dayType !== L.daytime && s.has ? stat("Above benchmark", `${f1(s.excess)} <small>kW</small>`) : "") +
      (S.dayType !== L.daytime ? stat("Flagged loads", String(s.flagged)) : "");
  }

  function renderTable() {
    const f = S.floor, plan = planOf(f), eus = onEus();
    if (!eus.length) { el.table.innerHTML = ""; return; }
    let h = `<table class="plan-table"><thead><tr><th scope="col">Zone</th>` + eus.map((e) => `<th scope="col">${EU_NAME[e]} (kW)</th>`).join("") + (eus.length > 1 ? `<th scope="col">Total (kW)</th>` : "") + `</tr></thead><tbody>`;
    Object.keys(plan.zones).forEach((z) => {
      let tot = 0, n = 0;
      h += `<tr><th scope="row" style="text-align:left;font-weight:600;color:var(--ink)">Zone ${z.replace("Z", "")}</th>`;
      eus.forEach((e) => {
        const r = get(f, z, e);
        if (!r) h += `<td class="none">no meter</td>`;
        else if (r.status !== L.ok || !num(r.actual)) h += `<td class="none">insufficient data</td>`;
        else { tot += r.actual; n++; h += `<td${r.anomaly ? ' class="flag"' : ""}>${f1(r.actual)}${r.anomaly ? " ▲" : ""}</td>`; }
      });
      if (eus.length > 1) h += `<td>${n ? f1(tot) : "–"}</td>`;
      h += `</tr>`;
    });
    el.table.innerHTML = h + `</tbody></table>`;
  }

  // ---------------------------------------------------------------- open and close with a smooth zoom
  function syncHeight() { if (S.floor !== null && el.stage.classList.contains("is-plan")) el.stage.style.height = el.plan.offsetHeight + "px"; }

  function openFloor(f, source) {
    const wasPlan = el.stage.classList.contains("is-plan");
    if (S.floor === f && wasPlan) return;
    S.floor = f;
    renderTop(); renderStats(); renderTable();
    buildModel(f, !wasPlan);
    const sr = el.stage.getBoundingClientRect();
    const src = source || el.svg.querySelector(`.floor[data-floor="${f}"]`);
    const r = src.getBoundingClientRect();
    el.stage.style.setProperty("--ox", `${r.left + r.width / 2 - sr.left}px`);
    el.stage.style.setProperty("--oy", `${r.top + r.height / 2 - sr.top}px`);
    el.stage.style.height = (wasPlan ? el.plan.offsetHeight : el.building.offsetHeight) + "px";
    el.svg.querySelectorAll(".floor").forEach((g) => g.classList.toggle("sel", Number(g.dataset.floor) === f));
    void el.stage.offsetHeight;
    requestAnimationFrame(() => {
      el.stage.classList.add("is-plan");
      el.stage.style.height = el.plan.offsetHeight + "px";
      el.plan.removeAttribute("inert");
      el.building.setAttribute("inert", "");
      if (!wasPlan) setTimeout(() => { const b = document.getElementById("ex-back"); if (b) b.focus({ preventScroll: true }); }, reduce ? 0 : 600);
    });
    raiseSoon();
  }

  function closePlan() {
    if (S.floor === null) return;
    const f = S.floor;
    S.floor = null;
    el.stage.style.height = el.plan.offsetHeight + "px";
    void el.stage.offsetHeight;
    el.stage.classList.remove("is-plan");
    el.plan.setAttribute("inert", "");
    el.building.removeAttribute("inert");
    el.stage.style.height = el.building.offsetHeight + "px";
    setTimeout(() => { el.stage.style.height = ""; }, reduce ? 20 : 650);
    setTimeout(() => { const l = el.labels.querySelector(`.fl[data-floor="${f}"]`); if (l) l.focus({ preventScroll: true }); el.svg.querySelectorAll(".floor").forEach((g) => g.classList.remove("sel")); }, reduce ? 0 : 400);
  }

  // ---------------------------------------------------------------- controls
  function setSwitch(btn, on, animate) {
    btn.setAttribute("aria-checked", String(on));
    btn.querySelector(".sw-state").textContent = on ? "On" : "Off";
    if (animate && on) { btn.classList.remove("just-on"); void btn.offsetWidth; btn.classList.add("just-on"); }
  }

  // When a switch or period changes, the zones rise or sink in place
  function refreshPlan() {
    if (S.floor === null) return;
    renderTop(); renderStats(); renderTable();
    applyModel(true);
  }

  function refresh() {
    indexData();
    updateBuilding();
    refreshPlan();
    syncHeight();
  }

  const PLAN_SKELETON = `
    <div class="plan-top">
      <button type="button" class="plan-back" id="ex-back">← Building</button>
      <div><h3 class="plan-title" id="pl-title"></h3><p class="plan-sub" id="pl-sub"></p></div>
      <div class="ftabs" id="pl-tabs" role="group" aria-label="Switch floor"></div>
    </div>
    <dl class="plan-stats" id="pl-stats"></dl>
    <div class="viewbar">
      <fieldset class="seg"><legend>View</legend>
        <label><input type="radio" name="ex-view" value="3d" checked>3D</label>
        <label><input type="radio" name="ex-view" value="flat">Flat plan</label>
      </fieldset>
      <div class="vb-turn" role="group" aria-label="Rotate the floor">
        <button type="button" class="btn" id="vb-left" aria-label="Rotate left">⟲</button>
        <button type="button" class="btn" id="vb-right" aria-label="Rotate right">⟳</button>
        <button type="button" class="btn" id="vb-reset">Reset view</button>
      </div>
      <span class="vb-hint">Drag the floor to rotate it</span>
    </div>
    <div class="plan-scene" id="pl-scene" role="group" aria-label="3D model of the floor, one block per zone"><div class="cam" id="pl-cam"></div></div>
    <p class="plan-note" id="pl-note"></p>
    <div id="pl-table"></div>`;

  function init(data, opts) {
    D = data;
    getYear = opts.getYear;
    root = document.getElementById("explorer");
    if (!root) return;
    el.stage = root.querySelector("#ex-stage");
    el.building = root.querySelector("#ex-building");
    el.svg = root.querySelector("#ex-svg");
    el.labels = root.querySelector("#ex-labels");
    el.plan = root.querySelector("#ex-plan");
    el.hint = root.querySelector("#ex-hint");
    el.sub = root.querySelector("#ex-sub");

    el.svg.innerHTML = buildingSVG();
    // On phones the labels move below the building, so crop the empty right side of the picture.
    const narrow = window.matchMedia("(max-width: 760px)");
    const fitView = () => el.svg.setAttribute("viewBox", narrow.matches ? "0 20 590 680" : `0 0 ${G.VW} ${G.VH}`);
    fitView();
    narrow.addEventListener("change", fitView);

    el.plan.innerHTML = PLAN_SKELETON;
    el.title = root.querySelector("#pl-title");
    el.subp = root.querySelector("#pl-sub");
    el.tabs = root.querySelector("#pl-tabs");
    el.stats = root.querySelector("#pl-stats");
    el.scene = root.querySelector("#pl-scene");
    el.cam = root.querySelector("#pl-cam");
    el.note = root.querySelector("#pl-note");
    el.table = root.querySelector("#pl-table");
    el.viewRadios = [...root.querySelectorAll('input[name="ex-view"]')];

    buildLabels();
    indexData();
    updateBuilding();

    // hover link between labels and floors
    const hl = (f, on) => {
      el.svg.querySelector(`.floor[data-floor="${f}"]`).classList.toggle("hl", on);
      el.svg.querySelector(`.lead[data-floor="${f}"] .leader`).classList.toggle("hl", on);
      const l = el.labels.querySelector(`.fl[data-floor="${f}"]`);
      if (l) l.classList.toggle("hl", on);
    };
    el.svg.addEventListener("mouseover", (e) => { const g = e.target.closest(".floor"); if (g && S.floor === null) hl(g.dataset.floor, true); });
    el.svg.addEventListener("mouseout", (e) => { const g = e.target.closest(".floor"); if (g) hl(g.dataset.floor, false); });
    el.svg.addEventListener("click", (e) => { const g = e.target.closest(".floor"); if (g) openFloor(Number(g.dataset.floor), g); });
    el.labels.addEventListener("mouseover", (e) => { const b = e.target.closest(".fl"); if (b) hl(b.dataset.floor, true); });
    el.labels.addEventListener("mouseout", (e) => { const b = e.target.closest(".fl"); if (b) hl(b.dataset.floor, false); });
    el.labels.addEventListener("focusin", (e) => { const b = e.target.closest(".fl"); if (b) hl(b.dataset.floor, true); });
    el.labels.addEventListener("focusout", (e) => { const b = e.target.closest(".fl"); if (b) hl(b.dataset.floor, false); });
    el.labels.addEventListener("click", (e) => {
      const b = e.target.closest(".fl");
      if (b) openFloor(Number(b.dataset.floor), el.svg.querySelector(`.floor[data-floor="${b.dataset.floor}"]`));
    });

    // plan view: back, floor tabs, view mode, rotate
    el.plan.addEventListener("click", (e) => {
      if (e.target.closest("#ex-back")) { closePlan(); return; }
      const t = e.target.closest(".ftab");
      if (t) { S.floor = Number(t.dataset.go); renderTop(); renderStats(); renderTable(); buildModel(S.floor, false); raiseSoon(); return; }
      if (e.target.closest("#vb-left") || e.target.closest("#vb-right")) {
        S.flat = false;
        S.rz += e.target.closest("#vb-left") ? 30 : -30;
        setCamera(); applyModel(true);
      }
      if (e.target.closest("#vb-reset")) { S.flat = false; S.rx = DEF.rx; S.rz = DEF.rz; setCamera(); applyModel(true); }
    });
    el.viewRadios.forEach((r) => r.addEventListener("change", () => { S.flat = r.value === "flat"; setCamera(); applyModel(true); }));

    // drag to orbit: sideways turns the floor, up and down tilts it (mouse and pen; on touch only sideways)
    let drag = null;
    el.scene.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, touch: e.pointerType === "touch" };
      el.scene.setPointerCapture(e.pointerId);
      el.cam.classList.add("drag");
    });
    el.scene.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (S.flat) { S.flat = false; S.rx = DEF.rx; setCamera(); applyModel(true); }
      S.rz += dx * 0.4;
      if (!drag.touch) S.rx = Math.max(32, Math.min(72, S.rx - dy * 0.3));
      el.cam.style.setProperty("--rx", S.rx + "deg");
      el.cam.style.setProperty("--rz", S.rz + "deg");
    });
    const endDrag = () => { if (drag) { drag = null; el.cam.classList.remove("drag"); } };
    el.scene.addEventListener("pointerup", endDrag);
    el.scene.addEventListener("pointercancel", endDrag);

    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.floor !== null && (root.contains(document.activeElement) || document.activeElement === document.body)) closePlan(); });

    root.querySelectorAll(".sw").forEach((b) => {
      setSwitch(b, S.on[b.dataset.eu], false);
      b.addEventListener("click", () => {
        S.on[b.dataset.eu] = !S.on[b.dataset.eu];
        setSwitch(b, S.on[b.dataset.eu], true);
        updateBuilding();
        refreshPlan();
      });
    });
    root.querySelectorAll('input[name="ex-dt"]').forEach((r) => r.addEventListener("change", () => {
      S.dayType = r.value;
      updateBuilding();
      refreshPlan();
    }));

    if ("ResizeObserver" in window) {
      new ResizeObserver(syncHeight).observe(el.plan);
      new ResizeObserver(() => { if (S.floor !== null) fit(1); }).observe(el.scene);
    }
  }

  return { init, refresh };
})();
