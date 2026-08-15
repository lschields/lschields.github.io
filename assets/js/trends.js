// Completion Trends page.
// Reads data/plan.json + data/history.json (same as the dashboard) and
// computes, across every elapsed day of the plan so far, which sessions got
// checked off - either auto-matched against an uploaded Garmin activity, or
// self-reported via the same Firebase-backed checkbox state the dashboard's
// checkboxes use (assets/js/app.js, via assets/js/firebase-auth.js). This
// page only reads that state, it never writes to it.
//
// PT/strength completion is self-reported (no Garmin signal for it), but
// since that state now lives in Firebase rather than localStorage, it's
// consistent across every device you're signed in on, same as run
// completion (which is mostly Garmin-verified anyway).

// Last-computed stats, kept around so a theme toggle can re-render the chart
// with the new theme's colors without recomputing everything from scratch.
let lastStats = null;

function initThemeToggle() {
  const el = document.getElementById("theme-toggle");
  if (!el) return;
  function applyTheme(theme) {
    if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("td:theme", theme);
    el.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.themeChoice === theme));
    // Chart colors are pulled from CSS custom properties (see cssVar()
    // below), so a theme switch needs an explicit re-render to repaint an
    // already-drawn canvas with the new palette.
    if (lastStats && typeof Chart !== "undefined") renderWeeklyChart(lastStats);
  }
  const current = localStorage.getItem("td:theme") === "light" ? "light" : "dark";
  applyTheme(current);
  el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => applyTheme(b.dataset.themeChoice)));
}

function watchStickyHeader() {
  const header = document.querySelector(".sticky-header");
  if (!header) return;
  const sync = () => document.documentElement.style.setProperty("--sticky-header-height", `${header.offsetHeight}px`);
  sync();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(sync).observe(header);
  else window.addEventListener("resize", sync);
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

// See the matching comment in app.js - toISOString() converts to UTC first,
// which rolls over to tomorrow's date in the evening for any timezone
// behind UTC (Cambridge, MA is UTC-4/-5). Use local calendar-date parts
// instead so "today" matches the device's actual local date.
function pad2(n) { return String(n).padStart(2, "0"); }
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function fmtDateShort(iso) { return parseISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function localKey(dateISO, title) { return `td:${dateISO}:${title}`; }

function buildActivityPool(history) {
  return (history.activities || []).map(a => ({ ...a, claimed: false }));
}
function matchSessionToActivity(pool, dateISO) {
  const c = pool.find(a => !a.claimed && a.date === dateISO);
  if (c) { c.claimed = true; return c; }
  return null;
}

const PT_TYPES = new Set(["strength", "core", "pt"]);

// Walks every day of the plan and works out a completion status for each.
// Returns { days, weeks, byType, currentStreak, longestStreak, totalDone, totalDue }.
function computeCompletionStats(plan, history) {
  const t = todayISO();
  const pool = buildActivityPool(history);
  const days = [];
  const byType = { run: { due: 0, done: 0 }, pt: { due: 0, done: 0 } };

  for (const week of plan.weeks) {
    for (const day of week.days) {
      const isFuture = day.date > t;
      let due = 0, done = 0;

      if (!isFuture) {
        for (const session of day.sessions) {
          if (session.type === "rest") continue;
          due++;
          let isDone = false;
          if (session.type === "run") {
            const match = matchSessionToActivity(pool, day.date);
            isDone = !!match || window.tdAuth.isCheckedIn(localKey(day.date, session.title));
            byType.run.due++;
            if (isDone) byType.run.done++;
          } else if (PT_TYPES.has(session.type)) {
            isDone = window.tdAuth.isCheckedIn(localKey(day.date, session.title));
            byType.pt.due++;
            if (isDone) byType.pt.done++;
          }
          if (isDone) done++;
        }
      }

      let status;
      if (isFuture) status = "upcoming";
      else if (due === 0) status = "rest";
      else if (done === due) status = "full";
      else if (done > 0) status = "partial";
      else status = "none";

      days.push({ date: day.date, day_name: day.day_name, week_num: week.week_num, block: week.block, due, done, status });
    }
  }

  // Weekly rollup - only weeks with at least one elapsed day.
  const weekMap = new Map();
  for (const d of days) {
    if (d.status === "upcoming") continue;
    if (!weekMap.has(d.week_num)) weekMap.set(d.week_num, { week_num: d.week_num, block: d.block, due: 0, done: 0 });
    const w = weekMap.get(d.week_num);
    w.due += d.due;
    w.done += d.done;
  }
  const weeks = [...weekMap.values()].sort((a, b) => a.week_num - b.week_num);

  // Streaks - based on fully-elapsed days only (today is excluded so an
  // unfinished "today" doesn't look like a broken streak).
  const elapsedDays = days.filter(d => d.date < t && d.status !== "upcoming");
  let longestStreak = 0, run = 0;
  for (const d of elapsedDays) {
    const isFull = d.status === "full" || d.status === "rest"; // rest days don't break a streak
    if (isFull) { run++; longestStreak = Math.max(longestStreak, run); }
    else { run = 0; }
  }
  let currentStreak = 0;
  for (let i = elapsedDays.length - 1; i >= 0; i--) {
    const d = elapsedDays[i];
    const isFull = d.status === "full" || d.status === "rest";
    if (isFull) currentStreak++;
    else break;
  }

  const totalDue = days.reduce((s, d) => s + d.due, 0);
  const totalDone = days.reduce((s, d) => s + d.done, 0);

  return { days, weeks, byType, currentStreak, longestStreak, totalDone, totalDue };
}

function pct(done, due) { return due > 0 ? Math.round((done / due) * 100) : 0; }

// Tooltip copy is generated fresh from `stats` on every render (see below),
// so it reads the current numbers rather than describing the metric in the
// abstract - it updates automatically as new Garmin/checkbox data comes in.
function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function kpiTooltip(text) {
  if (!text) return { attr: "", icon: "" };
  return { attr: `data-tooltip="${escapeAttr(text)}"`, icon: `<i class="kpi-info-icon">i</i>` };
}

function initKPITooltips() {
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".kpi-card[data-tooltip]");
    document.querySelectorAll(".kpi-card.tooltip-open").forEach(c => {
      if (c !== card) c.classList.remove("tooltip-open");
    });
    if (card) card.classList.toggle("tooltip-open");
  });
}

