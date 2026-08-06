// Training Dashboard front-end.
// Reads data/plan.json (prescribed sessions) and data/history.json (actuals
// from Garmin uploads), renders the dashboard, and matches actual runs to
// planned sessions to compute completion. Everything here is read-only
// against the JSON files - the only "write" behavior is a small localStorage
// toggle for non-running sessions (strength/PT) that Garmin can't verify.

const state = { plan: null, history: null, selectedWeek: null, today: new Date() };

function todayISO() {
  return state.today.toISOString().slice(0, 10);
}

function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmtDateShort(iso) {
  const d = parseISO(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function daysBetween(aISO, bISO) {
  const a = parseISO(aISO), b = parseISO(bISO);
  return Math.round((b - a) / 86400000);
}

function localKey(dateISO, title) {
  return `td:${dateISO}:${title}`;
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function findCurrentWeek(plan) {
  const t = todayISO();
  let w = plan.weeks.find(w => t >= w.start_date && t <= w.end_date);
  if (w) return w;
  if (t < plan.weeks[0].start_date) return plan.weeks[0];
  return plan.weeks[plan.weeks.length - 1];
}

// ---------------------------------------------------------------------
// Matching actual Garmin activities to planned run sessions, by date.
// ---------------------------------------------------------------------
function buildActivityPool(history) {
  return (history.activities || []).map(a => ({ ...a, claimed: false }));
}

function matchSessionToActivity(pool, dateISO) {
  const candidate = pool.find(a => !a.claimed && a.date === dateISO);
  if (candidate) { candidate.claimed = true; return candidate; }
  return null;
}

// ---------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------
function renderKPIs(plan, history) {
  const el = document.getElementById("kpi-strip");
  const t = todayISO();
  const race = plan.athlete.race;
  const daysToRace = daysBetween(t, race.date);

  const currentWeek = findCurrentWeek(plan);
  const pool = buildActivityPool(history);
  const weekActualMi = sumWeekActualMiles(currentWeek, pool);

  const snapshot = history.athlete_snapshot || {};
  const latestReadiness = (history.readiness_history || [])
    .filter(r => r.resting_hr !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-1)[0];
  const latestLoad = (history.load_history || []).slice(-1)[0];

  const cards = [];

  cards.push(`
    <div class="kpi-card">
      <div class="kpi-value">${daysToRace >= 0 ? daysToRace : 0}<small> days</small></div>
      <div class="kpi-label">To ${race.name}</div>
      <span class="kpi-flag good">Goal ${race.goal_time_display} &middot; ${race.goal_pace_per_mi}/mi</span>
    </div>`);

  const pct = currentWeek.target_miles ? Math.round((weekActualMi / currentWeek.target_miles) * 100) : 0;
  cards.push(`
    <div class="kpi-card">
      <div class="kpi-value">${weekActualMi.toFixed(1)}<small> / ${currentWeek.target_miles} mi</small></div>
      <div class="kpi-label">This week's mileage</div>
      <span class="kpi-flag ${pct >= 90 ? "good" : pct >= 50 ? "warn" : "bad"}">${pct}% of target</span>
    </div>`);

  cards.push(`
    <div class="kpi-card">
      <div class="kpi-value">W${currentWeek.week_num}<small> / ${plan.weeks.length}</small></div>
      <div class="kpi-label">${currentWeek.block_label}</div>
      <span class="kpi-flag good">${capitalize(currentWeek.block)} phase</span>
    </div>`);

  // VO2max
  if (snapshot.vo2max) {
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-value">${snapshot.vo2max}</div>
        <div class="kpi-label">VO2 max</div>
        <span class="kpi-flag good">Garmin estimate</span>
      </div>`);
  }

  // Resting HR - latest reading
  if (latestReadiness) {
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-value">${latestReadiness.resting_hr}<small> bpm</small></div>
        <div class="kpi-label">Resting HR</div>
        <span class="kpi-flag good">${fmtDateShort(latestReadiness.date)}</span>
      </div>`);
  }

  // Lactate threshold - HR from Garmin snapshot, pace estimated from the plan's
  // threshold pace zone unless a direct value shows up in a future Garmin export.
  if (snapshot.lthr) {
    const thresholdZone = (plan.athlete.pace_zones || []).find(z => z.name === "Tempo / Threshold");
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-value">${snapshot.lthr}<small> bpm</small></div>
        <div class="kpi-label">Lactate threshold</div>
        <span class="kpi-flag good">${thresholdZone ? thresholdZone.pace_per_mi + "/mi (est.)" : "HR only"}</span>
      </div>`);
  }

  // Load tolerance - ACWR is the standard "is your current load safe" metric
  if (latestLoad && latestLoad.acwr !== undefined) {
    const acwr = latestLoad.acwr;
    let flagClass = "good", label = "safe range";
    if (acwr > 1.5) { flagClass = "bad"; label = "high risk"; }
    else if (acwr > 1.3) { flagClass = "warn"; label = "caution"; }
    else if (acwr < 0.8) { flagClass = "warn"; label = "detraining"; }
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-value">${acwr}</div>
        <div class="kpi-label">Load tolerance (ACWR)</div>
        <span class="kpi-flag ${flagClass}">${label}</span>
      </div>`);
  }

  // Training status - Garmin's own read on whether recent training is working
  if (latestLoad && latestLoad.training_status) {
    const status = latestLoad.training_status;
    const goodStatuses = ["productive", "peaking", "maintaining"];
    const badStatuses = ["overreaching", "detraining", "unproductive"];
    const flagClass = goodStatuses.includes(status) ? "good" : badStatuses.includes(status) ? "bad" : "warn";
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-value" style="font-size:16px; text-transform:capitalize;">${status}</div>
        <div class="kpi-label">Training status</div>
        <span class="kpi-flag ${flagClass}">${fmtDateShort(latestLoad.date)}</span>
      </div>`);
  }

  if (!latestReadiness && !latestLoad) {
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-value">&mdash;</div>
        <div class="kpi-label">Training readiness</div>
        <span class="kpi-flag warn">No Garmin Coach data yet</span>
      </div>`);
  }

  el.innerHTML = cards.join("");
}

