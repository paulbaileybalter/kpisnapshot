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

  // Groups of closely-related KPIs that consolidate into a single card with
  // an internal toggle, instead of one card each — cuts down card count and
  // keeps near-duplicate metrics from crowding a page. Add more groups here
  // the same way to consolidate other metric families later.
  const METRIC_GROUPS = [
    {
      title: "Consumer Complaints",
      variants: [
        { key: "total", label: "Total", kpi: "Consumer Complaints (Total)" },
        { key: "cans", label: "Cans/Bottles", kpi: "Consumer Complaints (Cans and Bottles)" },
        { key: "kegs", label: "Kegs", kpi: "Consumer Complaints (Kegs)" },
        { key: "ratio", label: "Ratio", kpi: "Consumer Complaints Ratio (Total)" },
        { key: "cc_cans", label: "CC Cans", kpi: "Total CC - Cans" },
        { key: "controllable", label: "Controllable", kpi: "Controllable Complaints" },
        { key: "controllable_ratio", label: "Controllable Ratio", kpi: "Controllable Complaints Ratio" },
        { key: "keg_returns", label: "Keg Returns", kpi: "Keg Returns" },
        { key: "keg_returns_ratio", label: "Keg Returns Ratio", kpi: "Keg Returns Ratio" },
      ],
    },
    {
      title: "Package Loss",
      variants: [
        { key: "total", label: "Total", kpi: "Total Package Loss" },
        { key: "can", label: "Can", kpi: "Total Can Loss" },
      ],
    },
    {
      title: "Line Efficiency",
      variants: [
        { key: "pkg_me", label: "Packaging ME", kpi: "Packaging ME - Aggregated" },
        { key: "pkg_ufe", label: "Packaging UFE", kpi: "Packaging UFE - Aggregated" },
        { key: "can_me", label: "Can ME", kpi: "Can Line ME" },
        { key: "can_ufe", label: "Can UFE", kpi: "Can Line UFE" },
        { key: "keg_me", label: "Keg ME", kpi: "Keg Line ME" },
        { key: "keg_ufe", label: "Keg UFE", kpi: "Keg Line UFE" },
      ],
    },
  ];
  const GROUPED_KPI_NAMES = new Set(METRIC_GROUPS.flatMap((g) => g.variants.map((v) => v.kpi)));

  // Standalone KPIs that should render immediately before or after a
  // specific group's card, overriding wherever they'd naturally fall in
  // the data's own row order. Add more entries here for similar one-off
  // placement requests without needing a bigger reordering system.
  const PINNED_RELATIVE_TO_GROUP = [
    { kpi: "Cost of Quality", groupTitle: "Consumer Complaints", position: "after" },
  ];

  const MONTH_ABBR_TO_FULL = {
    Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June",
    Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December",
  };
  const MONTH_FULL_LIST = Object.values(MONTH_ABBR_TO_FULL);
  const MONTH_FULL_TO_ABBR = Object.fromEntries(Object.entries(MONTH_ABBR_TO_FULL).map(([a, f]) => [f, a]));

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
    // Most units (PPM/hL, kg/hL, etc.) are short enough to show in a compact
    // badge, but a couple of the source workbook's unit labels are full
    // phrases (e.g. "% Change vs PY") — those stay off the badge and rely on
    // the fuller "target ..." text already shown in the tile body instead.
    const suffix = unit && unit.length <= 10 ? " " + unit : "";
    return sign + fmtNumber(abs, 2) + suffix;
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
    activePage: "quality", // "quality" | "utilities" | "efficiency" | "production"
    skuSort: { key: "diff", dir: "desc" },
    chartStyle: (localStorage.getItem("kpisnapshot_chart_style") === "pie") ? "pie" : "bar",
    priorYear: {}, // { "July": { rows: [...] }, ... } — same-month-last-year KPI rows, keyed by month
    zoomedTileEl: null, // the original (compact) tile element currently shown zoomed, for prev/next navigation
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
    if (!priorYear) return "";

    const kpiName = "Plan Attainment";
    const thisYearRow = findKpi(kpiRows, kpiName);
    const lastYearRow = (priorYear.rows || []).find((r) => r.kpi === kpiName);
    if (!thisYearRow || !lastYearRow || thisYearRow.actualMonth == null || lastYearRow.actualMonth == null) return "";

    const thisPct = scaleKpiPercent(thisYearRow.actualMonth, kpiName);
    const lastPct = scaleKpiPercent(lastYearRow.actualMonth, kpiName);
    const deltaPp = thisPct - lastPct;
    const g = deltaPp >= 0 ? "good" : "bad";
    const maxScale = Math.max(thisPct, lastPct, 1) * 1.15;
    const thisBarPct = Math.min(100, (thisPct / maxScale) * 100);
    const lastBarPct = Math.min(100, (lastPct / maxScale) * 100);

    return `
      <div class="hero-stat yoy-stat">
        <span class="k">vs ${month} last year</span>
        <div class="yoy-bars">
          <div class="yoy-bar-row">
            <span class="yl">This</span>
            <div class="yoy-bar-track"><div class="yoy-bar-fill this-year" style="width:${thisBarPct}%"></div></div>
            <span class="yv">${thisPct.toFixed(1)}%</span>
          </div>
          <div class="yoy-bar-row">
            <span class="yl">Last</span>
            <div class="yoy-bar-track"><div class="yoy-bar-fill last-year" style="width:${lastBarPct}%"></div></div>
            <span class="yv">${lastPct.toFixed(1)}%</span>
          </div>
        </div>
        <span class="chip ${g}">${deltaPp >= 0 ? "+" : "\u2212"}${Math.abs(deltaPp).toFixed(1)}pp YoY</span>
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

  // ---------- Trend chart (zoomed-tile only) ----------
  // Replaces the "Year to date" bar with a small line chart across the last
  // 6-7 months once a tile is zoomed — the compact tile keeps its normal
  // bars, since there isn't room there to make a trend legible.

  const monthRowsCache = new Map();

  async function fetchMonthRows(month) {
    if (month === state.snapshot.month) {
      return (state.snapshot.kpiDash && state.snapshot.kpiDash.rows) || null;
    }
    if (monthRowsCache.has(month)) return monthRowsCache.get(month);
    try {
      const res = await fetch(`/api/data/${encodeURIComponent(month)}`);
      const data = await res.json();
      const rows = (data.snapshot && data.snapshot.kpiDash && data.snapshot.kpiDash.rows) || null;
      monthRowsCache.set(month, rows);
      return rows;
    } catch {
      monthRowsCache.set(month, null);
      return null;
    }
  }

  // Walks backwards from uptoMonth through the calendar, keeping only months
  // that have actually been saved, until it has `count` of them (or runs out
  // — a KPI tracked for only 2-3 months still gets whatever exists, rather
  // than the chart being blocked until a full 6-7 months accumulate).
  function getTrailingMonths(uptoMonth, count) {
    const idx = MONTH_FULL_LIST.indexOf(uptoMonth);
    if (idx === -1) return state.months.includes(uptoMonth) ? [uptoMonth] : [];
    const trailing = [];
    for (let i = idx; i >= 0 && trailing.length < count; i--) {
      const m = MONTH_FULL_LIST[i];
      if (state.months.includes(m)) trailing.unshift(m);
    }
    return trailing;
  }

  function renderTrendPlaceholder(kpiName, unit) {
    return `
      <div class="mt-period">
        <div class="mt-period-head">Year to date</div>
        <div class="mt-trend-wrap">
          <div class="mt-trend-loading">Loading trend…</div>
        </div>
      </div>
    `;
  }

  async function loadTrendInto(containerEl, kpiName, unit) {
    const wrap = containerEl.classList && containerEl.classList.contains("mt-trend-wrap")
      ? containerEl
      : containerEl.querySelector(".mt-trend-wrap");
    if (!wrap) return;

    const months = getTrailingMonths(state.snapshot.month, 7);
    const rowsPerMonth = await Promise.all(months.map((m) => fetchMonthRows(m)));

    // The zoom may have closed, or the toggle may have switched to a
    // different variant, while these fetches were in flight — don't paint
    // over content that's no longer this chart's to paint.
    if (!document.body.contains(wrap)) return;

    const points = [];
    let target = null;
    months.forEach((m, i) => {
      const rows = rowsPerMonth[i];
      const row = rows && rows.find((r) => r.kpi === kpiName);
      if (row && row.actualMonth != null) {
        points.push({ month: m, raw: row.actualMonth });
        if (target == null && row.budgetMonth != null) target = row.budgetMonth;
      }
    });

    if (points.length < 2) {
      wrap.innerHTML = `<div class="mt-trend-empty">Not enough history yet to chart a trend.</div>`;
      return;
    }
    wrap.innerHTML = renderTrendSvg(points, target, kpiName, unit);
  }

  function renderTrendSvg(points, target, kpiName, unit) {
    const scaledPoints = points.map((p) => ({ ...p, scaled: scaleForBar(p.raw, unit, kpiName) }));
    const scaledTarget = target == null ? null : scaleForBar(target, unit, kpiName);

    const W = 260, H = 86, padL = 8, padR = 8, padT = 10, padB = 18;
    const values = scaledPoints.map((p) => p.scaled).concat(scaledTarget != null ? [scaledTarget] : []);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || Math.abs(max) || 1;
    const padRange = range * 0.15;
    const yMin = min - padRange, yMax = max + padRange;
    const yFor = (v) => padT + (1 - (v - yMin) / ((yMax - yMin) || 1)) * (H - padT - padB);
    const stepX = scaledPoints.length > 1 ? (W - padL - padR) / (scaledPoints.length - 1) : 0;
    const xFor = (i) => padL + i * stepX;

    const direction = KPI_DIRECTION[kpiName] || "higher";
    const last = scaledPoints[scaledPoints.length - 1];
    const g = scaledTarget != null ? goodness(direction, last.scaled - scaledTarget) : "flat";
    const color = g === "good" ? "var(--teal)" : g === "bad" ? "var(--orange)" : "var(--sky)";

    const pathD = scaledPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p.scaled).toFixed(1)}`).join(" ");
    const dots = scaledPoints.map((p, i) => `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(p.scaled).toFixed(1)}" r="${i === scaledPoints.length - 1 ? 3.2 : 2}" fill="${color}"/>`).join("");
    const labels = scaledPoints.map((p, i) => `<text x="${xFor(i).toFixed(1)}" y="${H - 5}" font-size="7.5" text-anchor="middle" fill="var(--muted)" font-family="var(--font-mono)">${p.month.slice(0, 3)}</text>`).join("");
    const targetLine = scaledTarget != null
      ? `<line x1="${padL}" y1="${yFor(scaledTarget).toFixed(1)}" x2="${W - padR}" y2="${yFor(scaledTarget).toFixed(1)}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3,2" opacity="0.55"/>`
      : "";

    return `
      <div class="mt-trend">
        <svg viewBox="0 0 ${W} ${H}" class="mt-trend-svg" preserveAspectRatio="none">
          ${targetLine}
          <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2"/>
          ${dots}
          ${labels}
        </svg>
        <div class="mt-trend-meta">
          <span>${fmtKpiValue(points[0].raw, unit, kpiName)} \u2192 ${fmtKpiValue(points[points.length - 1].raw, unit, kpiName)}</span>
          ${target != null ? `<span>target ${fmtKpiValue(target, unit, kpiName)}</span>` : ""}
        </div>
      </div>
    `;
  }

  function renderMetricTile(row) {
    const direction = KPI_DIRECTION[row.kpi] || "higher";
    const gMonth = goodness(direction, row.varMonth);
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
      ${renderTrendPlaceholder(row.kpi, row.unit)}
      ${renderTileYoyPeriod(row)}
    `;
    // Stashed (not just for zoom's own clone-free rebuild, but also so a
    // later re-render of the zoom overlay for the same tile doesn't need
    // the caller to have kept a reference to the row separately).
    el.__row = row;
    loadTrendInto(el, row.kpi, row.unit);
    return el;
  }

  // Third tile section: this year's total-to-date vs. the target vs. last
  // year's full-year total for that same KPI — only rendered when prior-year
  // data covers this specific metric.
  function renderTileYoyPeriod(row) {
    const lastYearTotal = priorYearAnnualTotal(row.kpi);
    if (lastYearTotal == null || row.actualYtd == null) return "";

    const direction = KPI_DIRECTION[row.kpi] || "higher";
    const deltaRaw = row.actualYtd - lastYearTotal;
    const g = goodness(direction, deltaRaw);
    const badgeClass = g === "flat" ? "flat" : g;
    const fillColor = g === "good" ? "var(--teal)" : g === "bad" ? "var(--orange)" : "var(--sky)";
    const deltaDisplay = fmtKpiDelta(deltaRaw, row.unit, row.kpi);

    const thisTotal = scaleForBar(row.actualYtd, row.unit, row.kpi);
    const lastTotal = scaleForBar(lastYearTotal, row.unit, row.kpi);
    const target = row.budgetYtd == null ? null : scaleForBar(row.budgetYtd, row.unit, row.kpi);

    if (state.chartStyle === "pie") {
      const ratio = lastTotal !== 0 ? Math.abs(thisTotal / lastTotal) : 0;
      const pct = Math.max(0, Math.min(100, ratio * 100));
      return `
        <div class="mt-period">
          <div class="mt-period-head">vs Last Year</div>
          <div class="mt-period-pie">
            <div class="mt-pie" style="background:conic-gradient(${fillColor} ${pct}%, var(--wash) 0)" title="This year's total is ${pct.toFixed(0)}% of last year's"></div>
            <div class="mt-pie-vals">
              <div class="mt-actual"><span class="mt-yoy-badge ${badgeClass}">${deltaDisplay}</span></div>
              <div class="mt-meta">${fmtKpiValue(row.actualYtd, row.unit, row.kpi)} vs LY ${fmtKpiValue(lastYearTotal, row.unit, row.kpi)}</div>
            </div>
          </div>
        </div>
      `;
    }

    const values = [thisTotal, lastTotal, target].filter((v) => v != null).map(Math.abs);
    const max = Math.max(...values, 1) * 1.15;
    const fillPct = Math.min(100, (Math.abs(thisTotal) / max) * 100);
    const lastPct = Math.min(100, (Math.abs(lastTotal) / max) * 100);
    const targetPct = target == null ? null : Math.min(100, (Math.abs(target) / max) * 100);
    const fillClass = g === "good" ? "good" : g === "bad" ? "bad" : "";

    return `
      <div class="mt-period">
        <div class="mt-period-head">vs Last Year</div>
        <span class="mt-yoy-badge ${badgeClass}">${deltaDisplay}</span>
        <div class="mt-bar">
          <div class="fill ${fillClass}" style="width:${fillPct}%"></div>
          ${targetPct != null ? `<div class="target" style="left:${targetPct}%"></div>` : ""}
          <div class="lastyear-tick" style="left:${lastPct}%"></div>
        </div>
        <div class="mt-meta">${fmtKpiValue(row.actualYtd, row.unit, row.kpi)} vs LY ${fmtKpiValue(lastYearTotal, row.unit, row.kpi)}</div>
      </div>
    `;
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

  // The ordered list of cards for one category page: dedupes repeated KPI
  // rows, applies PINNED_RELATIVE_TO_GROUP, and folds METRIC_GROUPS rows into
  // single group entries. Shared by the on-screen tiles and the email
  // version so the two can never disagree about what appears or in what order.
  function getCategoryCards(type) {
    const kpiRows = (state.snapshot.kpiDash && state.snapshot.kpiDash.rows) || [];
    // Guard against the same KPI appearing more than once in the saved
    // data (e.g. from a re-save that didn't fully replace the previous
    // rows) — keep only the first occurrence of each KPI name so a stray
    // duplicate can never produce two copies of the same card.
    const seenKpiNames = new Set();
    const rows = kpiRows.filter((r) => {
      if (r.type !== type) return false;
      if (seenKpiNames.has(r.kpi)) return false;
      seenKpiNames.add(r.kpi);
      return true;
    });
    if (!rows.length) return [];

    // Move any pinned standalone KPI to sit immediately before or after
    // its target group's card, regardless of where it naturally falls
    // in the saved data's own row order.
    PINNED_RELATIVE_TO_GROUP.forEach(({ kpi, groupTitle, position }) => {
      const kpiIdx = rows.findIndex((r) => r.kpi === kpi);
      if (kpiIdx === -1) return;
      const group = METRIC_GROUPS.find((g) => g.title === groupTitle);
      if (!group) return;
      const groupIndices = [];
      rows.forEach((r, i) => {
        if (group.variants.some((v) => v.kpi === r.kpi)) groupIndices.push(i);
      });
      if (!groupIndices.length) return;
      const [pinnedRow] = rows.splice(kpiIdx, 1);
      const newGroupIndices = [];
      rows.forEach((r, i) => {
        if (group.variants.some((v) => v.kpi === r.kpi)) newGroupIndices.push(i);
      });
      const insertAt = position === "after"
        ? newGroupIndices[newGroupIndices.length - 1] + 1
        : newGroupIndices[0];
      rows.splice(insertAt, 0, pinnedRow);
    });

    // Rows belonging to a METRIC_GROUPS entry become one consolidated card;
    // everything else stays a normal tile, in its original order. Tracked by
    // group title rather than row index, so it can't be fooled by rows
    // appearing out of the order METRIC_GROUPS lists their variants in.
    const processedGroups = new Set();
    const cards = [];
    rows.forEach((row) => {
      const group = METRIC_GROUPS.find((g) => g.variants.some((v) => v.kpi === row.kpi));
      if (!group) { cards.push({ kind: "tile", row }); return; }
      if (processedGroups.has(group.title)) return;
      processedGroups.add(group.title);
      const variantRows = group.variants
        .map((v) => {
          const r = rows.find((rr) => rr.kpi === v.kpi);
          return r ? { ...v, row: r } : null;
        })
        .filter(Boolean);
      if (variantRows.length > 1) cards.push({ kind: "group", title: group.title, variantRows });
      else if (variantRows.length === 1) cards.push({ kind: "tile", row: variantRows[0].row });
    });
    return cards;
  }

  function renderCategories() {
    TYPE_ORDER.forEach((type) => {
      const section = $(`.category[data-type="${type}"]`);
      if (!section) return;
      const grid = $(".metric-tile-grid", section);
      const count = $(".count", section);
      grid.innerHTML = "";

      const cards = getCategoryCards(type);
      if (!cards.length) {
        section.classList.add("hidden");
        count.textContent = "";
        return;
      }
      section.classList.remove("hidden");
      cards.forEach((c) => {
        grid.appendChild(c.kind === "group" ? renderGroupTile(c.title, c.variantRows) : renderMetricTile(c.row));
      });
      count.textContent = `${cards.length} metric${cards.length === 1 ? "" : "s"}`;
    });
  }

  // One card covering several closely-related KPIs (e.g. Consumer Complaints
  // by channel), switched via a small internal toggle instead of showing one
  // card per variant. Reuses the same period/bar rendering as a normal tile,
  // so it automatically works in both bar and pie chart mode.
  // Wires toggle-button clicks for a consolidated group card's markup,
  // wherever that markup lives (the live tile in the grid, or a cloned copy
  // inside the zoom overlay — cloneNode doesn't carry over listeners, so the
  // clone needs its own call to this too). Returns the paint function so the
  // caller can trigger an initial render; wiring alone doesn't repaint,
  // since a freshly cloned zoom copy should keep showing whatever variant
  // was already selected rather than jumping back to the default.
  function wireGroupToggle(containerEl, variantRows) {
    const defaultVariant = variantRows.find((v) => v.key === "total") || variantRows[0];

    function paint(variantKey) {
      const variant = variantRows.find((v) => v.key === variantKey) || defaultVariant;
      const row = variant.row;
      const direction = KPI_DIRECTION[row.kpi] || "higher";
      const gMonth = goodness(direction, row.varMonth);
      const badgeClass = gMonth === "flat" ? "flat" : gMonth;

      const badge = containerEl.querySelector('[data-role="badge"]');
      badge.className = `mt-badge ${badgeClass}`;
      badge.textContent = fmtKpiDelta(row.varMonth, row.unit, row.kpi);

      containerEl.querySelector(".mt-group-body").innerHTML = `
        ${renderTilePeriod("This month", row.budgetMonth, row.actualMonth, row.unit, row.kpi, gMonth)}
        ${renderTrendPlaceholder(row.kpi, row.unit)}
        ${renderTileYoyPeriod(row)}
      `;
      const wrap = containerEl.querySelector(".mt-trend-wrap");
      if (wrap) loadTrendInto(wrap, row.kpi, row.unit);
    }

    containerEl.querySelectorAll(".mt-group-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        containerEl.querySelectorAll(".mt-group-toggle-btn").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        paint(btn.dataset.variant);
      });
    });

    return paint;
  }

  function renderGroupTile(title, variantRows, opts) {
    const el = document.createElement("div");
    el.className = "metric-tile metric-tile-group";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `Inspect ${title}`);

    const defaultVariant =
      (opts && opts.initialVariantKey && variantRows.find((v) => v.key === opts.initialVariantKey)) ||
      variantRows.find((v) => v.key === "total") ||
      variantRows[0];

    el.innerHTML = `
      <div class="mt-top">
        <span class="mt-name">${title}</span>
        <span class="mt-badge" data-role="badge"></span>
      </div>
      <div class="mt-group-body"></div>
      <div class="mt-group-toggle" role="tablist">
        ${variantRows.map((v) => `
          <button type="button" class="mt-group-toggle-btn${v.key === defaultVariant.key ? " active" : ""}"
            data-variant="${v.key}" role="tab" aria-selected="${v.key === defaultVariant.key}">${v.label}</button>
        `).join("")}
      </div>
    `;

    const paint = wireGroupToggle(el, variantRows);
    paint(defaultVariant.key);

    // Stashed so opening zoom can rebuild this tile from scratch (rather
    // than cloning, which doesn't inherit event listeners) while preserving
    // both its data and whichever variant is currently selected.
    el.__groupVariantRows = variantRows;
    el.__groupTitle = title;

    return el;
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
    const attainDeltaPp = value == null ? null : value - 100;
    const attainGood = attainDeltaPp != null && attainDeltaPp >= 0;

    $("#prodHero").innerHTML = `
      <div class="hero-headline">
        <div class="kicker">${plan.month || ""} · Plan attainment</div>
        <div class="big">${value == null ? "—" : value.toFixed(1) + "%"}<small>vs 100.0% target</small></div>
        ${attainDeltaPp == null ? "" : `<span class="delta ${attainGood ? "good" : "bad"}">${attainGood ? "+" : "\u2212"}${Math.abs(attainDeltaPp).toFixed(1)}pp vs target</span>`}
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
      $("#page-utilities").classList.add("hidden");
      $("#page-efficiency").classList.add("hidden");
      $("#page-production").classList.add("hidden");
      $("#emptyState").classList.remove("hidden");
      $("#exportBtn").disabled = true;
      $("#copyEmailBtn").disabled = true;
      $("#savedMeta").textContent = "";
      return;
    }
    $("#emptyState").classList.add("hidden");
    $("#pageTabs").classList.remove("hidden");
    $("#exportBtn").disabled = false;
    $("#copyEmailBtn").disabled = false;
    showPage(state.activePage);

    renderHero();
    renderCategories();
    renderProduction();

    const savedAt = state.snapshot.savedAt ? new Date(state.snapshot.savedAt) : null;
    $("#savedMeta").textContent = savedAt ? `saved ${savedAt.toLocaleDateString()} ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "";
    $("#footerMeta").textContent = savedAt ? `Last updated ${savedAt.toLocaleString()}` : "";
  }

  const PAGE_IDS = { quality: "page-quality", utilities: "page-utilities", efficiency: "page-efficiency", production: "page-production" };
  const TAB_IDS = { quality: "tabQuality", utilities: "tabUtilities", efficiency: "tabEfficiency", production: "tabProduction" };

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
     Email version — one email covering every tab, built from
     plain tables with inline styles (Gmail strips <style>,
     SVG, CSS variables and most modern layout), then copied to
     the clipboard as rich HTML for pasting into a Gmail draft.
     ========================================================= */

  const EM = {
    teal: "#47D7AC", tealT: "#E4F9F2", orange: "#FDAA63", orangeT: "#FEEBD8", purple: "#7566A0",
    sky: "#99D6EA", pale: "#F1EB9C", gold: "#FFD637", good: "#1f7a5c", bad: "#b3461f",
    line: "#E3E3E3", wash: "#F6F6F6", muted: "#666666", font: "Lexend, 'Segoe UI', Arial, Helvetica, sans-serif",
  };
  const emEsc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // A horizontal bar built from table cells (percent widths), with a black
  // target marker. fillPct/targetPct are 0-100.
  function emBar(fillPct, targetPct, color) {
    const f = Math.max(0, Math.min(100, fillPct));
    const t = targetPct == null ? null : Math.max(0, Math.min(98, targetPct));
    const cell = (w, bg) => w > 0 ? `<td width="${w.toFixed(1)}%" bgcolor="${bg}" style="width:${w.toFixed(1)}%;background:${bg};height:6px;font-size:0;line-height:0;">&nbsp;</td>` : "";
    let cells;
    if (t == null) cells = cell(f, color) + cell(100 - f, "#EDEDED");
    else if (f <= t) cells = cell(f, color) + cell(t - f, "#EDEDED") + cell(2, "#000000") + cell(100 - t - 2, "#EDEDED");
    else cells = cell(t, color) + cell(2, "#000000") + cell(Math.max(0, f - t - 2), color) + cell(100 - f, "#EDEDED");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;table-layout:fixed;border-radius:3px;"><tr>${cells}</tr></table>`;
  }

  function emChip(text, g) {
    const bg = g === "good" ? "#D5F5EA" : g === "bad" ? EM.orangeT : "#EEEEEE";
    const fg = g === "good" ? EM.good : g === "bad" ? EM.bad : EM.muted;
    return `<span style="display:inline-block;background:${bg};color:${fg};font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;">${emEsc(text)}</span>`;
  }

  // Month-by-month column chart with the target drawn as a thin black line
  // across each column. Heights are px (Gmail honours td heights).
  function emTrend(points, target, kpiName, unit) {
    if (!points || points.length < 2) return `<div style="font-size:10px;color:${EM.muted};padding:6px 0;">Not enough history yet to chart a trend.</div>`;
    const vals = points.map((p) => scaleForBar(p.raw, unit, kpiName));
    const tv = target == null ? null : scaleForBar(target, unit, kpiName);
    const all = vals.concat(tv != null ? [tv] : []);
    const min = Math.min(...all), max = Math.max(...all);
    const range = (max - min) || Math.abs(max) || 1;
    const lo = min - range * 0.25, hi = max + range * 0.1;
    const H = 46;
    const h = (v) => Math.max(2, Math.round(((v - lo) / (hi - lo)) * H));
    const dir = KPI_DIRECTION[kpiName] || "higher";
    const sp = (px, bg) => px > 0 ? `<tr><td height="${px}" bgcolor="${bg || "#FFFFFF"}" style="height:${px}px;line-height:0;font-size:0;background:${bg || "#FFFFFF"};">&nbsp;</td></tr>` : "";
    const cols = vals.map((v, i) => {
      const g = tv != null ? goodness(dir, v - tv) : "flat";
      const color = g === "good" ? EM.teal : g === "bad" ? EM.orange : EM.sky;
      const hv = h(v);
      let rows;
      if (tv == null) rows = sp(H - hv) + sp(hv, color);
      else {
        const ht = h(tv);
        rows = hv >= ht
          ? sp(H - hv) + sp(hv - ht, color) + sp(1, "#000000") + sp(Math.max(0, ht - 1), color)
          : sp(H - ht) + sp(1, "#000000") + sp(Math.max(0, ht - hv - 1)) + sp(hv, color);
      }
      return `<td valign="bottom" align="center" style="padding:0 2px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">${rows}</table><div style="font-size:9px;color:${EM.muted};padding-top:2px;">${points[i].month.slice(0, 3)}</div></td>`;
    }).join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;table-layout:fixed;"><tr>${cols}</tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;"><tr>
        <td valign="top" height="26" style="height:26px;font-size:10px;color:${EM.muted};padding-top:3px;">${emEsc(fmtKpiValue(points[0].raw, unit, kpiName))} &rarr; ${emEsc(fmtKpiValue(points[points.length - 1].raw, unit, kpiName))}</td>
        ${target != null ? `<td valign="top" align="right" style="font-size:10px;color:${EM.muted};padding-top:3px;">target ${emEsc(fmtKpiValue(target, unit, kpiName))}</td>` : ""}
      </tr></table>`;
  }

  async function emTrendPoints(kpiName, months) {
    const rowsPerMonth = await Promise.all(months.map((m) => fetchMonthRows(m)));
    const points = [];
    let target = null;
    months.forEach((m, i) => {
      const r = rowsPerMonth[i] && rowsPerMonth[i].find((x) => x.kpi === kpiName);
      if (r && r.actualMonth != null) {
        points.push({ month: m, raw: r.actualMonth });
        if (target == null && r.budgetMonth != null) target = r.budgetMonth;
      }
    });
    return { points, target };
  }

  function emPeriod(label, actual, budget, unit, kpiName, g) {
    const color = g === "good" ? EM.teal : g === "bad" ? EM.orange : EM.sky;
    const a = actual == null ? 0 : scaleForBar(actual, unit, kpiName);
    const b = budget == null ? null : scaleForBar(budget, unit, kpiName);
    const max = Math.max(Math.abs(a), Math.abs(b || 0), 1) * 1.15;
    return `
      <div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:${EM.muted};padding-top:8px;">${label}</div>
      <div style="font-size:18px;font-weight:700;line-height:1.2;padding:1px 0 4px;">${emEsc(fmtKpiValue(actual, unit, kpiName))}</div>
      ${emBar((Math.abs(a) / max) * 100, b == null ? null : (Math.abs(b) / max) * 100, color)}
      <div style="font-size:10px;color:${EM.muted};padding-top:2px;">target ${emEsc(fmtKpiValue(budget, unit, kpiName))}</div>`;
  }

  function emLastYear(row) {
    const ly = priorYearAnnualTotal(row.kpi);
    if (ly == null || row.actualYtd == null) return "";
    const g = goodness(KPI_DIRECTION[row.kpi] || "higher", row.actualYtd - ly);
    return `<div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:${EM.muted};padding-top:8px;">vs Last Year</div>
      <div style="padding:2px 0;">${emChip(fmtKpiDelta(row.actualYtd - ly, row.unit, row.kpi), g)}</div>
      <div style="font-size:10px;color:${EM.muted};">${emEsc(fmtKpiValue(row.actualYtd, row.unit, row.kpi))} vs LY ${emEsc(fmtKpiValue(ly, row.unit, row.kpi))}</div>`;
  }

  async function emTile(row, months, narrow) {
    const g = goodness(KPI_DIRECTION[row.kpi] || "higher", row.varMonth);
    const { points, target } = await emTrendPoints(row.kpi, months);
    // Content only: the border/padding live on the grid cell itself (see
    // emGrid) so every tile in a row stretches to the tallest one.
    const header = narrow
      ? `<div style="height:36px;font-size:13px;font-weight:700;line-height:1.3;">${emEsc(row.kpi)} <span style="font-size:10px;font-weight:400;color:${EM.muted};">${emEsc(row.unit || "")}</span></div>
      <div style="padding:2px 0 0;">${emChip(fmtKpiDelta(row.varMonth, row.unit, row.kpi), g)}</div>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;"><tr>
        <td valign="top" height="34" style="height:34px;font-size:13px;font-weight:700;line-height:1.3;">${emEsc(row.kpi)} <span style="font-size:10px;font-weight:400;color:${EM.muted};">${emEsc(row.unit || "")}</span></td>
        <td valign="top" align="right" style="padding-left:6px;">${emChip(fmtKpiDelta(row.varMonth, row.unit, row.kpi), g)}</td>
      </tr></table>`;
    return `${header}
      ${emPeriod("This month", row.actualMonth, row.budgetMonth, row.unit, row.kpi, g)}
      <div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:${EM.muted};padding:9px 0 3px;">Year to date trend</div>
      ${emTrend(points, target, row.kpi, row.unit)}
      ${emLastYear(row)}`;
  }

  // A consolidated group (Consumer Complaints, Line Efficiency) becomes a
  // full-width table of all its variants instead of a toggle.
  function emGroup(title, variantRows) {
    const head = (t, a) => `<td align="${a || "right"}" style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:${EM.muted};padding:4px 6px;border-bottom:2px solid ${EM.teal};">${t}</td>`;
    const body = variantRows.map(({ label, row }) => {
      const g = goodness(KPI_DIRECTION[row.kpi] || "higher", row.varMonth);
      const td = (t, a, extra) => `<td align="${a || "right"}" style="font-size:12px;padding:5px 6px;border-bottom:1px solid ${EM.line};${extra || ""}">${t}</td>`;
      return `<tr>${td(`<b>${emEsc(row.kpi)}</b>`, "left")}${td(emEsc(fmtKpiValue(row.actualMonth, row.unit, row.kpi)), "right", "font-weight:700;")}${td(emEsc(fmtKpiValue(row.budgetMonth, row.unit, row.kpi)), "right", `color:${EM.muted};`)}${td(emChip(fmtKpiDelta(row.varMonth, row.unit, row.kpi), g))}${td(emEsc(fmtKpiValue(row.actualYtd, row.unit, row.kpi)), "right")}</tr>`;
    }).join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;width:100%;border:1.5px solid #000000;border-radius:10px;background:#FFFFFF;"><tr><td style="padding:9px 11px;font-family:${EM.font};color:#000000;">
      <div style="font-size:13px;font-weight:700;padding-bottom:4px;">${emEsc(title)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
        <tr>${head("Metric", "left")}${head("This month")}${head("Target")}${head("vs target")}${head("YTD")}</tr>${body}
      </table></td></tr></table>`;
  }

  function emSectionHeader(title, color) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;"><tr>
      <td width="12" style="padding:0 8px 0 0;" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="10" height="10" bgcolor="${color}" style="width:10px;height:10px;background:${color};border:1px solid #000000;font-size:0;line-height:0;">&nbsp;</td></tr></table></td>
      <td style="font-family:${EM.font};font-size:17px;font-weight:700;padding:18px 0 8px;" valign="middle">${emEsc(title)}</td></tr></table>`;
  }

  // One heading cell (swatch + title), for use inside a multi-column heading row.
  function emHeadingCell(title, color, colspan, widthPct) {
    return `<td colspan="${colspan}" width="${widthPct}%" valign="bottom" style="width:${widthPct}%;padding:18px 0 8px;font-family:${EM.font};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="10" height="10" bgcolor="${color}" style="width:10px;height:10px;background:${color};border:1px solid #000000;font-size:0;line-height:0;">&nbsp;</td>
        <td style="font-size:17px;font-weight:700;padding-left:8px;">${emEsc(title)}</td></tr></table></td>`;
  }

  // A row of four tiles where the first belongs to one section and the other
  // three to the next (e.g. the last Utilities tile beside the Efficiency
  // tiles), each section keeping its own heading above its tiles.
  function emMergedRow(first, second, firstTiles, secondTiles) {
    const tilesHtml = firstTiles.concat(secondTiles);
    // Same 32% tile / 2% gap columns as emGrid, so the widths match the rows above and below.
    const tileTd = (html) => `<td width="32%" valign="top" style="width:32%;border:1.5px solid #000000;border-radius:10px;background:#FFFFFF;padding:9px 11px;font-family:${EM.font};color:#000000;">${html}</td>`;
    const gap = `<td width="2%" style="width:2%;font-size:0;line-height:0;">&nbsp;</td>`;
    const blank = `<td width="32%" style="width:32%;">&nbsp;</td>`;
    const tbl = (inner) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed;">${inner}</table>`;
    const firstW = firstTiles.length * 34;
    const cells = tilesHtml.map(tileTd);
    while (cells.length < 3) cells.push(blank);
    return tbl(`<tr>${emHeadingCell(first.title, first.color, 1, firstW)}${emHeadingCell(second.title, second.color, 1, 100 - firstW)}</tr>`)
      + tbl(`<tr>${cells.join(gap)}</tr><tr><td colspan="5" height="10" style="height:10px;font-size:0;line-height:0;">&nbsp;</td></tr>`);
  }

  // Packs tiles three to a row; a group card takes a full row of its own.
  // The tile border lives on each cell (with spacer columns/rows for the
  // gaps) because table cells in a row always stretch to the tallest one —
  // nested tables with height:100% are not reliably honoured by Gmail.
  function emGrid(cellsHtml, startAfterFull) {
    const rows = [];
    let pending = [];
    const tileTd = (html) => html
      ? `<td width="32%" valign="top" style="width:32%;border:1.5px solid #000000;border-radius:10px;background:#FFFFFF;padding:9px 11px;font-family:${EM.font};color:#000000;">${html}</td>`
      : `<td width="32%" style="width:32%;">&nbsp;</td>`;
    const gap = `<td width="2%" style="width:2%;font-size:0;line-height:0;">&nbsp;</td>`;
    const spacerRow = `<tr><td colspan="5" height="10" style="height:10px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
    // A tile left alone on the row right after a full-width card (e.g. Cost
    // of Quality under Consumer Complaints) takes the full width as well.
    let afterFull = !!startAfterFull;
    const flush = () => {
      if (!pending.length) return;
      if (pending.length === 1 && afterFull) {
        rows.push(`<tr><td colspan="5" valign="top" style="border:1.5px solid #000000;border-radius:10px;background:#FFFFFF;padding:9px 11px;font-family:${EM.font};color:#000000;">${pending[0]}</td></tr>${spacerRow}`);
      } else {
        rows.push(`<tr>${tileTd(pending[0])}${gap}${tileTd(pending[1])}${gap}${tileTd(pending[2])}</tr>${spacerRow}`);
      }
      afterFull = false;
      pending = [];
    };
    cellsHtml.forEach((c) => {
      if (c.full) { flush(); rows.push(`<tr><td colspan="5" style="padding:0;">${c.html}</td></tr>${spacerRow}`); afterFull = true; }
      else { pending.push(c.html); if (pending.length === 3) flush(); }
    });
    flush();
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed;">${rows.join("")}</table>`;
  }

  function emHero(title, bigText, subText, stats) {
    const statTds = stats.map((s) => `<td valign="top" style="padding:12px 14px;border-left:1px solid #3a3a3a;font-family:${EM.font};">
      <div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#A8A8A8;">${emEsc(s.k)}</div>
      <div style="font-size:19px;font-weight:700;color:#FFFFFF;padding:2px 0;">${emEsc(s.v)}</div>
      ${s.chip ? emChip(s.chip, s.g) : ""}</td>`).join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0B0B0C" style="border-collapse:separate;width:100%;background:#0B0B0C;border-radius:14px;"><tr>
      <td valign="top" style="padding:12px 16px;font-family:${EM.font};color:#FFFFFF;">
        <div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#A8A8A8;">${emEsc(title)}</div>
        <div style="font-size:30px;font-weight:800;line-height:1.1;color:#FFFFFF;">${emEsc(bigText)}</div>
        <div style="font-size:11px;color:#CFCFCF;padding-top:2px;">${emEsc(subText)}</div></td>${statTds}</tr></table>`;
  }

  function emStripe() {
    const c = (bg) => `<td height="5" width="16.6%" bgcolor="${bg}" style="height:5px;width:16.6%;background:${bg};font-size:0;line-height:0;">&nbsp;</td>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;border-radius:3px;"><tr>${[EM.pale, EM.gold, EM.orange, EM.purple, EM.sky, EM.teal].map(c).join("")}</tr></table>`;
  }

  async function buildEmailHtml() {
    const s = state.snapshot;
    const kpiRows = (s.kpiDash && s.kpiDash.rows) || [];
    const months = getTrailingMonths(s.month, 7);
    const font = `font-family:${EM.font};`;

    // Hero: same headline + stats as the website
    const att = findKpi(kpiRows, "Plan Attainment");
    const stats = [];
    HEADLINE_KPIS.filter((n) => n !== "Plan Attainment").forEach((name) => {
      const r = findKpi(kpiRows, name);
      if (!r) return;
      const g = goodness(KPI_DIRECTION[name] || "higher", r.varMonth);
      stats.push({ k: r.kpi, v: fmtKpiValue(r.actualMonth, r.unit, r.kpi), chip: fmtKpiDelta(r.varMonth, r.unit, r.kpi), g });
    });
    const plan = s.productionPlan;
    if (plan && plan.totals) {
      const d = plan.totals.diff || 0;
      stats.push({ k: "hL produced", v: `${fmtNumber(plan.totals.produced, 0)} hL`, chip: `${d >= 0 ? "+" : "−"}${fmtNumber(Math.abs(d), 0)} vs plan`, g: d >= 0 ? "good" : "bad" });
    }
    const heroBig = att ? fmtKpiValue(att.actualMonth, "%", att.kpi) : plan && plan.totals ? fmtPercent(plan.totals.attainment) : "—";
    const heroSub = att ? `vs ${fmtKpiValue(att.budgetMonth, "%", att.kpi)} target (${fmtKpiDelta(att.varMonth, "%", att.kpi)})` : "";
    const hero = emHero(`${s.month || ""} · Plan attainment`, heroBig, heroSub, stats);

    const catColors = { Quality: EM.purple, Utilities: EM.sky, Efficiency: EM.orange };
    let sections = "";
    // Build every category's cells first, so a trailing lone tile can share
    // a row with the next category's tiles.
    const built = {};
    for (const type of TYPE_ORDER) {
      const cards = getCategoryCards(type);
      if (!cards.length) continue;
      built[type] = await Promise.all(cards.map(async (c) => c.kind === "group"
        ? { full: true, html: emGroup(c.title, c.variantRows) }
        : { full: false, row: c.row, html: await emTile(c.row, months) }));
    }
    // Utilities' leftover tile(s) on a partly-filled last row go beside
    // Efficiency's leading tiles, filling that row up to three across (same widths as every other row).
    let mergedRow = "";
    const util = built.Utilities, eff = built.Efficiency;
    if (util && eff) {
      const lastFull = util.map((c) => c.full).lastIndexOf(true);
      const trailing = util.length - 1 - lastFull;
      const effLead = eff.findIndex((c) => c.full);
      const effLeadCount = effLead === -1 ? eff.length : effLead;
      const leftover = trailing % 3;
      if (leftover > 0 && effLeadCount > 0) {
        const utilTail = util.splice(util.length - leftover, leftover);
        const effHead = eff.splice(0, Math.min(effLeadCount, 3 - leftover));
        const [uHtml, eHtml] = await Promise.all([
          Promise.all(utilTail.map((c) => emTile(c.row, months, true))),
          Promise.all(effHead.map((c) => emTile(c.row, months, true))),
        ]);
        mergedRow = emMergedRow({ title: "Utilities", color: catColors.Utilities }, { title: "Efficiency", color: catColors.Efficiency }, uHtml, eHtml);
      }
    }
    for (const type of TYPE_ORDER) {
      if (!built[type]) continue;
      if (type === "Efficiency" && mergedRow) {
        sections += mergedRow + (built[type].length ? emGrid(built[type], true) : "");
        continue;
      }
      if (built[type].length) sections += emSectionHeader(type, catColors[type]) + emGrid(built[type]);
      else if (type === "Utilities" && mergedRow) continue;
    }

    // Production plan
    if (plan && plan.skus && plan.skus.length) {
      const t = plan.totals || {};
      const th = (x, a) => `<td align="${a || "right"}" style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:${EM.muted};padding:6px;border-bottom:2px solid ${EM.teal};">${x}</td>`;
      const maxAtt = Math.max(1, ...plan.skus.map((k) => k.attainment || 0)) * 1.08;
      const rows = plan.skus.map((k) => {
        const good = (k.attainment || 0) >= 1;
        const dg = (k.diff || 0) >= 0;
        const td = (x, a, extra) => `<td align="${a || "right"}" style="font-size:12px;padding:5px 6px;border-bottom:1px solid ${EM.line};${extra || ""}">${x}</td>`;
        return `<tr>${td(emEsc(k.sku), "left")}${td(fmtNumber(k.planned, 1))}${td(fmtNumber(k.produced, 1))}
          <td width="30%" style="padding:5px 6px;border-bottom:1px solid ${EM.line};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;"><tr><td style="width:100%;">${emBar(((k.attainment || 0) / maxAtt) * 100, (1 / maxAtt) * 100, good ? EM.teal : EM.orange)}</td><td style="font-size:11px;font-weight:700;padding-left:6px;white-space:nowrap;">${k.attainment == null ? "—" : (k.attainment * 100).toFixed(0) + "%"}</td></tr></table></td>
          ${td(k.diff == null ? "—" : (dg ? "+" : "−") + fmtNumber(Math.abs(k.diff), 1), "right", `font-weight:700;color:${dg ? EM.good : EM.bad};`)}</tr>`;
      }).join("");
      const dTot = t.diff || 0;
      sections += emSectionHeader("Production Plan", EM.teal) + `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;width:100%;border:1px solid ${EM.line};border-radius:12px;"><tr><td style="padding:10px 12px;">
          <div style="font-size:12px;padding-bottom:6px;"><b>${t.attainment == null ? "—" : (t.attainment * 100).toFixed(1) + "%"}</b> attainment &nbsp;·&nbsp; ${fmtNumber(t.planned, 0)} hL planned &nbsp;·&nbsp; ${fmtNumber(t.produced, 0)} hL produced &nbsp;·&nbsp; ${dTot >= 0 ? "+" : "−"}${fmtNumber(Math.abs(dTot), 0)} hL vs plan</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
            <tr>${th("SKU", "left")}${th("Planned")}${th("Produced")}${th("Attainment", "left")}${th("Diff")}</tr>${rows}
          </table></td></tr></table>`;
    }

    const savedAt = s.savedAt ? new Date(s.savedAt).toLocaleDateString() : "";
    return `<div style="${font}color:#000000;max-width:720px;">
      ${emStripe()}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;"><tr><td style="padding:12px 0 12px;${font}">
        <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:${EM.muted};">Balter Brewing</div>
        <div style="font-size:22px;font-weight:700;">KPI Snapshot &mdash; ${emEsc(s.month || "")}</div></td></tr></table>
      ${hero}
      ${sections}
      <div style="${font}font-size:10px;color:${EM.muted};padding-top:8px;border-top:1px solid ${EM.line};margin-top:6px;">Bars: black marker = target; teal = on/better than target, orange = behind. Trend columns show the last ${months.length} months.${savedAt ? ` Data saved ${savedAt}.` : ""}</div>
    </div>`;
  }

  function emailToPlainText(html) {
    const d = document.createElement("div");
    d.innerHTML = html;
    return (d.innerText || d.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  }

  async function copyEmail() {
    if (!state.snapshot) return;
    const btn = $("#copyEmailBtn");
    btn.disabled = true;
    try {
      const html = await buildEmailHtml();
      const text = emailToPlainText(html);
      let ok = false;
      try {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        })]);
        ok = true;
      } catch (e) {
        // Fallback: select a rendered copy and use the legacy copy command.
        const holder = document.createElement("div");
        holder.contentEditable = "true";
        holder.style.cssText = "position:fixed;left:-9999px;top:0;background:#fff;";
        holder.innerHTML = html;
        document.body.appendChild(holder);
        const range = document.createRange();
        range.selectNodeContents(holder);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        ok = document.execCommand("copy");
        sel.removeAllRanges();
        holder.remove();
      }
      if (!ok) throw new Error("Your browser blocked copying.");
      toast(`Email copied — paste it into a Gmail draft. Suggested subject: KPI Snapshot — ${state.snapshot.month}`, "ok");
    } catch (err) {
      toast(err.message || "Couldn't copy the email.", "err");
    } finally {
      btn.disabled = false;
    }
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
  // chart mode) into a centered overlay, scaled up to 200% but capped so it
  // never overflows the viewport on smaller screens.
  // Every metric tile on whichever page is currently visible — the list
  // arrow-key/button navigation cycles through while a tile is zoomed.
  function getZoomableTiles() {
    return [...document.querySelectorAll(".app-page:not(.hidden) .metric-tile")];
  }

  function openTileZoom(tileEl) {
    state.zoomedTileEl = tileEl;
    const stage = $("#tileZoomStage");
    stage.innerHTML = "";

    // Rebuilt from scratch rather than cloned — cloneNode wouldn't inherit
    // event listeners (the group toggle wouldn't work), and rebuilding lets
    // this reuse the exact same render functions as the compact grid. The
    // currently-active toggle variant (for group tiles) is preserved so
    // zooming in doesn't reset it.
    let zoomedTile;
    if (tileEl.classList.contains("metric-tile-group") && tileEl.__groupVariantRows) {
      const activeBtn = tileEl.querySelector(".mt-group-toggle-btn.active");
      const initialVariantKey = activeBtn ? activeBtn.dataset.variant : null;
      zoomedTile = renderGroupTile(tileEl.__groupTitle, tileEl.__groupVariantRows, { initialVariantKey });
    } else if (tileEl.__row) {
      zoomedTile = renderMetricTile(tileEl.__row);
    } else {
      // Safety net: should never happen, but better a plain clone than a
      // blank overlay if a tile somehow wasn't stashed with its data.
      zoomedTile = tileEl.cloneNode(true);
    }
    zoomedTile.removeAttribute("tabindex");
    zoomedTile.removeAttribute("role");
    stage.appendChild(zoomedTile);

    const rect = tileEl.getBoundingClientRect();
    const maxScaleW = (window.innerWidth * 0.88) / rect.width;
    const maxScaleH = (window.innerHeight * 0.85) / rect.height;
    const scale = Math.max(1, Math.min(2, maxScaleW, maxScaleH));
    stage.style.width = rect.width + "px";
    stage.style.setProperty("--zoom-scale", scale);

    // Prev/next only make sense with more than one tile to cycle through.
    const canNavigate = getZoomableTiles().length > 1;
    $("#tileZoomPrev").classList.toggle("hidden", !canNavigate);
    $("#tileZoomNext").classList.toggle("hidden", !canNavigate);

    const overlay = $("#tileZoomOverlay");
    overlay.classList.remove("hidden");
    requestAnimationFrame(() => overlay.classList.add("open"));
  }

  // Cycles to the previous (-1) or next (+1) tile on the current page,
  // wrapping around at either end, without closing and reopening the
  // overlay — openTileZoom just swaps the stage's content in place.
  function navigateZoom(delta) {
    const tiles = getZoomableTiles();
    if (tiles.length < 2) return;
    let idx = tiles.indexOf(state.zoomedTileEl);
    if (idx === -1) idx = 0;
    const nextIdx = (idx + delta + tiles.length) % tiles.length;
    openTileZoom(tiles[nextIdx]);
  }

  function closeTileZoom() {
    const overlay = $("#tileZoomOverlay");
    overlay.classList.remove("open");
    setTimeout(() => {
      overlay.classList.add("hidden");
      $("#tileZoomStage").innerHTML = "";
      state.zoomedTileEl = null;
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
    if (!wrap) return;
    const colors = ["#47D7AC", "#99D6EA", "#F1EB9C", "#FFD637", "#7566A0"];
    const count = window.innerWidth < 640 ? 10 : 14;
    for (let i = 0; i < count; i++) {
      const b = document.createElement("span");
      const size = 6 + Math.round(Math.random() * 22);
      b.style.width = size + "px";
      b.style.height = size + "px";
      b.style.left = Math.round(Math.random() * 100) + "%";
      b.style.setProperty("--c", colors[i % colors.length]);
      b.style.animationDuration = (12 + Math.random() * 16).toFixed(1) + "s";
      b.style.animationDelay = (-Math.random() * 28).toFixed(1) + "s";
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
    $("#copyEmailBtn").addEventListener("click", copyEmail);
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
    $("#tabUtilities").addEventListener("click", () => showPage("utilities"));
    $("#tabEfficiency").addEventListener("click", () => showPage("efficiency"));
    $("#tabProduction").addEventListener("click", () => showPage("production"));

    $("#chartStyleBar").classList.toggle("active", state.chartStyle === "bar");
    $("#chartStylePie").classList.toggle("active", state.chartStyle === "pie");
    $("#chartStyleBar").addEventListener("click", () => setChartStyle("bar"));
    $("#chartStylePie").addEventListener("click", () => setChartStyle("pie"));

    document.addEventListener("click", (e) => {
      const tile = e.target.closest(".metric-tile");
      if (!tile || tile.closest("#tileZoomStage") || e.target.closest(".mt-group-toggle-btn")) return;
      openTileZoom(tile);
    });
    document.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && document.activeElement && document.activeElement.classList.contains("metric-tile")) {
        e.preventDefault();
        openTileZoom(document.activeElement);
      } else if (e.key === "Escape" && $("#tileZoomOverlay").classList.contains("open")) {
        closeTileZoom();
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && $("#tileZoomOverlay").classList.contains("open")) {
        e.preventDefault();
        navigateZoom(e.key === "ArrowLeft" ? -1 : 1);
      }
    });
    $("#tileZoomOverlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeTileZoom();
    });
    $("#tileZoomPrev").addEventListener("click", (e) => {
      e.stopPropagation();
      navigateZoom(-1);
    });
    $("#tileZoomNext").addEventListener("click", (e) => {
      e.stopPropagation();
      navigateZoom(1);
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