function renderKPIs(stats) {
  const el = document.getElementById("trends-kpi");
  const overallPct = pct(stats.totalDone, stats.totalDue);
  const runPct = pct(stats.byType.run.done, stats.byType.run.due);
  const ptPct = pct(stats.byType.pt.done, stats.byType.pt.due);

  const overallTip = overallPct >= 85
    ? `${overallPct}% (${stats.totalDone}/${stats.totalDue}) - strong adherence, whatever you're doing keep doing it.`
    : overallPct >= 60
      ? `${overallPct}% (${stats.totalDone}/${stats.totalDue}) - decent, but there's room. Check the calendar below for where sessions are slipping.`
      : `${overallPct}% (${stats.totalDone}/${stats.totalDue}) - a good chunk of due sessions aren't getting checked off. Worth a look at what's realistic in the plan vs. what's actually happening.`;

  const streakTip = stats.currentStreak === 0
    ? `No active streak right now (longest so far: ${stats.longestStreak}). The next fully-completed day starts a new one.`
    : stats.currentStreak >= stats.longestStreak
      ? `${stats.currentStreak}-day streak - this is your longest yet.`
      : `${stats.currentStreak}-day streak, ${stats.longestStreak - stats.currentStreak} day${stats.longestStreak - stats.currentStreak === 1 ? "" : "s"} short of your best (${stats.longestStreak}).`;

  const runsTip = `${runPct}% (${stats.byType.run.done}/${stats.byType.run.due}) - Garmin-verified, so this holds up regardless of which device or browser you're checking from.`;

  const ptTip = `${ptPct}% (${stats.byType.pt.done}/${stats.byType.pt.due}) - self-reported (no Garmin signal for PT/strength), synced across your devices. If you're doing the work but not checking the box, this will undercount it.`;

  const overallTt = kpiTooltip(overallTip);
  const streakTt = kpiTooltip(streakTip);
  const runsTt = kpiTooltip(runsTip);
  const ptTt = kpiTooltip(ptTip);

  el.innerHTML = `
    <div class="kpi-card" ${overallTt.attr}>
      ${overallTt.icon}
      <div class="kpi-value">${overallPct}<small>%</small></div>
      <div class="kpi-label">Overall completion</div>
      <span class="kpi-flag ${overallPct >= 85 ? "good" : overallPct >= 60 ? "warn" : "bad"}">${stats.totalDone} / ${stats.totalDue} sessions</span>
    </div>
    <div class="kpi-card" ${streakTt.attr}>
      ${streakTt.icon}
      <div class="kpi-value">${stats.currentStreak}<small> day${stats.currentStreak === 1 ? "" : "s"}</small></div>
      <div class="kpi-label">Current streak</div>
      <span class="kpi-flag ${stats.currentStreak > 0 ? "good" : "warn"}">Longest: ${stats.longestStreak}</span>
    </div>
    <div class="kpi-card" ${runsTt.attr}>
      ${runsTt.icon}
      <div class="kpi-value">${runPct}<small>%</small></div>
      <div class="kpi-label">Runs completed</div>
      <span class="kpi-flag ${runPct >= 85 ? "good" : runPct >= 60 ? "warn" : "bad"}">${stats.byType.run.done} / ${stats.byType.run.due}</span>
    </div>
    <div class="kpi-card" ${ptTt.attr}>
      ${ptTt.icon}
      <div class="kpi-value">${ptPct}<small>%</small></div>
      <div class="kpi-label">PT / prehab completed</div>
      <span class="kpi-flag ${ptPct >= 85 ? "good" : ptPct >= 60 ? "warn" : "bad"}">${stats.byType.pt.done} / ${stats.byType.pt.due}</span>
    </div>
  `;
}