function sumWeekActualMiles(week, pool) {
  const dates = week.days.map(d => d.date);
  return pool.filter(a => dates.includes(a.date)).reduce((sum, a) => sum + (a.distance_mi || 0), 0);
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ---------------------------------------------------------------------
// Week tabs
// ---------------------------------------------------------------------
function renderWeekTabs(plan) {
  const el = document.getElementById("week-tabs");
  const t = todayISO();
  el.innerHTML = plan.weeks.map(w => {
    const isCurrent = t >= w.start_date && t <= w.end_date;
    const isPast = t > w.end_date;
    const isActive = state.selectedWeek.week_num === w.week_num;
    return `<button class="week-tab ${isActive ? "active" : ""} ${isCurrent ? "is-current" : ""} ${isPast ? "is-past" : ""}"
              data-week="${w.week_num}">
              <span class="wt-num">W${w.week_num}</span>
              <span class="wt-label">${capitalize(w.block)}</span>
            </button>`;
  }).join("");
  el.querySelectorAll(".week-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const num = Number(btn.dataset.week);
      state.selectedWeek = state.plan.weeks.find(w => w.week_num === num);
      renderAll();
    });
  });
}

// ---------------------------------------------------------------------
// Week detail (day cards + sessions)
// ---------------------------------------------------------------------
const SESSION_ICON = {
  run: "R", strength: "S", core: "C", pt: "+", rest: "-",
};

function sessionKindLabel(s) {
  if (s.type === "run") return s.kind;
  return s.type;
}

