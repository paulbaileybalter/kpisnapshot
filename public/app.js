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

  const MONTH_ABBR_LIST = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // The "KPI - Dash" tab only ever shows whichever month is currently
  // selected in the live Google Sheet — but the underlying "KPI - Actual",
  // "KPI - BU", and "KPI - YTD" tabs each carry one column per month for
  // the full year, and rebuilding KPI-Dash's rows from them (matched by
  // Type+KPI, since the three tabs don't share row order) lets us backfill
  // every past month a KPI workbook has ever recorded, not just the current
  // one. YTD budget isn't tracked separately anywhere in the workbook, but
  // every row's monthly budget is flat across the year (verified against
  // the real file), so budgetYtd reuses budgetMonth.
  function parseKpiHistoryWorkbook(wb) {
    const actualSheet = wb.Sheets["KPI - Actual"];
    const buSheet = wb.Sheets["KPI - BU"];
    const ytdSheet = wb.Sheets["KPI - YTD"];
    if (!actualSheet || !buSheet || !ytdSheet) return {};

    const buildMap = (ws) => {
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      const map = new Map();
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[0] || !r[1]) continue;
        const key = String(r[0]).trim() + "||" + String(r[1]).trim();
        map.set(key, { type: String(r[0]).trim(), kpi: String(r[1]).trim(), unit: r[2] != null ? String(r[2]).trim() : null, months: r.slice(3, 15) });
      }
      return map;
    };

    const actualMap = buildMap(actualSheet);
    const buMap = buildMap(buSheet);
    const ytdMap = buildMap(ytdSheet);

    const history = {};
    MONTH_ABBR_LIST.forEach((abbrev, idx) => {
      // A handful of rows (mostly ratio metrics that divide by zero when
      // there's no volume yet) carry a stray 0 or #DIV/0! value for every
      // future month regardless of whether that month has really happened.
      // Anchor "is this month real" on Plan Attainment specifically — the
      // one metric guaranteed to only be populated once the month has
      // actually been reported — rather than "does any row have a value".
      const anchor = actualMap.get("Efficiency||Plan Attainment");
      const monthIsReal = anchor && numOrNull(anchor.months[idx]) != null;
      if (!monthIsReal) return;

      const rowsForMonth = [];
      for (const [key, a] of actualMap) {
        const actualMonth = numOrNull(a.months[idx]);
        if (actualMonth == null) continue; // no data recorded for this KPI this month
        const bu = buMap.get(key);
        const ytd = ytdMap.get(key);
        const budgetMonth = bu ? numOrNull(bu.months[idx]) : null;
        const actualYtd = ytd ? numOrNull(ytd.months[idx]) : null;
        const budgetYtd = budgetMonth;
        rowsForMonth.push({
          type: a.type,
          kpi: a.kpi,
          unit: a.unit,
          budgetMonth,
          actualMonth,
          varMonth: budgetMonth != null && actualMonth != null ? actualMonth - budgetMonth : null,
          budgetYtd,
          actualYtd,
          varYtd: budgetYtd != null && actualYtd != null ? actualYtd - budgetYtd : null,
        });
      }
      if (rowsForMonth.length) history[MONTH_ABBR_TO_FULL[abbrev]] = rowsForMonth;
    });
    return history; // { "January": [rows...], "February": [rows...], ... }
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
    activePage: "quality", // "quality" | "utileff" | "production"
    skuSort: { key: "diff", dir: "desc" },
    chartStyle: (localStorage.getItem("kpisnapshot_chart_style") === "pie") ? "pie" : "bar",
    priorYear: {}, // { "July": { rows: [...] }, ... } — same-month-last-year KPI rows, keyed by month
  };

  function findKpi(rows, name) {
    return rows.find((r) => r.kpi === name);
  }

  function renderHero() {
    const kpiRows = (state.snapshot.kpiDash && state.snapshot.kpiDash.rows) || [];
    const plan = state.snapshot.productionPlan;

    const attainmentRow = findKpi(kpiRows, "Plan Attainment");
    let headlineHtml;
    if (attainmentRow) {
      const dir = KPI_DIRECTION["Plan Attainment"] || "higher";
      const g = goodness(dir, attainmentRow.varMonth);
      const n = attainmentRow.kpi;
      headlineHtml = `
        <div class="kicker">${state.snapshot.month || ""} · Plan attainment</div>
        <div class="big">${fmtKpiValue(attainmentRow.actualMonth, "%", n)}<small>vs ${fmtKpiValue(attainmentRow.budgetMonth, "%", n)} target</small></div>
        <span class="delta ${g === "bad" ? "bad" : "good"}">${fmtKpiDelta(attainmentRow.varMonth, "%", n)} vs target</span>
      `;
    } else if (plan && plan.totals) {
      headlineHtml = `
        <div class="kicker">${state.snapshot.month || ""} · Production attainment</div>
        <div class="big">${fmtPercent(plan.totals.attainment)}</div>
      `;
    } else {
      headlineHtml = `<div class="kicker">${state.snapshot.month || ""}</div><div class="big">—</div>`;
    }

    let statsHtml = "";
    HEADLINE_KPIS.filter((n) => n !== "Plan Attainment").forEach((name) => {
      const row = findKpi(kpiRows, name);
      if (!row) return;
      const dir = KPI_DIRECTION[name] || "higher";
      const g = goodness(dir, row.varMonth);
      statsHtml += `
        <div class="hero-stat">
          <span class="k">${row.kpi}</span>
          <span class="v">${fmtKpiValue(row.actualMonth, row.unit, row.kpi)}</span>
          <span class="chip ${g === "bad" ? "bad" : "good"}">${fmtKpiDelta(row.varMonth, row.unit, row.kpi)}</span>
        </div>
      `;
    });
    if (plan && plan.totals) {
      const diffGood = (plan.totals.diff || 0) >= 0;
      statsHtml += `
        <div class="hero-stat">
          <span class="k">hL produced</span>
          <span class="v">${fmtNumber(plan.totals.produced, 0)}<span class="u">hL</span></span>
          <span class="chip ${diffGood ? "good" : "bad"}">${plan.totals.diff >= 0 ? "+" : "\u2212"}${fmtNumber(Math.abs(plan.totals.diff || 0), 0)} vs plan</span>
        </div>
      `;
    }
    statsHtml += buildYoyStat(kpiRows);

    const fullHtml = `<div class="hero-headline">${headlineHtml}</div><div class="hero-stats">${statsHtml}</div>`;
    $$(".hero").forEach((el) => { el.innerHTML = fullHtml; });
  }

  // "vs same month last year" comparison chip — only rendered when a
  // prior-year KPI workbook has been uploaded for the exact month currently
  // on screen (see the "Last year's KPI Calculator" dropzone in the upload
  // modal). Compares Plan Attainment, the headline metric.
  function buildYoyStat(kpiRows) {
    const month = state.snapshot.month;
    const priorYear = state.priorYear && state.priorYear[month];
    const kpiName = "Plan Attainment";
    const thisYearRow = findKpi(kpiRows, kpiName);
    const lastYearRow = priorYear && (priorYear.rows || []).find((r) => r.kpi === kpiName);
    const hasMonthMatch = thisYearRow && lastYearRow && thisYearRow.actualMonth != null && lastYearRow.actualMonth != null;

    const annualTotal = priorYearAnnualTotal(kpiName);

    if (!hasMonthMatch && annualTotal == null) return "";

    const thisPct = hasMonthMatch ? scaleKpiPercent(thisYearRow.actualMonth, kpiName) : null;
    const lastPct = hasMonthMatch ? scaleKpiPercent(lastYearRow.actualMonth, kpiName) : null;
    const totalPct = annualTotal != null ? scaleKpiPercent(annualTotal, kpiName) : null;
    const deltaPp = hasMonthMatch ? thisPct - lastPct : null;
    const g = deltaPp != null ? (deltaPp >= 0 ? "good" : "bad") : "flat";

    const scaleValues = [thisPct, lastPct, totalPct].filter((v) => v != null);
    const maxScale = Math.max(...scaleValues, 1) * 1.15;
    const barPct = (v) => (v == null ? 0 : Math.min(100, (v / maxScale) * 100));

    const rows = [];
    if (hasMonthMatch) {
      rows.push(["This", "this-year", thisPct]);
      rows.push(["Last", "last-year", lastPct]);
    }
    if (totalPct != null) {
      rows.push(["Total", "total-year", totalPct]);
    }

    const barsHtml = rows.map(([label, cls, pct]) => `
      <div class="yoy-bar-row">
        <span class="yl">${label}</span>
        <div class="yoy-bar-track"><div class="yoy-bar-fill ${cls}" style="width:${barPct(pct)}%"></div></div>
        <span class="yv">${pct.toFixed(1)}%</span>
      </div>
    `).join("");

    const kicker = hasMonthMatch ? `vs ${month} last year` : "vs last year";
    const chipHtml = deltaPp != null
      ? `<span class="chip ${g}">${deltaPp >= 0 ? "+" : "\u2212"}${Math.abs(deltaPp).toFixed(1)}pp YoY</span>`
      : "";

    return `
      <div class="hero-stat yoy-stat">
        <span class="k">${kicker}</span>
        <div class="yoy-bars">${barsHtml}</div>
        ${chipHtml}
      </div>
    `;
  }

  // Last year's full-year total for a KPI — the YTD value from whichever
  // saved prior-year month is chronologically latest, since YTD-at-that-point
  // already is the cumulative total once it's the final populated month.
  function priorYearAnnualTotal(kpiName) {
    const months = Object.keys(state.priorYear || {});
    if (!months.length) return null;
    const latest = [...months].sort((a, b) => MONTH_FULL_LIST.indexOf(b) - MONTH_FULL_LIST.indexOf(a))[0];
    const row = (state.priorYear[latest].rows || []).find((r) => r.kpi === kpiName);
    return row ? row.actualYtd : null;
  }

  function renderMetricTile(row) {
    const direction = KPI_DIRECTION[row.kpi] || "higher";
    const gMonth = goodness(direction, row.varMonth);
    const gYtd = goodness(direction, row.varYtd);
    const badgeClass = gMonth === "flat" ? "flat" : gMonth;

    const el = document.createElement("div");
    el.className = "metric-tile";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `Inspect ${row.kpi}`);
    el.innerHTML = `
      <div class="mt-top">
        <span class="mt-name" title="${row.kpi}">${row.kpi}<span class="unit">${row.unit || ""}</span></span>
        <span class="mt-badge ${badgeClass}">${fmtKpiDelta(row.varMonth, row.unit, row.kpi)}</span>
      </div>
      ${renderTilePeriod("This month", row.budgetMonth, row.actualMonth, row.unit, row.kpi, gMonth)}
      ${renderTilePeriod("Year to date", row.budgetYtd, row.actualYtd, row.unit, row.kpi, gYtd)}
    `;
    return el;
  }

  function renderTilePeriod(label, budget, actual, unit, kpiName, g) {
    const b = budget == null ? 0 : scaleForBar(budget, unit, kpiName);
    const a = actual == null ? 0 : scaleForBar(actual, unit, kpiName);
    const fillColor = g === "good" ? "var(--teal)" : g === "bad" ? "var(--orange)" : "var(--sky)";

    if (state.chartStyle === "pie") {
      const ratio = b !== 0 ? Math.abs(a / b) : 0;
      const pct = Math.max(0, Math.min(100, ratio * 100));
      return `
        <div class="mt-period">
          <div class="mt-period-head">${label}</div>
          <div class="mt-period-pie">
            <div class="mt-pie" style="background:conic-gradient(${fillColor} ${pct}%, var(--wash) 0)" title="${pct.toFixed(0)}% of target"></div>
            <div class="mt-pie-vals">
              <div class="mt-actual">${fmtKpiValue(actual, unit, kpiName)}</div>
              <div class="mt-meta">target ${fmtKpiValue(budget, unit, kpiName)}</div>
            </div>
          </div>
        </div>
      `;
    }

    const max = Math.max(Math.abs(b), Math.abs(a), 1) * 1.15;
    const fillPct = Math.min(100, (Math.abs(a) / max) * 100);
    const targetPct = Math.min(100, (Math.abs(b) / max) * 100);
    const fillClass = g === "good" ? "good" : g === "bad" ? "bad" : "";
    return `
      <div class="mt-period">
        <div class="mt-period-head">${label}</div>
        <div class="mt-actual">${fmtKpiValue(actual, unit, kpiName)}</div>
        <div class="mt-bar">
          <div class="fill ${fillClass}" style="width:${fillPct}%"></div>
          <div class="target" style="left:${targetPct}%"></div>
        </div>
        <div class="mt-meta">target ${fmtKpiValue(budget, unit, kpiName)}</div>
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
      if (!section) return;
      const grid = $(".metric-tile-grid", section);
      const count = $(".count", section);
      grid.innerHTML = "";
      const rows = kpiRows.filter((r) => r.type === type);
      count.textContent = rows.length ? `${rows.length} metrics` : "";
      if (!rows.length) {
        section.classList.add("hidden");
        return;
      }
      section.classList.remove("hidden");
      rows.forEach((row) => grid.appendChild(renderMetricTile(row)));
    });
  }

  function renderProduction() {
    const plan = state.snapshot.productionPlan;
    const section = $("#production");
    if (!plan) {
      section.classList.add("hidden");
      $("#prodEmpty").classList.remove("hidden");
      // renderHero() writes to every .hero element including this one, so
      // when there's no production data for the month it needs its own
      // explicit reset rather than being left showing stale KPI-hero content.
      $("#prodHero").innerHTML = `<div class="hero-headline"><div class="kicker">${state.snapshot.month || ""} · Production plan</div><div class="big">—</div></div>`;
      return;
    }
    section.classList.remove("hidden");
    $("#prodEmpty").classList.add("hidden");

    const t = plan.totals || {};
    const value = t.attainment == null ? null : t.attainment * 100;
    const diffGood = (t.diff || 0) >= 0;

    $("#prodHero").innerHTML = `
      <div class="hero-headline prod-headline">
        ${buildMiniGauge(t.attainment)}
        <div class="prod-headline-text">
          <div class="kicker">${plan.month || ""} · Plan attainment</div>
          <div class="big">${value == null ? "—" : value.toFixed(1) + "%"}</div>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span class="k">hL planned</span>
          <span class="v">${fmtNumber(t.planned, 0)}<span class="u">hL</span></span>
        </div>
        <div class="hero-stat">
          <span class="k">hL produced</span>
          <span class="v">${fmtNumber(t.produced, 0)}<span class="u">hL</span></span>
        </div>
        <div class="hero-stat">
          <span class="k">Variance vs plan</span>
          <span class="v">${diffGood ? "+" : "\u2212"}${fmtNumber(Math.abs(t.diff || 0), 0)}<span class="u">hL</span></span>
          <span class="chip ${diffGood ? "good" : "bad"}">${diffGood ? "on plan" : "behind plan"}</span>
        </div>
      </div>
    `;

    renderSkuTable();
  }

  // Small radial progress ring embedded in the production hero's headline —
  // sized to sit inline with the kicker/big text so the bar stays the same
  // height as the Quality / Utilities & Efficiency hero.
  function buildMiniGauge(pct) {
    const size = 60, stroke = 8, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const value = pct == null ? 0 : pct * 100;
    const clamped = Math.max(0, Math.min(100, value));
    const offset = c * (1 - clamped / 100);
    const color = value >= 98 ? "var(--teal)" : "var(--orange)";
    return `
      <div class="mini-gauge">
        <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
          <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="${stroke}"/>
          <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
            stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
            transform="rotate(-90 ${size / 2} ${size / 2})"/>
        </svg>
        <span class="mini-gauge-label">${pct == null ? "—" : Math.round(value) + "%"}</span>
      </div>
    `;
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

    // Scale every bar against the tallest attainment in the current set so
    // the bars are visually comparable to each other, not just to 100%.
    const maxAttainment = Math.max(1, ...skus.map((s) => s.attainment || 0)) * 1.08;

    const tbody = $("#skuTbody");
    tbody.innerHTML = sorted.map((s) => {
      const diffGood = (s.diff || 0) >= 0;
      const pct = s.attainment == null ? 0 : s.attainment * 100;
      const fillPct = Math.min(100, (Math.max(0, s.attainment || 0) / maxAttainment) * 100);
      const targetPct = Math.min(100, (1 / maxAttainment) * 100);
      const barGood = (s.attainment || 0) >= 1;
      return `
        <tr>
          <td>${s.sku}</td>
          <td class="num">${fmtNumber(s.planned, 1)}</td>
          <td class="num">${fmtNumber(s.produced, 1)}</td>
          <td>
            <div class="sku-bar-cell">
              <div class="sku-bar-track">
                <div class="sku-bar-fill ${barGood ? "good" : "bad"}" style="width:${fillPct}%"></div>
                <div class="sku-bar-target" style="left:${targetPct}%"></div>
              </div>
              <span class="sku-bar-label">${s.attainment == null ? "—" : pct.toFixed(0) + "%"}</span>
            </div>
          </td>
          <td class="num sku-diff ${diffGood ? "good" : "bad"}">${s.diff == null ? "—" : (diffGood ? "+" : "\u2212") + fmtNumber(Math.abs(s.diff), 1)}</td>
        </tr>
      `;
    }).join("");
  }

  function renderAll() {
    if (!state.snapshot) {
      $("#pageTabs").classList.add("hidden");
      $("#page-quality").classList.add("hidden");
      $("#page-utileff").classList.add("hidden");
      $("#page-production").classList.add("hidden");
      $("#emptyState").classList.remove("hidden");
      $("#exportBtn").disabled = true;
      $("#savedMeta").textContent = "";
      return;
    }
    $("#emptyState").classList.add("hidden");
    $("#pageTabs").classList.remove("hidden");
    $("#exportBtn").disabled = false;
    showPage(state.activePage);

    renderHero();
    renderCategories();
    renderProduction();

    const savedAt = state.snapshot.savedAt ? new Date(state.snapshot.savedAt) : null;
    $("#savedMeta").textContent = savedAt ? `saved ${savedAt.toLocaleDateString()} ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "";
    $("#footerMeta").textContent = savedAt ? `Last updated ${savedAt.toLocaleString()}` : "";
  }

  const PAGE_IDS = { quality: "page-quality", utileff: "page-utileff", production: "page-production" };
  const TAB_IDS = { quality: "tabQuality", utileff: "tabUtilEff", production: "tabProduction" };

  function showPage(page) {
    state.activePage = page;
    Object.keys(PAGE_IDS).forEach((key) => {
      $(`#${PAGE_IDS[key]}`).classList.toggle("hidden", key !== page);
      $(`#${TAB_IDS[key]}`).classList.toggle("active", key === page);
    });
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
      await loadPriorYear();
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

  const pending = { kpi: null, plan: null, priorYear: null, planMonthOverride: null };

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
    $("#saveUploadBtn").disabled = !(pending.kpi || pending.plan || pending.priorYear);
  }

  async function handleKpiFile(file) {
    try {
      const wb = await readWorkbook(file);
      const parsed = parseKpiWorkbook(wb);
      const history = parseKpiHistoryWorkbook(wb);
      pending.kpi = { file, parsed, history };
      fillDropzone("#dzKpi", file);
      const historyMonths = Object.keys(history).filter((m) => m !== parsed.monthFull).length;
      toast(
        historyMonths > 0
          ? `Read ${parsed.rows.length} KPI rows for ${parsed.monthFull || parsed.month} (plus ${historyMonths} earlier month${historyMonths === 1 ? "" : "s"} of history available to backfill).`
          : `Read ${parsed.rows.length} KPI rows for ${parsed.monthFull || parsed.month}.`,
        "ok"
      );

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
      const fallback = lastPopulatedMonth(wb, availableMonths) || availableMonths[availableMonths.length - 1];
      selectPlanMonth(preferred && availableMonths.includes(preferred) ? preferred : fallback);

      toast(`Found ${availableMonths.length} month tabs.`, "ok");
    } catch (err) {
      toast(err.message, "err");
      resetDropzone("#dzPlan");
      $("#monthPickerRow").classList.add("hidden");
      pending.plan = null;
    }
    updateSaveButtonState();
  }

  // Walk backwards through the workbook's month tabs and return the most
  // recent one with an actual non-zero planned volume — the calendar-last
  // tab is often an empty template for a month that hasn't happened yet.
  function lastPopulatedMonth(wb, availableMonths) {
    for (let i = availableMonths.length - 1; i >= 0; i--) {
      const m = availableMonths[i];
      try {
        const parsed = parseProductionPlanSheet(wb.Sheets[m]);
        if (parsed.totals && parsed.totals.planned > 0) return m;
      } catch {
        continue;
      }
    }
    return null;
  }

  async function handlePriorYearFile(file) {
    try {
      const wb = await readWorkbook(file);
      const parsed = parseKpiWorkbook(wb);
      const history = parseKpiHistoryWorkbook(wb);
      pending.priorYear = { file, parsed, history };
      fillDropzone("#dzPriorYear", file);
      const monthCount = Object.keys(history).length || 1;
      toast(`Read prior-year KPI history — ${monthCount} month${monthCount === 1 ? "" : "s"} found, covering ${parsed.monthFull || parsed.month}.`, "ok");
    } catch (err) {
      toast(err.message, "err");
      resetDropzone("#dzPriorYear");
      pending.priorYear = null;
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
      if (dzId === "#dzPriorYear") pending.priorYear = null;
      updateSaveButtonState();
    });
  }

  function openUploadModal() {
    $("#uploadModal").classList.remove("hidden");
  }
  function closeUploadModal() {
    $("#uploadModal").classList.add("hidden");
  }

  // Click (or Enter/Space) any metric tile to inspect it enlarged — clones
  // the tile exactly as currently rendered (so it works in both bar and pie
  // chart mode) into a centered overlay, scaled up to 400% but capped so it
  // never overflows the viewport on smaller screens.
  function openTileZoom(tileEl) {
    const stage = $("#tileZoomStage");
    stage.innerHTML = "";
    const clone = tileEl.cloneNode(true);
    clone.removeAttribute("tabindex");
    clone.removeAttribute("role");
    stage.appendChild(clone);

    const rect = tileEl.getBoundingClientRect();
    const maxScaleW = (window.innerWidth * 0.88) / rect.width;
    const maxScaleH = (window.innerHeight * 0.85) / rect.height;
    const scale = Math.max(1, Math.min(4, maxScaleW, maxScaleH));
    stage.style.width = rect.width + "px";
    stage.style.setProperty("--zoom-scale", scale);

    const overlay = $("#tileZoomOverlay");
    overlay.classList.remove("hidden");
    requestAnimationFrame(() => overlay.classList.add("open"));
  }

  function closeTileZoom() {
    const overlay = $("#tileZoomOverlay");
    overlay.classList.remove("open");
    setTimeout(() => {
      overlay.classList.add("hidden");
      $("#tileZoomStage").innerHTML = "";
    }, 160);
  }

  async function saveUpload() {
    if (!pending.kpi && !pending.plan && !pending.priorYear) return;
    const btn = $("#saveUploadBtn");
    const label = $("#saveUploadLabel");
    setBusy(btn, true, label);
    try {
      let backfilled = 0;

      // Prior-year comparison data is independent of the current month —
      // save it even if no current-year files were also dropped in. Save
      // every month the Actual/BU/YTD tabs have real data for, same as the
      // current-year backfill, so the YoY comparison works for whichever
      // month you're viewing (and a full-year total becomes available too).
      let priorYearMonthsSaved = 0;
      if (pending.priorYear) {
        const py = pending.priorYear;
        const monthsToSave = { ...(py.history || {}) };
        if (py.parsed.monthFull && !monthsToSave[py.parsed.monthFull]) {
          monthsToSave[py.parsed.monthFull] = py.parsed.rows;
        }
        for (const [m, rows] of Object.entries(monthsToSave)) {
          await savePriorYear(m, rows);
          priorYearMonthsSaved++;
        }
        await loadPriorYear();
      }

      if (pending.kpi || pending.plan) {
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

        // Backfill every other month either workbook has real data for —
        // every populated Production Plan tab, and every month the KPI
        // workbook's Actual/BU/YTD tabs have recorded — so past months
        // become browsable immediately instead of waiting for future
        // uploads. Combine both into one save per month where they overlap.
        const backfillMonths = new Set();
        const productionByMonth = {};
        const kpiByMonth = {};

        if (pending.plan) {
          for (const m of pending.plan.availableMonths) {
            if (m === month) continue;
            let monthParsed;
            try {
              monthParsed = parseProductionPlanWorkbook(pending.plan.wb, m);
            } catch {
              continue;
            }
            const hasData = monthParsed.totals && monthParsed.totals.planned > 0;
            if (!hasData) continue;
            productionByMonth[m] = monthParsed;
            backfillMonths.add(m);
          }
        }
        if (pending.kpi && pending.kpi.history) {
          for (const m of Object.keys(pending.kpi.history)) {
            if (m === month) continue;
            kpiByMonth[m] = { rows: pending.kpi.history[m] };
            backfillMonths.add(m);
          }
        }

        for (const m of backfillMonths) {
          const bfPayload = { month: m };
          if (kpiByMonth[m]) bfPayload.kpiDash = kpiByMonth[m];
          if (productionByMonth[m]) bfPayload.productionPlan = productionByMonth[m];
          await saveSnapshot(bfPayload);
          if (!state.months.includes(m)) state.months.push(m);
          backfilled++;
        }
      }

      renderMonthSelect();
      renderAll();
      const parts = [];
      if (backfilled > 0) parts.push(`backfilled ${backfilled} earlier month${backfilled === 1 ? "" : "s"} of history`);
      if (priorYearMonthsSaved > 0) parts.push(`saved ${priorYearMonthsSaved} month${priorYearMonthsSaved === 1 ? "" : "s"} of last year's data for comparison`);
      toast(parts.length ? `Dashboard updated — also ${parts.join(" and ")}.` : "Dashboard updated for the whole team.", "ok");
      closeUploadModal();
      pending.kpi = null; pending.plan = null; pending.priorYear = null;
      resetDropzone("#dzKpi"); resetDropzone("#dzPlan"); resetDropzone("#dzPriorYear");
      $("#monthPickerRow").classList.add("hidden");
      updateSaveButtonState();
    } catch (err) {
      toast(err.message, "err");
    } finally {
      setBusy(btn, false, label);
    }
  }

  async function savePriorYear(month, rows) {
    const res = await fetch("/api/prioryear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, rows }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "Couldn't save last year's data.");
    return data.months;
  }

  async function loadPriorYear() {
    try {
      const res = await fetch("/api/prioryear");
      const data = await res.json();
      state.priorYear = data.months || {};
    } catch {
      // Non-fatal — the "vs last year" comparison just won't be available.
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
    $("#prodEmptyUploadBtn").addEventListener("click", openUploadModal);
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
    wireDropzone("#dzPriorYear", "#filePriorYear", handlePriorYearFile);
    wireSkuSort();

    $("#tabQuality").addEventListener("click", () => showPage("quality"));
    $("#tabUtilEff").addEventListener("click", () => showPage("utileff"));
    $("#tabProduction").addEventListener("click", () => showPage("production"));

    $("#chartStyleBar").classList.toggle("active", state.chartStyle === "bar");
    $("#chartStylePie").classList.toggle("active", state.chartStyle === "pie");
    $("#chartStyleBar").addEventListener("click", () => setChartStyle("bar"));
    $("#chartStylePie").addEventListener("click", () => setChartStyle("pie"));

    document.addEventListener("click", (e) => {
      const tile = e.target.closest(".metric-tile");
      if (!tile || tile.closest("#tileZoomStage")) return;
      openTileZoom(tile);
    });
    document.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && document.activeElement && document.activeElement.classList.contains("metric-tile")) {
        e.preventDefault();
        openTileZoom(document.activeElement);
      } else if (e.key === "Escape" && $("#tileZoomOverlay").classList.contains("open")) {
        closeTileZoom();
      }
    });
    $("#tileZoomOverlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeTileZoom();
    });
  }

  function setChartStyle(style) {
    if (state.chartStyle === style) return;
    state.chartStyle = style;
    localStorage.setItem("kpisnapshot_chart_style", style);
    $("#chartStyleBar").classList.toggle("active", style === "bar");
    $("#chartStylePie").classList.toggle("active", style === "pie");
    if (state.snapshot) renderCategories();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