const STATUS_LABEL = { full: "Fully completed", partial: "Partially completed", none: "Nothing completed", rest: "Rest day", upcoming: "Upcoming" };

function renderCalendar(stats, plan) {
  const el = document.getElementById("trends-calendar");
  const byWeek = new Map();
  for (const d of stats.days) {
    if (!byWeek.has(d.week_num)) byWeek.set(d.week_num, []);
    byWeek.get(d.week_num).push(d);
  }
  const weekMetaByNum = new Map(plan.weeks.map(w => [w.week_num, w]));

  const rows = [...byWeek.entries()].map(([weekNum, days]) => {
    const meta = weekMetaByNum.get(weekNum);
    const cells = days.map(d => `
      <span class="cal-cell cal-${d.status}" title="${fmtDateShort(d.date)} (${d.day_name}) - ${STATUS_LABEL[d.status]}${d.due ? `: ${d.done}/${d.due}` : ""}"></span>
    `).join("");
    return `
      <div class="cal-row">
        <span class="cal-row-label">W${weekNum}<small>${meta ? " " + meta.block : ""}</small></span>
        <span class="cal-row-cells">${cells}</span>
      </div>`;
  }).join("");

  el.innerHTML = `
    <div class="panel-subheader">
      <div class="panel-kicker">CALENDAR</div>
      <h2>Day-by-day completion</h2>
      <p class="panel-sub">Each square is one day, Monday through Sunday, one row per week.</p>
    </div>
    <div class="cal-legend">
      <span><span class="cal-cell cal-full"></span> Fully completed</span>
      <span><span class="cal-cell cal-partial"></span> Partially completed</span>
      <span><span class="cal-cell cal-none"></span> Nothing completed</span>
      <span><span class="cal-cell cal-rest"></span> Rest day</span>
      <span><span class="cal-cell cal-upcoming"></span> Upcoming</span>
    </div>
    <div class="cal-grid">${rows}</div>
  `;
}

// Reads a live value from the page's CSS custom properties, so chart colors
// always match the current theme instead of being hardcoded to one - same
// helper as app.js's (duplicated rather than shared, consistent with this
// page's existing self-contained-script pattern, e.g. its own pad2/todayISO).
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Tracks the current chart instance so a theme-toggle re-render can destroy
// it before creating a new one - Chart.js throws if you construct on a
// canvas that already has an instance attached.
let weeklyChartInstance = null;