function renderSession(session, dateISO, pool) {
  const isRun = session.type === "run";
  const isRest = session.type === "rest";
  let done = false, actualHtml = "", checkClass = "", autoMatched = false;

  if (isRun) {
    const match = matchSessionToActivity(pool, dateISO);
    if (match) {
      done = true;
      autoMatched = true;
      checkClass = "done auto";
      actualHtml = `<div class="session-actual">&#10003; Actual: ${match.distance_mi} mi @ ${match.avg_pace_per_mi || "?"}/mi
        ${match.avg_hr ? ", HR " + match.avg_hr + " avg" : ""}${match.race ? " &mdash; " + (match.note || "") : ""}</div>`;
    } else {
      // No Garmin activity matched yet - let it be manually self-reported until
      // the weekly upload confirms it (at which point the auto-match takes over).
      const key = localKey(dateISO, session.title);
      done = localStorage.getItem(key) === "1";
      checkClass = done ? "done checkable" : "checkable";
    }
  } else if (session.type === "strength" || session.type === "core" || session.type === "pt") {
    const key = localKey(dateISO, session.title);
    done = localStorage.getItem(key) === "1";
    checkClass = done ? "done checkable" : "checkable";
  }

  const checkMark = done ? "&#10003;" : "";
  const checkAttrs = (!autoMatched && !isRest && (session.type === "strength" || session.type === "core" || session.type === "pt" || isRun))
    ? `data-toggle-key="${localKey(dateISO, session.title)}"` : "";

  let exerciseHtml = "";
  if (session.exercises) {
    exerciseHtml = `<ul class="exercise-list">${session.exercises.map(ex =>
      `<li><b>${ex.name}</b> &mdash; ${ex.prescription}${ex.cue ? `<br><span style="opacity:.75">${ex.cue}</span>` : ""}</li>`
    ).join("")}</ul>`;
  }

  const metaParts = [];
  if (session.distance_mi) metaParts.push(`${session.distance_mi} mi`);
  if (session.duration_min) metaParts.push(`${session.duration_min} min`);
  if (session.pace) metaParts.push(session.pace);
  if (session.hr_zone !== undefined && session.hr_zone !== null) metaParts.push(`HR Z${session.hr_zone}`);

  const checkHtml = isRest
    ? `<div class="session-no-check"></div>`
    : `<div class="session-check ${checkClass}" ${checkAttrs}>${checkMark}</div>`;

  return `
    <div class="session">
      ${checkHtml}
      <div class="session-body">
        <div class="session-title-row">
          <span class="session-title">${session.title}</span>
          <span class="session-tag kind-${session.kind || session.type}">${sessionKindLabel(session)}</span>
        </div>
        ${metaParts.length ? `<div class="session-meta">${metaParts.join(" &middot; ")}</div>` : ""}
        ${session.details ? `<div class="session-details">${session.details}</div>` : ""}
        ${exerciseHtml}
        ${session.note ? `<div class="session-note">${session.note}</div>` : ""}
        ${actualHtml}
      </div>
    </div>`;
}

function renderWeekDetail(plan, history) {
  const w = state.selectedWeek;
  const el = document.getElementById("week-detail");
  const pool = buildActivityPool(history);
  const t = todayISO();
  const actualMi = sumWeekActualMiles(w, pool);

  const days = w.days.map(day => {
    const isToday = day.date === t;
    const sessionsHtml = day.sessions.map(s => renderSession(s, day.date, pool)).join("");
    return `
      <div class="day-card ${isToday ? "is-today" : ""}">
        <div class="day-card-head">
          <span class="day-name">${day.day_name}</span>
          <span class="day-date">${fmtDateShort(day.date)}${isToday ? " &middot; today" : ""}</span>
        </div>
        ${sessionsHtml}
      </div>`;
  }).join("");

  el.innerHTML = `
    <div class="week-detail-head">
      <span class="block-pill">${w.block_label}</span>
      <h2>Week ${w.week_num} &middot; ${fmtDateShort(w.start_date)} &ndash; ${fmtDateShort(w.end_date)}</h2>
      <div class="focus">${w.focus}</div>
      <div class="week-target">Target: ${w.target_miles} mi planned &middot; ${actualMi.toFixed(1)} mi logged</div>
    </div>
    <div class="day-grid">${days}</div>
  `;

  el.querySelectorAll("[data-toggle-key]").forEach(node => {
    node.addEventListener("click", () => {
      const key = node.dataset.toggleKey;
      const isDone = localStorage.getItem(key) === "1";
      if (isDone) { localStorage.removeItem(key); } else { localStorage.setItem(key, "1"); }
      renderWeekDetail(plan, history);
    });
  });
}

