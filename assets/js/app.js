// Training Dashboard front-end.
// Reads data/plan.json (prescribed sessions) and data/history.json (actuals
// from Garmin uploads), renders the dashboard, and matches actual runs to
// planned sessions to compute completion. Everything here is read-only
// against the JSON files - the only "write" behavior is a small localStorage
// toggle for non-running sessions (strength/PT) that Garmin can't verify.

const state = { plan: null, history: null, selectedWeek: null, today: new Date(), workoutsByDate: {} };

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

// Like loadJSON, but missing-file is not an error - the workouts manifest
// won't exist until the first batch of Garmin workout files has been
// generated, and the dashboard should just render without download links
// rather than break.
async function loadJSONOptional(path) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function buildWorkoutsByDate(manifest) {
  const map = {};
  for (const w of (manifest && manifest.workouts) || []) {
    (map[w.date] = map[w.date] || []).push(w);
  }
  return map;
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
// Small inline visuals for the fitness-metric KPI cards
// ---------------------------------------------------------------------
function sparklineSVG(values, colorVar) {
  const w = 60, h = 22;
  const clean = values.filter(v => v !== undefined && v !== null && !Number.isNaN(v));
  if (!clean.length) return "";
  if (clean.length === 1) {
    return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <circle cx="${w - 3}" cy="${h / 2}" r="2.5" fill="var(${colorVar})" /></svg>`;
  }
  const min = Math.min(...clean), max = Math.max(...clean);
  const range = max - min || 1;
  const stepX = w / (clean.length - 1);
  const pad = 3;
  const pt = (v, i) => {
    const x = i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y];
  };
  const pts = clean.map((v, i) => pt(v, i));
  const line = pts.map(p => p.join(",")).join(" ");
  const [lastX, lastY] = pts[pts.length - 1];
  return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline points="${line}" fill="none" stroke="var(${colorVar})" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.2" fill="var(${colorVar})" /></svg>`;
}

// Semicircular "speedometer" gauge - colored range bands (each defined by an
// upper bound + color) with a needle pointing at the current value.
function polarPt(cx, cy, r, thetaDeg) {
  const t = (thetaDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(t), y: cy - r * Math.sin(t) };
}
function valueToTheta(value, min, max) {
  const f = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return 180 - f * 180;
}
function bandArcPath(cx, cy, r, theta1, theta2) {
  const p1 = polarPt(cx, cy, r, theta1), p2 = polarPt(cx, cy, r, theta2);
  const largeArc = theta1 - theta2 > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}
function bandFor(value, bands, min) {
  let lower = min;
  for (const b of bands) {
    if (value <= b.upper) return b;
    lower = b.upper;
  }
  return bands[bands.length - 1];
}
function gaugeSVG(value, min, max, bands) {
  const cx = 50, cy = 50, r = 40, strokeW = 9;
  let lower = min;
  const arcs = bands.map(b => {
    const theta1 = valueToTheta(lower, min, max), theta2 = valueToTheta(b.upper, min, max);
    lower = b.upper;
    return `<path d="${bandArcPath(cx, cy, r, theta1, theta2)}" stroke="var(${b.colorVar})" stroke-width="${strokeW}" fill="none" />`;
  }).join("");
  const needleTheta = valueToTheta(value, min, max);
  const tip = polarPt(cx, cy, r - 7, needleTheta);
  const needle = `<line x1="${cx}" y1="${cy}" x2="${tip.x.toFixed(2)}" y2="${tip.y.toFixed(2)}" stroke="var(--text)" stroke-width="2.5" stroke-linecap="round" />
    <circle cx="${cx}" cy="${cy}" r="3.5" fill="var(--text)" />`;
  return `<svg viewBox="0 0 100 56" class="gauge-svg" aria-hidden="true">${arcs}${needle}</svg>`;
}
function colorVarToFlagClass(colorVar) {
  return colorVar.replace("--", "");
}

function statusDotsHTML(statuses) {
  const goodStatuses = ["productive", "peaking", "maintaining"];
  const badStatuses = ["overreaching", "detraining", "unproductive"];
  const recent = statuses.slice(-8);
  if (!recent.length) return "";
  return `<span class="status-dots">${recent.map(s => {
    const cls = goodStatuses.includes(s) ? "good" : badStatuses.includes(s) ? "bad" : "warn";
    return `<span class="status-dot ${cls}" title="${s}"></span>`;
  }).join("")}</span>`;
}

function series(records, field) {
  return records
    .filter(r => r[field] !== undefined && r[field] !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => r[field]);
}

// ---------------------------------------------------------------------
// KPI strip - primary row (race countdown, weekly mileage, block/week) and
// secondary row (the 5 fitness metrics, each with a trend sparkline)
// ---------------------------------------------------------------------
function renderKPIs(plan, history) {
  const primaryEl = document.getElementById("kpi-primary");
  const secondaryEl = document.getElementById("kpi-secondary");
  const t = todayISO();
  const race = plan.athlete.race;
  const daysToRace = daysBetween(t, race.date);

  const currentWeek = findCurrentWeek(plan);
  const pool = buildActivityPool(history);
  const weekActualMi = sumWeekActualMiles(currentWeek, pool);

  const readinessHistory = history.readiness_history || [];
  const loadHistory = history.load_history || [];
  const latestReadiness = readinessHistory
    .filter(r => r.resting_hr !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-1)[0];
  const latestLoad = loadHistory.slice(-1)[0];

  // --- primary row ---
  const primary = [];

  primary.push(`
    <div class="kpi-card">
      <div class="kpi-value">${daysToRace >= 0 ? daysToRace : 0}<small> days</small></div>
      <div class="kpi-label">To ${race.name}</div>
      <span class="kpi-flag good">Goal ${race.goal_time_display} &middot; ${race.goal_pace_per_mi}/mi</span>
    </div>`);

  const pct = currentWeek.target_miles ? Math.round((weekActualMi / currentWeek.target_miles) * 100) : 0;
  primary.push(`
    <div class="kpi-card">
      <div class="kpi-value">${weekActualMi.toFixed(1)}<small> / ${currentWeek.target_miles} mi</small></div>
      <div class="kpi-label">This week's mileage</div>
      <span class="kpi-flag ${pct >= 90 ? "good" : pct >= 50 ? "warn" : "bad"}">${pct}% of target</span>
    </div>`);

  primary.push(`
    <div class="kpi-card">
      <div class="kpi-value">W${currentWeek.week_num}<small> / ${plan.weeks.length}</small></div>
      <div class="kpi-label">${currentWeek.block_label}</div>
      <span class="kpi-flag good">${capitalize(currentWeek.block)} phase</span>
    </div>`);

  primaryEl.innerHTML = primary.join("");

  // --- secondary row: the 5 fitness metrics, each sized equally with a sparkline ---
  const secondary = [];

  // VO2max - speedometer gauge against a general adult-runner range
  const vo2Series = series(loadHistory, "vo2max");
  if (vo2Series.length) {
    const vo2 = vo2Series[vo2Series.length - 1];
    const vo2Bands = [
      { upper: 42, colorVar: "--bad", label: "Below average" },
      { upper: 52, colorVar: "--warn", label: "Average" },
      { upper: 70, colorVar: "--good", label: "Above average" },
    ];
    const vo2Band = bandFor(vo2, vo2Bands, 30);
    secondary.push(`
      <div class="kpi-card kpi-card-gauge">
        <div class="kpi-value">${vo2}</div>
        <div class="kpi-label">VO2 max</div>
        <div class="kpi-gauge">${gaugeSVG(vo2, 30, 70, vo2Bands)}</div>
        <span class="kpi-flag ${colorVarToFlagClass(vo2Band.colorVar)}">${vo2Band.label}</span>
      </div>`);
  }

  // Resting HR
  const rhrSeries = series(readinessHistory, "resting_hr");
  if (rhrSeries.length) {
    secondary.push(`
      <div class="kpi-card">
        <div class="kpi-value">${rhrSeries[rhrSeries.length - 1]}<small> bpm</small></div>
        <div class="kpi-label">Resting HR</div>
        <div class="kpi-foot">
          <span class="kpi-flag good">${fmtDateShort(latestReadiness.date)}</span>
          <span class="kpi-spark">${sparklineSVG(rhrSeries, "--accent")}</span>
        </div>
      </div>`);
  }

  // Lactate threshold - HR from Garmin, pace estimated from the plan's threshold zone.
  // No gauge here per Luke's note - just the HR value, a clean one-line pace range, and a trend.
  const lthrSeries = series(loadHistory, "lthr");
  if (lthrSeries.length) {
    const thresholdZone = (plan.athlete.pace_zones || []).find(z => z.name === "Tempo / Threshold");
    secondary.push(`
      <div class="kpi-card">
        <div class="kpi-value">${lthrSeries[lthrSeries.length - 1]}<small> bpm</small></div>
        <div class="kpi-label">Lactate threshold</div>
        ${thresholdZone ? `<div class="kpi-pace-range">${thresholdZone.pace_per_mi}/mi</div>` : ""}
        <div class="kpi-foot" style="justify-content:flex-end;">
          <span class="kpi-spark">${sparklineSVG(lthrSeries, "--warn")}</span>
        </div>
      </div>`);
  }

  // Load tolerance - ACWR, shown as a gauge against the standard 0.8-1.3 "safe" band
  const acwrSeries = series(loadHistory, "acwr");
  if (acwrSeries.length) {
    const acwr = acwrSeries[acwrSeries.length - 1];
    const acwrBands = [
      { upper: 0.8, colorVar: "--warn", label: "Low" },
      { upper: 1.3, colorVar: "--good", label: "Safe" },
      { upper: 1.5, colorVar: "--warn", label: "Caution" },
      { upper: 2.0, colorVar: "--bad", label: "High risk" },
    ];
    const acwrBand = bandFor(acwr, acwrBands, 0);
    secondary.push(`
      <div class="kpi-card kpi-card-gauge">
        <div class="kpi-value">${acwr}</div>
        <div class="kpi-label">Load tolerance</div>
        <div class="kpi-gauge">${gaugeSVG(acwr, 0, 2.0, acwrBands)}</div>
        <span class="kpi-flag ${colorVarToFlagClass(acwrBand.colorVar)}">${acwrBand.label}</span>
      </div>`);
  }

  // Training status - categorical. Show how long it's been at the current status
  // (resets whenever the status itself changes), not just the date of the latest reading.
  const statusEntries = loadHistory
    .filter(r => r.training_status)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({ date: r.date, status: r.training_status }));
  if (statusEntries.length) {
    const status = statusEntries[statusEntries.length - 1].status;
    let sinceDate = statusEntries[statusEntries.length - 1].date;
    for (let i = statusEntries.length - 1; i >= 0; i--) {
      if (statusEntries[i].status !== status) break;
      sinceDate = statusEntries[i].date;
    }
    const goodStatuses = ["productive", "peaking", "maintaining"];
    const badStatuses = ["overreaching", "detraining", "unproductive"];
    const flagClass = goodStatuses.includes(status) ? "good" : badStatuses.includes(status) ? "bad" : "warn";
    secondary.push(`
      <div class="kpi-card">
        <div class="kpi-value" style="font-size:14px; text-transform:capitalize;">${status}</div>
        <div class="kpi-label">Training status</div>
        <span class="kpi-flag ${flagClass}">Since ${fmtDateShort(sinceDate)}</span>
      </div>`);
  }

  if (!secondary.length) {
    secondary.push(`
      <div class="kpi-card">
        <div class="kpi-value">&mdash;</div>
        <div class="kpi-label">Training readiness</div>
        <span class="kpi-flag warn">No Garmin Coach data yet</span>
      </div>`);
  }

  secondaryEl.innerHTML = secondary.join("");
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

const KIND_LABELS = {
  mp: "Goal pace", shakeout: "Shakeout", race: "Race", recovery: "Recovery",
  easy: "Easy", long: "Long", tempo: "Tempo", intervals: "Intervals",
};

function sessionKindLabel(s) {
  if (s.type === "run") return KIND_LABELS[s.kind] || s.kind;
  return capitalize(s.type);
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

  // Garmin Connect workout file for this session, if one's been generated -
  // matched purely by date (see buildWorkoutsByDate()/state.workoutsByDate).
  let workoutHtml = "";
  if (isRun) {
    const matches = state.workoutsByDate[dateISO];
    if (matches && matches.length) {
      workoutHtml = matches.map(w => `
        <a class="workout-download" href="${w.path}" download title="Download Garmin Connect workout JSON">
          &#8681; Workout file
        </a>`).join("");
    }
  }

  const html = `
    <div class="session">
      ${checkHtml}
      <div class="session-body">
        <div class="session-title-row">
          <span class="session-title">${session.title}</span>
          <span class="session-tag kind-${session.kind || session.type}">${sessionKindLabel(session)}</span>
          ${workoutHtml}
        </div>
        ${metaParts.length ? `<div class="session-meta">${metaParts.join(" &middot; ")}</div>` : ""}
        ${session.details ? `<div class="session-details">${session.details}</div>` : ""}
        ${exerciseHtml}
        ${session.note ? `<div class="session-note">${session.note}</div>` : ""}
        ${actualHtml}
      </div>
    </div>`;

  return { html, done, countsTowardTotal: !isRest };
}

function collapseKey(dateISO) { return `td:collapsed:${dateISO}`; }

function renderWeekDetail(plan, history) {
  const w = state.selectedWeek;
  const el = document.getElementById("week-detail");
  const pool = buildActivityPool(history);
  const t = todayISO();
  const actualMi = sumWeekActualMiles(w, pool);

  const days = w.days.map(day => {
    const isToday = day.date === t;
    const rendered = day.sessions.map(s => renderSession(s, day.date, pool));
    const sessionsHtml = rendered.map(r => r.html).join("");
    const total = rendered.filter(r => r.countsTowardTotal).length;
    const done = rendered.filter(r => r.countsTowardTotal && r.done).length;
    const isCollapsed = localStorage.getItem(collapseKey(day.date)) === "1";
    const summary = total ? `${done}/${total} done` : "";
    return `
      <div class="day-card ${isToday ? "is-today" : ""} ${isCollapsed ? "is-collapsed" : ""}" data-date="${day.date}">
        <div class="day-card-head" data-collapse-toggle="${day.date}">
          <span class="day-name-group">
            <span class="day-chevron">&#9660;</span>
            <span class="day-name">${day.day_name}</span>
          </span>
          <span class="day-date">${summary ? `<span class="day-summary">${summary}</span> &middot; ` : ""}${fmtDateShort(day.date)}${isToday ? " &middot; today" : ""}</span>
        </div>
        <div class="day-grid-inner">${sessionsHtml}</div>
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

  el.querySelectorAll("[data-collapse-toggle]").forEach(node => {
    node.addEventListener("click", () => {
      const key = collapseKey(node.dataset.collapseToggle);
      const isCollapsed = localStorage.getItem(key) === "1";
      if (isCollapsed) { localStorage.removeItem(key); } else { localStorage.setItem(key, "1"); }
      renderWeekDetail(plan, history);
    });
  });

  el.querySelectorAll("[data-toggle-key]").forEach(node => {
    node.addEventListener("click", (e) => {
      e.stopPropagation();
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
    <div class="panel-subheader">
      <div class="panel-kicker">WEEK ${w.week_num} &middot; COACH NOTES</div>
      <h2>${w.focus}</h2>
    </div>
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
    <div class="panel-subheader">
      <div class="panel-kicker">MOST RECENT LOGGED WEEK</div>
      <h2>${fmtDateShort(weekStart.toISOString().slice(0,10))} &ndash; ${fmtDateShort(weekEnd.toISOString().slice(0,10))} retrospective</h2>
    </div>
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
    <div class="panel-subheader">
      <div class="panel-kicker">RACE LOG</div>
      <h2>Results</h2>
    </div>
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
    <tr><td class="strong">${z.name}</td><td>${z.pace_per_mi}</td><td>${z.hr_zone !== null && z.hr_zone !== undefined ? "Zone " + z.hr_zone : "&mdash;"}</td></tr>
  `).join("");
  const context = (a.context || []).map(c => `<li>${c}</li>`).join("");
  el.innerHTML = `
    <div class="panel-subheader">
      <div class="panel-kicker">REFERENCE</div>
      <h2>Pace zones &amp; context</h2>
    </div>
    <table class="simple">
      <thead><tr><th>Zone</th><th>Pace / mi</th><th>HR</th></tr></thead>
      <tbody>${zoneRows}</tbody>
    </table>
    <ul class="exercise-list" style="margin-top:12px;">${context}</ul>
  `;
}

function renderRaceStrategy(plan) {
  const el = document.getElementById("race-strategy-panel");
  const race = plan.athlete.race;
  const strategy = plan.athlete.race_strategy;
  if (!strategy) { el.innerHTML = ""; return; }

  const courseHtml = (race.course || []).map(c => `<li>${c}</li>`).join("");
  const splitRows = (strategy.splits || []).map(s => `
    <tr><td class="strong">${s.segment}</td><td>${s.target}</td><td>${s.note}</td></tr>
  `).join("");

  el.innerHTML = `
    <div class="panel-subheader">
      <div class="panel-kicker">RACE DAY</div>
      <h2>${race.name} strategy</h2>
    </div>
    <ul class="exercise-list">${courseHtml}</ul>
    <table class="simple" style="margin-top:12px;">
      <thead><tr><th>Segment</th><th>Target</th><th>Note</th></tr></thead>
      <tbody>${splitRows}</tbody>
    </table>
    ${strategy.fueling ? `<div class="coach-note-item" style="margin-top:12px;"><span class="coach-note-num">F</span><span>${strategy.fueling}</span></div>` : ""}
    ${strategy.if_behind_pace ? `<div class="coach-note-item"><span class="coach-note-num">?</span><span>${strategy.if_behind_pace}</span></div>` : ""}
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
// Sticky header height sync - the cascading section sub-headers (.panel-subheader,
// .category-subheader, .week-detail-head) stick just below .sticky-header via
// var(--sticky-header-height). Measure the real header and keep it in sync
// whenever its size changes (font load, window resize causing the meta line
// to wrap, etc.) instead of hardcoding a pixel value that would drift.
// ---------------------------------------------------------------------
function watchStickyHeader() {
  const header = document.querySelector(".sticky-header");
  if (!header) return;
  const sync = () => {
    document.documentElement.style.setProperty("--sticky-header-height", `${header.offsetHeight}px`);
  };
  sync();
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(sync).observe(header);
  } else {
    window.addEventListener("resize", sync);
  }
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
  watchStickyHeader();
  try {
    const [plan, history, workoutsManifest] = await Promise.all([
      loadJSON("data/plan.json"),
      loadJSON("data/history.json"),
      loadJSONOptional("data/workouts/index.json"),
    ]);
    state.plan = plan;
    state.history = history;
    state.workoutsByDate = buildWorkoutsByDate(workoutsManifest);
    state.selectedWeek = findCurrentWeek(plan);

    renderHeader(plan);
    renderAll();
    renderRetro(history);
    renderCharts(plan, history);
    renderRaceLog(history);
    renderPaceZones(plan);
    renderRaceStrategy(plan);
  } catch (err) {
    document.getElementById("kpi-primary").innerHTML =
      `<div class="kpi-card"><div class="kpi-label">Error loading dashboard data: ${err.message}</div></div>`;
    console.error(err);
  }
}

init();