function renderWeeklyChart(stats) {
  const canvas = document.getElementById("chart-weekly-completion");
  if (!canvas) return;
  // See the matching guard in app.js's renderCharts() - Chart.js loads from
  // a CDN and can occasionally fail to be defined in time (slow network,
  // ad/tracker blocker). Show a message instead of leaving a silent blank
  // canvas.
  if (typeof Chart === "undefined") {
    const msg = document.createElement("p");
    msg.className = "panel-sub";
    msg.style.margin = "0";
    msg.textContent = "Charts library didn't load - try refreshing the page.";
    canvas.replaceWith(msg);
    return;
  }

  const good = cssVar("--good");
  const warn = cssVar("--warn");
  const bad = cssVar("--bad");
  const gridColor = hexToRgba(cssVar("--border"), 0.6);
  const tickColor = cssVar("--text-dim");

  const legendEl = document.getElementById("chart-weekly-completion-legend");
  if (legendEl) {
    legendEl.innerHTML = [
      { label: "≥85% completed", color: good },
      { label: "60–84%", color: warn },
      { label: "<60%", color: bad },
    ].map(item => `
      <span class="chart-legend-item">
        <span class="chart-legend-dot" style="background:${item.color}"></span>${item.label}
      </span>`).join("");
  }

  const labels = stats.weeks.map(w => `W${w.week_num}`);
  const data = stats.weeks.map(w => pct(w.done, w.due));

  if (weeklyChartInstance) weeklyChartInstance.destroy();
  weeklyChartInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "% completed",
        data,
        backgroundColor: data.map(v => v >= 85 ? hexToRgba(good, 0.75) : v >= 60 ? hexToRgba(warn, 0.75) : hexToRgba(bad, 0.75)),
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cssVar("--panel"),
          titleColor: cssVar("--text"),
          bodyColor: cssVar("--text-dim"),
          borderColor: cssVar("--border"),
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          boxPadding: 4,
        },
      },
      scales: {
        y: { min: 0, max: 100, ticks: { color: tickColor, font: { size: 11 }, callback: v => v + "%" }, grid: { color: gridColor } },
        x: { ticks: { color: tickColor, font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } },
      },
    },
  });
}

async function init() {
  await window.tdAuth.requireAuth();
  window.tdAuth.initSignOut();
  initThemeToggle();
  watchStickyHeader();
  initKPITooltips();
  try {
    const [plan, history] = await Promise.all([loadJSON("data/plan.json"), loadJSON("data/history.json")]);

    function renderFromStats() {
      const stats = computeCompletionStats(plan, history);
      lastStats = stats; // so a later theme toggle can re-render the chart
      renderKPIs(stats);
      renderCalendar(stats, plan);
      // Not awaited - KPIs/calendar shouldn't wait on the chart. Chart.js is
      // now vendored locally (assets/js/vendor/chart.umd.js, loaded as a
      // normal blocking <script> before this one) rather than fetched from
      // a CDN, so window.chartReady no longer exists - this is just
      // defensive in case that ever changes back.
      renderChartWhenReady(stats);
    }

    async function renderChartWhenReady(stats) {
      try {
        if (window.chartReady) await window.chartReady;
        renderWeeklyChart(stats); // itself checks typeof Chart === "undefined"
      } catch (err) {
        console.error("Failed to render weekly chart:", err);
      }
    }

    // Wait for the first snapshot of checkbox-completion data before the
    // first render, then re-render whenever it changes (including from
    // another device).
    await window.tdAuth.watchCheckins(renderFromStats);
    renderFromStats();
  } catch (err) {
    document.getElementById("trends-kpi").innerHTML =
      `<div class="kpi-card"><div class="kpi-label">Error loading trends: ${err.message}</div></div>`;
    console.error(err);
  }
}

if (window.tdAuth) init();
else window.addEventListener("tdAuthReady", init, { once: true });