// ---------------------------------------------------------------------
// Coach notes
// ---------------------------------------------------------------------
function renderCoachNotes() {
  const w = state.selectedWeek;
  const el = document.getElementById("coach-notes");
  if (!w.coach_notes || !w.coach_notes.length) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <div class="panel-kicker">WEEK ${w.week_num} &middot; COACH NOTES</div>
    <h2>${w.focus}</h2>
    ${w.coach_notes.map((note, i) => `
      <div class="coach-note-item">
        <span class="coach-note-num">${i + 1}</span>
        <span>${note}</span>
      </div>`).join("")}
  `;
}

// ---------------------------------------------------------------------
// Retro panel - most recently logged calendar week
// ---------------------------------------------------------------------
function mondayOf(dateISO) {
  const d = parseISO(dateISO);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  return d;
}

function renderRetro(history) {
  const el = document.getElementById("retro-panel");
  const activities = (history.activities || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!activities.length) { el.innerHTML = ""; return; }

  const lastDate = activities[activities.length - 1].date;
  const weekStart = mondayOf(lastDate);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  const inWeek = activities.filter(a => {
    const d = parseISO(a.date);
    return d >= weekStart && d <= weekEnd;
  });

  const totalMi = inWeek.reduce((s, a) => s + (a.distance_mi || 0), 0);
  const totalSec = inWeek.reduce((s, a) => s + (a.duration_sec || 0), 0);
  const avgPaceSec = totalMi > 0 ? totalSec / totalMi : 0;
  const avgPace = avgPaceSec ? `${Math.floor(avgPaceSec / 60)}:${String(Math.round(avgPaceSec % 60)).padStart(2, "0")}` : "-";

  const rows = inWeek.slice().reverse().map(a => `
    <tr>
      <td>${fmtDateShort(a.date)}</td>
      <td class="strong">${a.title || capitalize(a.sport || "run")}</td>
      <td>${a.distance_mi} mi</td>
      <td>${Math.round(a.duration_sec / 60)} min</td>
      <td>${a.avg_pace_per_mi || "-"}/mi</td>
      <td>${a.avg_hr || "-"}</td>
    </tr>`).join("");

  el.innerHTML = `
    <div class="panel-kicker">MOST RECENT LOGGED WEEK</div>
    <h2>${fmtDateShort(weekStart.toISOString().slice(0,10))} &ndash; ${fmtDateShort(weekEnd.toISOString().slice(0,10))} retrospective</h2>
    <div class="mini-grid">
      <div class="mini-stat"><div class="v">${totalMi.toFixed(1)} mi</div><div class="l">Distance</div></div>
      <div class="mini-stat"><div class="v">${inWeek.length}</div><div class="l">Activities logged</div></div>
      <div class="mini-stat"><div class="v">${avgPace}/mi</div><div class="l">Avg pace</div></div>
    </div>
    <table class="simple">
      <thead><tr><th>Date</th><th>Activity</th><th>Distance</th><th>Time</th><th>Pace</th><th>Avg HR</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------
function renderCharts(plan, history) {
  const pool = buildActivityPool(history);
  const labels = plan.weeks.map(w => "W" + w.week_num);
  const planned = plan.weeks.map(w => w.target_miles);
  const actual = plan.weeks.map(w => {
    const dates = w.days.map(d => d.date);
    const t = todayISO();
    const hasPassed = w.start_date <= t;
    if (!hasPassed) return null;
    const mi = pool.filter(a => dates.includes(a.date)).reduce((s, a) => s + (a.distance_mi || 0), 0);
    return Math.round(mi * 10) / 10;
  });

  new Chart(document.getElementById("chart-mileage"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Planned", data: planned, backgroundColor: "rgba(79,140,255,0.25)", borderRadius: 3 },
        { label: "Actual", data: actual, backgroundColor: "rgba(52,211,153,0.65)", borderRadius: 3 },
      ],
    },
    options: chartOptions(),
  });

  const readiness = (history.readiness_history || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  new Chart(document.getElementById("chart-hrv"), {
    type: "line",
    data: {
      labels: readiness.map(r => fmtDateShort(r.date)),
      datasets: [
        { label: "HRV", data: readiness.map(r => r.hrv ?? r.hrv_last_night_avg ?? null),
          borderColor: "#4f8cff", backgroundColor: "transparent", tension: 0.3, spanGaps: true },
        { label: "Resting HR", data: readiness.map(r => r.resting_hr ?? null),
          borderColor: "#e3b341", backgroundColor: "transparent", tension: 0.3, spanGaps: true, yAxisID: "y1" },
      ],
    },
    options: dualAxisChartOptions(),
  });

  const load = (history.load_history || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  new Chart(document.getElementById("chart-load"), {
    type: "line",
    data: {
      labels: load.map(l => fmtDateShort(l.date)),
      datasets: [
        { label: "ATL (fatigue)", data: load.map(l => l.atl ?? null), borderColor: "#f2705c", tension: 0.3 },
        { label: "CTL (fitness)", data: load.map(l => l.ctl ?? null), borderColor: "#4f8cff", tension: 0.3 },
        { label: "ACWR", data: load.map(l => l.acwr ?? null), borderColor: "#e3b341", tension: 0.3, yAxisID: "y1" },
      ],
    },
    options: dualAxisChartOptions(),
  });
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: "#8a94a6", font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: "#5b6577", font: { size: 10 } }, grid: { color: "#1c2431" } },
      y: { ticks: { color: "#5b6577", font: { size: 10 } }, grid: { color: "#1c2431" } },
    },
  };
}

