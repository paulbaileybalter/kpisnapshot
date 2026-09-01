(() => {
  "use strict";

  /* =========================================================
     CONFIG — tweak these without touching the rest of the app
     ========================================================= */

  // Which direction is "good" for each KPI on the KPI - Dash tab.
  // Most metrics here are losses/consumption/complaints (lower = better);
  // a few are attainment/pass-rate style metrics (higher = better).
  // The three "UFE" metrics are assumed higher-is-better to match the
  // ME (Mechanical Efficiency) metrics next to them — flip to 'lower'
  // below if that's not right for how Balter defines UFE.
  const KPI_DIRECTION = {
    "Micro": "higher",
    "Phys Chem": "higher",
    "Sensory": "higher",
    "Consumer Complaints (Cans and Bottles)": "lower",
    "Consumer Complaints (Kegs)": "lower",
    "Consumer Complaints (Total)": "lower",
    "Controllable Complaints Ratio": "lower",
    "Controllable Complaints": "lower",
    "Keg Returns Ratio": "lower",
    "Keg Returns": "lower",
    "Consumer Complaints Ratio (Total)": "lower",
    "Cost of Quality": "lower",
    "Water Consumption": "lower",
    "CO2 Consumption": "lower",
    "Purchased Fuel Consumption": "lower",
    "Electrical Consumption": "lower",
    "Extract Loss": "lower",
    "Total Package Loss": "lower",
    "Plan Attainment": "higher",
    "Packaging ME - Aggregated": "higher",
    "Packaging UFE - Aggregated": "higher",
    "Can Line ME": "higher",
    "Can Line UFE": "higher",
    "Keg Line ME": "higher",
    "Keg Line UFE": "higher",
  };

  const TYPE_ORDER = ["Quality", "Utilities", "Efficiency"];

  const MONTH_ABBR_TO_FULL = {
    Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June",
    Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December",
  };
  const MONTH_FULL_LIST = Object.values(MONTH_ABBR_TO_FULL);

  // Headline metrics pulled onto the hero strip when present.
  const HEADLINE_KPIS = ["Plan Attainment", "Total Package Loss", "Extract Loss", "Micro"];

  // The KPI - Dash tab stores "%" values inconsistently: most rows are
  // already scaled (95 = 95%, 17.96 = 17.96%, and — importantly — 0.98
  // means 0.98%, not 98%), but these two are stored as true fractions
  // (0.7241 = 72.41%). Checked against the actual budget column for every
  // row in the template rather than guessed from magnitude, since a couple
  // of the already-scaled rows (Total Package Loss) are also under 1.5 and
  // would otherwise be misread as fractions.
  const FRACTION_PERCENT_KPIS = new Set(["Micro", "Phys Chem"]);

  /* =========================================================
     Small utilities
     ========================================================= */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function numOrNull(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }

  function safeDiv(a, b) {
    if (a == null || b == null || b === 0) return null;
    return a / b;
  }

  // Production Plan attainment values (produced/planned) are always true
  // ratios (0.9536 = 95.36%) — always scale these up.
  function fmtPercent(v, digits = 1) {
    if (v == null) return "—";
    return (v * 100).toFixed(digits) + "%";
  }

  function fmtNumber(v, digits = 2) {
    if (v == null) return "—";
    return Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });
  }

  // KPI - Dash "%" values: scale only the two rows that are stored as
  // fractions (see FRACTION_PERCENT_KPIS above); everything else is
  // already percentage-scaled.
  function scaleKpiPercent(v, kpiName) {
    if (v == null) return null;
    return FRACTION_PERCENT_KPIS.has(kpiName) ? v * 100 : v;
  }

  function fmtKpiValue(v, unit, kpiName) {
    if (v == null) return "—";
    if (unit === "%") return scaleKpiPercent(v, kpiName).toFixed(1) + "%";
    if (unit === "$") return "$" + fmtNumber(v, 0);
    if (unit === "#") return fmtNumber(v, 2);
    return fmtNumber(v, 2) + (unit ? " " + unit : "");
  }

  function fmtKpiDelta(v, unit, kpiName) {
    if (v == null) return "—";
    const sign = v > 0 ? "+" : v < 0 ? "\u2212" : "";
    const abs = Math.abs(v);
    if (unit === "%") return sign + scaleKpiPercent(abs, kpiName).toFixed(1) + " pp";
    if (unit === "$") return sign + "$" + fmtNumber(abs, 0);
    if (unit === "#") return sign + fmtNumber(abs, 2);
    return sign + fmtNumber(abs, 2) + (unit ? " " + unit : "");
  }

  function goodness(direction, varValue) {
    if (varValue == null || varValue === 0) return "flat";
    if (direction === "higher") return varValue > 0 ? "good" : "bad";
    if (direction === "lower") return varValue < 0 ? "good" : "bad";
    return "flat";
  }

  function escapeCsv(value) {
    const s = value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toast(message, kind = "") {
    const stack = $("#toastStack");
    const el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function setBusy(btn, busy, labelEl) {
    btn.disabled = busy;
    if (!labelEl) return;
    if (busy) {
      labelEl.dataset.orig = labelEl.textContent;
      labelEl.innerHTML = '<span class="spinner"></span>';
    } else if (labelEl.dataset.orig) {
      labelEl.textContent = labelEl.dataset.orig;
    }
  }

  /* =========================================================
     Auth
     ========================================================= */

  async function checkSession() {
    try {
      const res = await fetch("/api/session");
      const data = await res.json();
      return !!data.authenticated;
    } catch {
      return false;
    }
  }

  async function login(password) {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "Incorrect password.");
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    location.reload();
  }

  /* =========================================================
     XLSX parsing
     ========================================================= */

  function readWorkbook(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: "array", cellDates: false });
          resolve(wb);
        } catch (err) {
          reject(new Error("Couldn't read that file — is it a valid .xlsx workbook?"));
        }
      };
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.readAsArrayBuffer(file);
    });
  }

  function parseKpiWorkbook(wb) {
    const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === "kpi - dash");
    if (!sheetName) {
      throw new Error('Could not find a "KPI - Dash" tab in this workbook.');
    }
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

    const monthAbbrev = rows[0] && rows[0][1] ? String(rows[0][1]).trim() : null;

    let headerIdx = rows.findIndex((r) => r && String(r[0] || "").trim().toLowerCase() === "type");
    if (headerIdx === -1) headerIdx = 2;

    const kpiRows = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const type = r[0], kpi = r[1];
      if (!type && !kpi) continue;
      kpiRows.push({
        type: type ? String(type).trim() : null,
        kpi: kpi ? String(kpi).trim() : null,
        unit: r[2] != null ? String(r[2]).trim() : null,
        budgetMonth: numOrNull(r[3]),
        actualMonth: numOrNull(r[4]),
        varMonth: numOrNull(r[5]),
        budgetYtd: numOrNull(r[6]),
        actualYtd: numOrNull(r[7]),
        varYtd: numOrNull(r[8]),
      });
    }
    if (!kpiRows.length) throw new Error('The "KPI - Dash" tab has no data rows.');

    return {
      month: monthAbbrev,
      monthFull: MONTH_ABBR_TO_FULL[monthAbbrev] || monthAbbrev,
      rows: kpiRows,
    };
  }

  function parseProductionPlanSheet(ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const headerIdx = rows.findIndex((r) => r && String(r[0] || "").trim().toLowerCase() === "sku");
    const start = headerIdx === -1 ? 2 : headerIdx + 1;

    const skus = [];
    let totals = null;
    for (let i = start; i < rows.length; i++) {
      const r = rows[i] || [];
      const label = r[0] != null ? String(r[0]).trim() : "";
      if (!label) continue;
      if (label.toLowerCase() === "total") {
        totals = {
          planned: numOrNull(r[1]),
          produced: numOrNull(r[2]),
          diff: numOrNull(r[4]),
          absDiff: numOrNull(r[5]),
          attainment: numOrNull(r[6]) != null ? numOrNull(r[6]) : safeDiv(numOrNull(r[2]), numOrNull(r[1])),
        };
        break;
      }
      const planned = numOrNull(r[1]);
      const produced = numOrNull(r[2]);
      skus.push({
        sku: label,
        planned,
        produced,
        attainment: numOrNull(r[3]) != null ? numOrNull(r[3]) : safeDiv(produced, planned),
        diff: numOrNull(r[4]) != null ? numOrNull(r[4]) : (planned != null && produced != null ? produced - planned : null),
      });
    }

    if (!totals) {
      const planned = skus.reduce((a, s) => a + (s.planned || 0), 0);
      const produced = skus.reduce((a, s) => a + (s.produced || 0), 0);
      totals = { planned, produced, diff: produced - planned, absDiff: Math.abs(produced - planned), attainment: safeDiv(produced, planned) };
    }
    return { skus, totals };
  }

  function listProductionPlanMonths(wb) {
    return wb.SheetNames.filter((n) => MONTH_FULL_LIST.includes(n.trim()));
  }

  function parseProductionPlanWorkbook(wb, monthName) {
    const ws = wb.Sheets[monthName];
    if (!ws) throw new Error(`Couldn't find a "${monthName}" tab in this workbook.`);
    return { month: monthName, ...parseProductionPlanSheet(ws) };
  }

  /* =========================================================
     Rendering
     ========================================================= */

  const state = {
    snapshot: null,   // { month, kpiDash: {month, rows}, productionPlan: {month, skus, totals}, savedAt }
    months: [],
    latestMonth: null, // the month GET /api/data returns by default — marked "(latest)" in the switcher
    skuSort: { key: "diff", dir: "desc" },
  };

  function findKpi(rows, name) {
    return rows.find((r) => r.kpi === name);
  }

  function renderHero() {
    const hero = $("#hero");
    hero.innerHTML = "";
    const kpiRows = (state.snapshot.kpiDash && state.snapshot.kpiDash.rows) || [];
    const plan = state.snapshot.productionPlan;

    const attainmentRow = findKpi(kpiRows, "Plan Attainment");
    const heroMain = document.createElement("div");
    heroMain.className = "hero-main";
    if (attainmentRow) {
      const dir = KPI_DIRECTION["Plan Attainment"] || "higher";
      const g = goodness(dir, attainmentRow.varMonth);
      const n = attainmentRow.kpi;
      heroMain.innerHTML = `
        <div class="kicker">${state.snapshot.month || ""} · Plan attainment</div>
        <div class="big">${fmtKpiValue(attainmentRow.actualMonth, "%", n)}<small>vs ${fmtKpiValue(attainmentRow.budgetMonth, "%", n)} target</small></div>
        <div class="label">Year to date: ${fmtKpiValue(attainmentRow.actualYtd, "%", n)}</div>
        <span class="delta ${g === "bad" ? "bad" : "good"}">${fmtKpiDelta(attainmentRow.varMonth, "%", n)} vs target this month</span>
      `;
    } else if (plan && plan.totals) {
      heroMain.innerHTML = `
        <div class="kicker">${state.snapshot.month || ""} · Production attainment</div>
        <div class="big">${fmtPercent(plan.totals.attainment)}</div>
        <div class="label">${fmtNumber(plan.totals.produced, 0)} hL produced of ${fmtNumber(plan.totals.planned, 0)} hL planned</div>
      `;
    } else {
      heroMain.innerHTML = `<div class="kicker">${state.snapshot.month || ""}</div><div class="big">—</div><div class="label">No plan attainment figure found yet</div>`;
    }
    hero.appendChild(heroMain);

    const grid = document.createElement("div");
    grid.className = "hero-grid";
    HEADLINE_KPIS.filter((n) => n !== "Plan Attainment").forEach((name) => {
      const row = findKpi(kpiRows, name);
      if (!row) return;
      const dir = KPI_DIRECTION[name] || "higher";
      const g = goodness(dir, row.varMonth);
      const stat = document.createElement("div");
      stat.className = "hero-stat";
      stat.innerHTML = `
        <span class="k">${row.kpi}</span>
        <span class="v">${fmtKpiValue(row.actualMonth, row.unit, row.kpi)}</span>
        <span class="chip ${g === "bad" ? "bad" : "good"}">${fmtKpiDelta(row.varMonth, row.unit, row.kpi)}</span>
      `;
      grid.appendChild(stat);
    });
    if (plan && plan.totals) {
      const stat = document.createElement("div");
      stat.className = "hero-stat";
      const diffGood = (plan.totals.diff || 0) >= 0;
      stat.innerHTML = `
        <span class="k">hL produced</span>
        <span class="v">${fmtNumber(plan.totals.produced, 0)}<span class="u">hL</span></span>
        <span class="chip ${diffGood ? "good" : "bad"}">${plan.totals.diff >= 0 ? "+" : "\u2212"}${fmtNumber(Math.abs(plan.totals.diff || 0), 0)} hL vs plan</span>
      `;
      grid.appendChild(stat);
    }
    hero.appendChild(grid);
  }

  function renderMetricCard(row) {
    const direction = KPI_DIRECTION[row.kpi] || "higher";
    const gMonth = goodness(direction, row.varMonth);
    const gYtd = goodness(direction, row.varYtd);
    const badgeClass = gMonth === "flat" ? "flat" : gMonth;

    const card = document.createElement("div");
    card.className = "metric-card";
    card.innerHTML = `
      <div class="mc-top">
        <div>
          <div class="mc-name">${row.kpi}</div>
          <div class="mc-unit">${row.unit || ""}</div>
        </div>
        <span class="mc-badge ${badgeClass}">${fmtKpiDelta(row.varMonth, row.unit, row.kpi)}</span>
      </div>
      ${periodBlock("This month", row.budgetMonth, row.actualMonth, row.unit, gMonth, row.kpi)}
      ${periodBlock("Year to date", row.budgetYtd, row.actualYtd, row.unit, gYtd, row.kpi)}
    `;
    return card;
  }

  function periodBlock(label, budget, actual, unit, g, kpiName) {
    const b = budget == null ? 0 : scaleForBar(budget, unit, kpiName);
    const a = actual == null ? 0 : scaleForBar(actual, unit, kpiName);
    const max = Math.max(Math.abs(b), Math.abs(a), 1) * 1.15;
    const fillPct = Math.min(100, (Math.abs(a) / max) * 100);
    const targetPct = Math.min(100, (Math.abs(b) / max) * 100);
    const fillClass = g === "good" ? "good" : g === "bad" ? "bad" : "";
    return `
      <div class="mc-period">
        <div class="pl"><span>${label}</span></div>
        <div class="mc-bar">
          <div class="fill ${fillClass}" style="width:${fillPct}%"></div>
          <div class="target" style="left:${targetPct}%"></div>
        </div>
        <div class="mc-vals">
          <span class="actual">${fmtKpiValue(actual, unit, kpiName)}</span>
          <span class="budget">target ${fmtKpiValue(budget, unit, kpiName)}</span>
        </div>
      </div>
    `;
  }

  function scaleForBar(v, unit, kpiName) {
    return unit === "%" ? scaleKpiPercent(v, kpiName) : v;
  }

  function renderCategories() {
    const kpiRows = (state.snapshot.kpiDash && state.snapshot.kpiDash.rows) || [];
    TYPE_ORDER.forEach((type) => {
      const section = $(`.category[data-type="${type}"]`);
      const grid = $(".metric-grid", section);
      const count = $(".count", section);
      grid.innerHTML = "";
      const rows = kpiRows.filter((r) => r.type === type);
      count.textContent = rows.length ? `${rows.length} metrics` : "";
      if (!rows.length) {
        section.classList.add("hidden");
        return;
      }
      section.classList.remove("hidden");
      rows.forEach((row) => grid.appendChild(renderMetricCard(row)));
    });
  }

  function renderProduction() {
    const plan = state.snapshot.productionPlan;
    const section = $("#production");
    if (!plan) {
      section.classList.add("hidden");
      return;
    }
    section.classList.remove("hidden");
    $("#prodMonthLabel").textContent = plan.month || "";

    const t = plan.totals || {};
    const stats = $("#prodStats");
    stats.innerHTML = `
      <div class="prod-stat"><div class="k">hL planned</div><div class="v">${fmtNumber(t.planned, 0)}</div></div>
      <div class="prod-stat"><div class="k">hL produced</div><div class="v">${fmtNumber(t.produced, 0)}</div></div>
      <div class="prod-stat"><div class="k">Plan attainment</div><div class="v">${fmtPercent(t.attainment)}</div></div>
      <div class="prod-stat"><div class="k">Variance</div><div class="v">${t.diff >= 0 ? "+" : "\u2212"}${fmtNumber(Math.abs(t.diff || 0), 0)} hL</div></div>
    `;

    renderSkuTable();
  }

  function renderSkuTable() {
    const plan = state.snapshot.productionPlan;
    const skus = (plan && plan.skus) || [];
    $("#skuCount").textContent = skus.length ? `${skus.length} SKUs` : "";

    const { key, dir } = state.skuSort;
    const sorted = [...skus].sort((a, b) => {
      let av = a[key], bv = b[key];
      if (key === "sku") { av = av || ""; bv = bv || ""; return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av); }
      av = av == null ? -Infinity : (key === "diff" ? Math.abs(av) : av);
      bv = bv == null ? -Infinity : (key === "diff" ? Math.abs(bv) : bv);
      return dir === "asc" ? av - bv : bv - av;
    });

    const tbody = $("#skuTbody");
    tbody.innerHTML = sorted.map((s) => {
      const diffGood = (s.diff || 0) >= 0;
      return `
        <tr>
          <td>${s.sku}</td>
          <td class="num">${fmtNumber(s.planned, 1)}</td>
          <td class="num">${fmtNumber(s.produced, 1)}</td>
          <td class="num">${fmtPercent(s.attainment)}</td>
          <td class="num sku-diff ${diffGood ? "good" : "bad"}">${s.diff == null ? "—" : (diffGood ? "+" : "\u2212") + fmtNumber(Math.abs(s.diff), 1)}</td>
        </tr>
      `;
    }).join("");
  }

  function renderAll() {
    if (!state.snapshot) {
      $("#dashboard").classList.add("hidden");
      $("#emptyState").classList.remove("hidden");
      $("#exportBtn").disabled = true;
      $("#savedMeta").textContent = "";
      return;
    }
    $("#emptyState").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    $("#exportBtn").disabled = false;

    renderHero();
    renderCategories();
    renderProduction();

    const savedAt = state.snapshot.savedAt ? new Date(state.snapshot.savedAt) : null;
    $("#savedMeta").textContent = savedAt ? `saved ${savedAt.toLocaleDateString()} ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "";
    $("#footerMeta").textContent = savedAt ? `Last updated ${savedAt.toLocaleString()}` : "";
  }

  function renderMonthSelect() {
    const sel = $("#monthSelect");
    sel.innerHTML = "";
    if (!state.months.length) {
      const opt = document.createElement("option");
      opt.textContent = "No months saved yet";
      sel.appendChild(opt);
      return;
    }
    // Most recent month first, regardless of the order they happened to be
    // uploaded in. Falls back to alphabetical for month names outside the
    // standard Jan–Dec list (shouldn't normally happen).
    const sorted = [...state.months].sort((a, b) => {
      const ai = MONTH_FULL_LIST.indexOf(a);
      const bi = MONTH_FULL_LIST.indexOf(b);
      if (ai === -1 || bi === -1) return a.localeCompare(b);
      return bi - ai;
    });
    const latest = state.months.includes(state.latestMonth) ? state.latestMonth : sorted[0];
    sorted.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m === latest ? `${m} (latest)` : m;
      if (state.snapshot && state.snapshot.month === m) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  /* =========================================================
     Data load / save
     ========================================================= */

  async function loadLatest() {
    try {
      const res = await fetch("/api/data");
      const data = await res.json();
      state.months = data.months || [];
      state.snapshot = data.snapshot || null;
      state.latestMonth = data.snapshot ? data.snapshot.month : null;
      renderMonthSelect();
      renderAll();
    } catch {
      toast("Couldn't load the saved dashboard — check your connection.", "err");
    }
  }

  async function loadMonth(month) {
    try {
      const res = await fetch(`/api/data/${encodeURIComponent(month)}`);
      const data = await res.json();
      if (data.snapshot) {
        state.snapshot = data.snapshot;
        renderAll();
      }
    } catch {
      toast("Couldn't load that month.", "err");
    }
  }

  async function saveSnapshot(payload) {
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "Couldn't save.");
    return data.snapshot;
  }

  /* =========================================================
     CSV export — KPI-Dash rows + current month's Production
     Plan totals, in one flat table for a NetSuite import.
     Column layout is easy to adjust here if the real import
     template differs.
     ========================================================= */

  function buildCsv() {
    const s = state.snapshot;
    const header = [
      "Month", "Category", "Metric", "Unit",
      "Budget (Month)", "Actual (Month)", "Variance (Month)",
      "Budget (YTD)", "Actual (YTD)", "Variance (YTD)",
    ];
    const lines = [header.map(escapeCsv).join(",")];

    const kpiRows = (s.kpiDash && s.kpiDash.rows) || [];
    kpiRows.forEach((r) => {
      lines.push([
        s.month, r.type, r.kpi, r.unit,
        r.budgetMonth, r.actualMonth, r.varMonth,
        r.budgetYtd, r.actualYtd, r.varYtd,
      ].map(escapeCsv).join(","));
    });

    if (s.productionPlan && s.productionPlan.totals) {
      const t = s.productionPlan.totals;
      const planMonth = s.productionPlan.month || s.month;
      lines.push([planMonth, "Production Plan", "hL Planned", "hL", t.planned, t.planned, 0, "", "", ""].map(escapeCsv).join(","));
      lines.push([planMonth, "Production Plan", "hL Produced", "hL", t.planned, t.produced, t.diff, "", "", ""].map(escapeCsv).join(","));
      lines.push([planMonth, "Production Plan", "Plan Attainment", "%", 1, t.attainment, (t.attainment != null ? t.attainment - 1 : ""), "", "", ""].map(escapeCsv).join(","));
    }

    return lines.join("\r\n");
  }

  function exportCsv() {
    if (!state.snapshot) return;
    const csv = buildCsv();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const monthTag = (state.snapshot.month || "export").replace(/\s+/g, "-");
    a.href = url;
    a.download = `Balter-KPI-${monthTag}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("CSV exported.", "ok");
  }

  /* =========================================================
     Upload modal
     ========================================================= */

  const pending = { kpi: null, plan: null, planMonthOverride: null };

  function resetDropzone(id) {
    const dz = $(id);
    $(".dz-empty", dz).classList.remove("hidden");
    $(".dz-file", dz).classList.add("hidden");
    dz.classList.remove("filled");
    $("input[type=file]", dz).value = "";
  }

  function fillDropzone(id, file) {
    const dz = $(id);
    $(".dz-empty", dz).classList.add("hidden");
    const fileRow = $(".dz-file", dz);
    fileRow.classList.remove("hidden");
    $(".name", fileRow).textContent = file.name;
    $(".meta", fileRow).textContent = `${(file.size / 1024).toFixed(0)} KB`;
    dz.classList.add("filled");
  }

  function updateSaveButtonState() {
    $("#saveUploadBtn").disabled = !(pending.kpi || pending.plan);
  }

  async function handleKpiFile(file) {
    try {
      const wb = await readWorkbook(file);
      const parsed = parseKpiWorkbook(wb);
      pending.kpi = { file, parsed };
      fillDropzone("#dzKpi", file);
      toast(`Read ${parsed.rows.length} KPI rows for ${parsed.monthFull || parsed.month}.`, "ok");

      // If a plan file is already staged, offer to re-match its month.
      if (pending.plan && pending.plan.availableMonths && parsed.monthFull) {
        selectPlanMonth(parsed.monthFull);
      }
    } catch (err) {
      toast(err.message, "err");
      resetDropzone("#dzKpi");
      pending.kpi = null;
    }
    updateSaveButtonState();
  }

  async function handlePlanFile(file) {
    try {
      const wb = await readWorkbook(file);
      const availableMonths = listProductionPlanMonths(wb);
      if (!availableMonths.length) throw new Error("No month tabs (January–December) found in this workbook.");
      pending.plan = { file, wb, availableMonths };
      fillDropzone("#dzPlan", file);

      const monthSel = $("#planMonthSelect");
      monthSel.innerHTML = availableMonths.map((m) => `<option value="${m}">${m}</option>`).join("");
      $("#monthPickerRow").classList.remove("hidden");

      const preferred = (pending.kpi && pending.kpi.parsed.monthFull) || pending.planMonthOverride;
      selectPlanMonth(preferred && availableMonths.includes(preferred) ? preferred : availableMonths[availableMonths.length - 1]);

      toast(`Found ${availableMonths.length} month tabs.`, "ok");
    } catch (err) {
      toast(err.message, "err");
      resetDropzone("#dzPlan");
      $("#monthPickerRow").classList.add("hidden");
      pending.plan = null;
    }
    updateSaveButtonState();
  }

  function selectPlanMonth(month) {
    if (!pending.plan) return;
    $("#planMonthSelect").value = month;
    pending.plan.parsed = parseProductionPlanWorkbook(pending.plan.wb, month);
  }

  function wireDropzone(dzId, inputId, onFile) {
    const dz = $(dzId);
    const input = $(inputId);
    input.addEventListener("change", () => {
      if (input.files[0]) onFile(input.files[0]);
    });
    ["dragenter", "dragover"].forEach((evt) =>
      dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add("drag"); })
    );
    ["dragleave", "drop"].forEach((evt) =>
      dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.remove("drag"); })
    );
    dz.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    });
    $(".dz-clear", dz).addEventListener("click", (e) => {
      e.stopPropagation();
      resetDropzone(dzId);
      if (dzId === "#dzKpi") pending.kpi = null;
      if (dzId === "#dzPlan") { pending.plan = null; $("#monthPickerRow").classList.add("hidden"); }
      updateSaveButtonState();
    });
  }

  function openUploadModal() {
    $("#uploadModal").classList.remove("hidden");
  }
  function closeUploadModal() {
    $("#uploadModal").classList.add("hidden");
  }

  async function saveUpload() {
    if (!pending.kpi && !pending.plan) return;
    const btn = $("#saveUploadBtn");
    const label = $("#saveUploadLabel");
    setBusy(btn, true, label);
    try {
      const month = (pending.kpi && pending.kpi.parsed.monthFull) ||
                    (pending.plan && pending.plan.parsed.month) ||
                    (state.snapshot && state.snapshot.month);
      if (!month) throw new Error("Couldn't determine which month this data is for.");

      const payload = { month };
      if (pending.kpi) payload.kpiDash = pending.kpi.parsed;
      if (pending.plan) payload.productionPlan = pending.plan.parsed;

      const snapshot = await saveSnapshot(payload);
      state.snapshot = snapshot;
      state.latestMonth = month;
      if (!state.months.includes(month)) state.months.push(month);
      renderMonthSelect();
      renderAll();
      toast("Dashboard updated for the whole team.", "ok");
      closeUploadModal();
      pending.kpi = null; pending.plan = null;
      resetDropzone("#dzKpi"); resetDropzone("#dzPlan");
      $("#monthPickerRow").classList.add("hidden");
      updateSaveButtonState();
    } catch (err) {
      toast(err.message, "err");
    } finally {
      setBusy(btn, false, label);
    }
  }

  /* =========================================================
     Bubbles decoration
     ========================================================= */

  function spawnBubbles() {
    const wrap = $(".bubbles");
    const count = window.innerWidth < 640 ? 10 : 18;
    for (let i = 0; i < count; i++) {
      const b = document.createElement("span");
      const size = 6 + Math.random() * 20;
      b.style.width = size + "px";
      b.style.height = size + "px";
      b.style.left = Math.random() * 100 + "%";
      b.style.animationDuration = 10 + Math.random() * 14 + "s";
      b.style.animationDelay = -(Math.random() * 20) + "s";
      wrap.appendChild(b);
    }
  }

  /* =========================================================
     Wiring
     ========================================================= */

  function wireSkuSort() {
    $$(".sku-table th[data-key]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (state.skuSort.key === key) {
          state.skuSort.dir = state.skuSort.dir === "asc" ? "desc" : "asc";
        } else {
          state.skuSort.key = key;
          state.skuSort.dir = "desc";
        }
        renderSkuTable();
      });
    });
  }

  async function boot() {
    spawnBubbles();

    const authed = await checkSession();
    if (authed) {
      $("#gate").classList.add("hidden");
      $("#app").classList.add("ready");
      await loadLatest();
    } else {
      $("#gatePassword").focus();
    }

    $("#gateForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#gateSubmit");
      const label = $("#gateSubmitLabel");
      $("#gateError").textContent = "";
      setBusy(btn, true, label);
      try {
        await login($("#gatePassword").value);
        $("#gate").classList.add("hidden");
        $("#app").classList.add("ready");
        await loadLatest();
      } catch (err) {
        $("#gateError").textContent = err.message;
      } finally {
        setBusy(btn, false, label);
      }
    });

    $("#logoutBtn").addEventListener("click", logout);
    $("#exportBtn").addEventListener("click", exportCsv);
    $("#openUploadBtn").addEventListener("click", openUploadModal);
    $("#emptyUploadBtn").addEventListener("click", openUploadModal);
    $("#closeModalBtn").addEventListener("click", closeUploadModal);
    $("#cancelUploadBtn").addEventListener("click", closeUploadModal);
    $("#uploadModal").addEventListener("click", (e) => { if (e.target.id === "uploadModal") closeUploadModal(); });
    $("#saveUploadBtn").addEventListener("click", saveUpload);
    $("#planMonthSelect").addEventListener("change", (e) => selectPlanMonth(e.target.value));

    $("#monthSelect").addEventListener("change", (e) => {
      if (e.target.value) loadMonth(e.target.value);
    });

    wireDropzone("#dzKpi", "#fileKpi", handleKpiFile);
    wireDropzone("#dzPlan", "#filePlan", handlePlanFile);
    wireSkuSort();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