function dualAxisChartOptions() {
  const base = chartOptions();
  base.scales.y1 = {
    position: "right",
    ticks: { color: "#5b6577", font: { size: 10 } },
    grid: { display: false },
  };
  return base;
}

// ---------------------------------------------------------------------
// Race log + pace zones (static-ish reference panels)
// ---------------------------------------------------------------------
function renderRaceLog(history) {
  const el = document.getElementById("race-log-panel");
  const races = (history.races || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (!races.length) { el.innerHTML = ""; return; }
  const rows = races.map(r => `
    <tr>
      <td>${r.date ? fmtDateShort(r.date) : (r.date_note || "?")}</td>
      <td class="strong">${r.name}</td>
      <td>${r.distance_mi.toFixed(2)} mi</td>
      <td>${r.time_display}</td>
      <td>${r.notes || ""}</td>
    </tr>`).join("");
  el.innerHTML = `
    <div class="panel-kicker">RACE LOG</div>
    <h2>Results</h2>
    <table class="simple">
      <thead><tr><th>Date</th><th>Race</th><th>Distance</th><th>Time</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderPaceZones(plan) {
  const el = document.getElementById("pace-zones-panel");
  const a = plan.athlete;
  const zoneRows = a.pace_zones.map(z => `
    <tr><td class="strong">${z.name}</td><td>${z.pace_per_mi}</td><td>Zone ${z.hr_zone}</td></tr>
  `).join("");
  const context = (a.context || []).map(c => `<li>${c}</li>`).join("");
  el.innerHTML = `
    <div class="panel-kicker">REFERENCE</div>
    <h2>Pace zones &amp; context</h2>
    <table class="simple">
      <thead><tr><th>Zone</th><th>Pace / mi</th><th>HR</th></tr></thead>
      <tbody>${zoneRows}</tbody>
    </table>
    <ul class="exercise-list" style="margin-top:12px;">${context}</ul>
  `;
}

// ---------------------------------------------------------------------
// Theme toggle (dark "maroon dark" / light "trackside cream")
// ---------------------------------------------------------------------
function initThemeToggle() {
  const el = document.getElementById("theme-toggle");
  if (!el) return;

  function applyTheme(theme) {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem("td:theme", theme);
    el.querySelectorAll("button").forEach(b => {
      b.classList.toggle("active", b.dataset.themeChoice === theme);
    });
  }

  const current = localStorage.getItem("td:theme") === "light" ? "light" : "dark";
  applyTheme(current);

  el.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => applyTheme(b.dataset.themeChoice));
  });
}

// ---------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------
function renderHeader(plan) {
  document.getElementById("eyebrow").textContent =
    `${plan.athlete.race.name.toUpperCase()} · ${fmtDateShort(plan.athlete.race.date)} 2026`;
  document.getElementById("header-meta").innerHTML = `
    <span>Goal: <strong>${plan.athlete.race.goal_time_display}</strong> (${plan.athlete.race.goal_pace_per_mi}/mi)</span>
    <span>Plan: <strong>${plan.weeks.length} weeks</strong></span>
  `;
}

// ---------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------
function renderAll() {
  renderKPIs(state.plan, state.history);
  renderWeekTabs(state.plan);
  renderWeekDetail(state.plan, state.history);
  renderCoachNotes();
}

async function init() {
  initThemeToggle();
  try {
    const [plan, history] = await Promise.all([
      loadJSON("data/plan.json"),
      loadJSON("data/history.json"),
    ]);
    state.plan = plan;
    state.history = history;
    state.selectedWeek = findCurrentWeek(plan);

    renderHeader(plan);
    renderAll();
    renderRetro(history);
    renderCharts(plan, history);
    renderRaceLog(history);
    renderPaceZones(plan);
  } catch (err) {
    document.getElementById("kpi-strip").innerHTML =
      `<div class="kpi-card"><div class="kpi-label">Error loading dashboard data: ${err.message}</div></div>`;
    console.error(err);
  }
}

init();
