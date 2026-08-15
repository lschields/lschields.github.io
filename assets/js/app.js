// Training Dashboard front-end.
// Reads data/plan.json (prescribed sessions) and data/history.json (actuals
// from Garmin uploads), renders the dashboard, and matches actual runs to
// planned sessions to compute completion. Everything here is read-only
// against the JSON files - the only "write" behavior is a small localStorage
// toggle for non-running sessions (strength/PT) that Garmin can't verify.

const state = { plan: null, history: null, selectedWeek: null, today: new Date(), workoutsByDate: {} };

// Formats a Date as YYYY-MM-DD using its *local* calendar date, not UTC.
// Date.toISOString() always converts to UTC first, which silently rolls
// over to tomorrow's date in the evening for any timezone behind UTC
// (Cambridge, MA is UTC-4/-5) - that made "today"'s highlight, and any
// "has this day passed" check, use the wrong date for a few hours each
// night. Every date-key computation in this file should go through this,
// not toISOString().
function pad2(n) {
  return String(n).padStart(2, "0");
}
function localISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayISO() {
  return localISO(state.today);
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

// Straight bar gauge - colored range bands (each defined by an upper bound
// + color) filling a slim horizontal bar, with a small triangle marking
// the current reading above it. Replaced the old semicircular "speedometer"
// gauge (arcs + needle) since it took up too much vertical space next to
// the sparkline-based cards beside it.
function bandFor(value, bands, min) {
  let lower = min;
  for (const b of bands) {
    if (value <= b.upper) return b;
    lower = b.upper;
  }
  return bands[bands.length - 1];
}
// Gauge fills use a deeper/more muted variant of each band's semantic color
// (--gauge-good/--gauge-warn/--gauge-bad) than the badge pill that shares
// the same band (--good/--warn/--bad) - a filled bar reads better closer to
// the rest of the deep theme, while the badge needs the brighter tone for
// text-on-pill contrast.
function gaugeToneVar(colorVar) {
  return colorVar.replace("--", "--gauge-");
}
let gaugeIdCounter = 0;
function barGaugeSVG(value, min, max, bands) {
  const clipId = `gauge-clip-${gaugeIdCounter++}`;
  const w = 100, barY = 9, barH = 6;
  let lower = min;
  const segs = bands.map(b => {
    const x1 = ((lower - min) / (max - min)) * w;
    const x2 = ((Math.min(b.upper, max) - min) / (max - min)) * w;
    lower = b.upper;
    return `<rect x="${x1.toFixed(2)}" y="${barY}" width="${Math.max(0, x2 - x1).toFixed(2)}" height="${barH}" fill="var(${gaugeToneVar(b.colorVar)})" />`;
  }).join("");
  const f = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const markerX = Math.min(w - 1, Math.max(1, f * w));
  const triTop = barY - 6;
  return `<svg viewBox="0 0 ${w} ${barY + barH + 2}" class="gauge-svg gauge-bar" preserveAspectRatio="none" aria-hidden="true">
    <defs><clipPath id="${clipId}"><rect x="0" y="${barY}" width="${w}" height="${barH}" rx="3" /></clipPath></defs>
    <rect x="0" y="${barY}" width="${w}" height="${barH}" rx="3" fill="var(--gauge-track)" />
    <g clip-path="url(#${clipId})">${segs}</g>
    <polygon points="${(markerX - 4).toFixed(2)},${triTop} ${(markerX + 4).toFixed(2)},${triTop} ${markerX.toFixed(2)},${barY}" fill="var(--text)" />
  </svg>`;
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
// KPI tooltips - coaching context that reads the *current* numbers, not
// generic definitions. Each render call rebuilds these from whatever's in
// plan.json/history.json right now, so they update automatically as new
// Garmin data comes in - no separate "refresh" step needed.
// ---------------------------------------------------------------------
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
  const latestLoad = loadHistory.slice(-1)[0];
  // Populated by the ACWR card below, read by the training-status card afterward
  // so its tooltip can cross-reference load tolerance when both look shaky.
  let latestAcwrValue = null, latestAcwrLabel = null;

  // --- primary row ---
  const primary = [];

  let raceTip;
  if (daysToRace < 0) raceTip = "Race day has passed - hope it went well!";
  else if (daysToRace <= 7) raceTip = `${daysToRace} day${daysToRace === 1 ? "" : "s"} out - race week. Trust the taper: nothing new, nothing hard.`;
  else if (daysToRace <= 14) raceTip = `${daysToRace} days out - deep taper territory. Volume should already be dropping; don't chase fitness this late.`;
  else if (daysToRace <= 28) raceTip = `${daysToRace} days out. Still time to build, but the taper clock starts soon - keep an eye on the block/week card.`;
  else raceTip = `${daysToRace} days out - plenty of runway left before taper matters.`;
  const raceTt = kpiTooltip(raceTip);
  primary.push(`
    <div class="kpi-card" ${raceTt.attr}>
      ${raceTt.icon}
      <div class="kpi-value">${daysToRace >= 0 ? daysToRace : 0}<small> days</small></div>
      <div class="kpi-label">To ${race.name}</div>
      <span class="kpi-flag good">Goal ${race.goal_time_display} &middot; ${race.goal_pace_per_mi}/mi</span>
    </div>`);

  const pct = currentWeek.target_miles ? Math.round((weekActualMi / currentWeek.target_miles) * 100) : 0;
  const daysLeftInWeek = Math.max(0, daysBetween(t, currentWeek.end_date));
  let mileageTip;
  if (pct >= 90) mileageTip = `${weekActualMi.toFixed(1)} of ${currentWeek.target_miles}mi logged (${pct}%) - right on track for the week.`;
  else if (pct >= 50) mileageTip = `${weekActualMi.toFixed(1)} of ${currentWeek.target_miles}mi logged (${pct}%), with ${daysLeftInWeek} day${daysLeftInWeek === 1 ? "" : "s"} left in the week to close the gap.`;
  else mileageTip = `Only ${weekActualMi.toFixed(1)} of ${currentWeek.target_miles}mi logged (${pct}%) with ${daysLeftInWeek} day${daysLeftInWeek === 1 ? "" : "s"} left - worth a look at what's getting in the way.`;
  const mileageTt = kpiTooltip(mileageTip);
  primary.push(`
    <div class="kpi-card" ${mileageTt.attr}>
      ${mileageTt.icon}
      <div class="kpi-value">${weekActualMi.toFixed(1)}<small> / ${currentWeek.target_miles} mi</small></div>
      <div class="kpi-label">This week's mileage</div>
      <span class="kpi-flag ${pct >= 90 ? "good" : pct >= 50 ? "warn" : "bad"}">${pct}% of target</span>
    </div>`);

  const PHASE_NOTES = {
    rebuild: "building back safely - volume and consistency matter more than speed right now.",
    base: "building the aerobic engine everything else gets layered on top of.",
    build: "speed work is layering in - hard days should feel hard, easy days easy.",
    peak: "the highest load of the cycle - dial in race-pace feel and prioritize recovery.",
    taper: "volume is dropping on purpose - trust it, don't chase fitness this late.",
  };
  const blockTip = `Week ${currentWeek.week_num} of ${plan.weeks.length}, ${currentWeek.block} phase: ${PHASE_NOTES[currentWeek.block] || ""}`;
  const blockTt = kpiTooltip(blockTip);
  primary.push(`
    <div class="kpi-card" ${blockTt.attr}>
      ${blockTt.icon}
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
    const vo2Prev = vo2Series.length > 1 ? vo2Series[vo2Series.length - 2] : null;
    let vo2Trend = "";
    if (vo2Prev !== null && vo2 > vo2Prev) vo2Trend = ` Up from ${vo2Prev} last reading - trending the right direction.`;
    else if (vo2Prev !== null && vo2 < vo2Prev) vo2Trend = ` Down from ${vo2Prev} last reading - not unusual on a single reading, watch the trend rather than react to one drop.`;
    else if (vo2Prev !== null) vo2Trend = ` Steady at ${vo2Prev} on the last reading.`;
    const vo2Tip = `Currently ${vo2} (${vo2Band.label.toLowerCase()}).${vo2Trend} This is Garmin's estimate of your aerobic ceiling, not a guarantee you're racing at it yet.`;
    const vo2Tt = kpiTooltip(vo2Tip);
    secondary.push(`
      <div class="kpi-card kpi-card-gauge" ${vo2Tt.attr}>
        ${vo2Tt.icon}
        <div class="kpi-value">${vo2}</div>
        <div class="kpi-label">VO2 max</div>
        <div class="kpi-gauge">${barGaugeSVG(vo2, 30, 70, vo2Bands)}</div>
        <span class="kpi-flag ${colorVarToFlagClass(vo2Band.colorVar)}">${vo2Band.label}</span>
      </div>`);
  }

  // Resting HR
  const rhrSeries = series(readinessHistory, "resting_hr");
  if (rhrSeries.length) {
    const rhrLatest = rhrSeries[rhrSeries.length - 1];
    const rhrPriorReadings = rhrSeries.slice(0, -1);
    const rhrBaseline = rhrPriorReadings.length
      ? rhrPriorReadings.reduce((a, b) => a + b, 0) / rhrPriorReadings.length : null;
    let rhrTip;
    if (rhrBaseline !== null) {
      const diff = rhrLatest - rhrBaseline;
      if (diff >= 3) rhrTip = `${rhrLatest} bpm - about ${Math.round(diff)} bpm above your recent average of ${rhrBaseline.toFixed(0)}. Elevated for 2+ days in a row is worth an easy day.`;
      else if (diff <= -2) rhrTip = `${rhrLatest} bpm - below your recent average of ${rhrBaseline.toFixed(0)}, a good sign of recovery.`;
      else rhrTip = `${rhrLatest} bpm - in line with your recent average of ${rhrBaseline.toFixed(0)}.`;
    } else {
      rhrTip = `${rhrLatest} bpm. Resting heart rate is one of the earliest signals of fatigue or illness - watch the trend as more readings come in.`;
    }
    const rhrTt = kpiTooltip(rhrTip);
    secondary.push(`
      <div class="kpi-card kpi-card-spark" ${rhrTt.attr}>
        ${rhrTt.icon}
        <div class="kpi-card-main">
          <div class="kpi-value">${rhrLatest}<small> bpm</small></div>
          <div class="kpi-label">Resting HR</div>
        </div>
        <span class="kpi-spark">${sparklineSVG(rhrSeries, "--accent")}</span>
      </div>`);
  }

  // Lactate threshold - HR from Garmin, pace estimated from the plan's threshold zone.
  // No gauge here per Luke's note - just the HR value, a clean one-line pace range, and a trend.
  const lthrSeries = series(loadHistory, "lthr");
  if (lthrSeries.length) {
    const thresholdZone = (plan.athlete.pace_zones || []).find(z => z.name === "Tempo / Threshold");
    const lthrLatest = lthrSeries[lthrSeries.length - 1];
    const lthrPrev = lthrSeries.length > 1 ? lthrSeries[lthrSeries.length - 2] : null;
    let lthrTip;
    if (lthrPrev !== null && lthrPrev !== lthrLatest) {
      const dir = lthrLatest > lthrPrev ? "up" : "down";
      lthrTip = `${lthrLatest} bpm, ${dir} from ${lthrPrev} last reading. This pace anchors your tempo/threshold sessions - watch how it pairs with pace at that effort over time, not the bpm number alone.`;
    } else {
      lthrTip = `${lthrLatest} bpm, holding steady. This pace anchors your tempo/threshold sessions.`;
    }
    const lthrTt = kpiTooltip(lthrTip);
    secondary.push(`
      <div class="kpi-card kpi-card-spark" ${lthrTt.attr}>
        ${lthrTt.icon}
        <div class="kpi-card-main">
          <div class="kpi-value">${lthrLatest}<small> bpm</small></div>
          <div class="kpi-label">Lactate threshold</div>
          ${thresholdZone ? `<div class="kpi-pace-range">${thresholdZone.pace_per_mi}/mi</div>` : ""}
        </div>
        <span class="kpi-spark">${sparklineSVG(lthrSeries, "--warn")}</span>
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
    latestAcwrValue = acwr;
    latestAcwrLabel = acwrBand.label;
    const ACWR_ACTIONS = {
      "Low": "lower than ideal - there's room to safely add volume.",
      "Safe": "right in the 0.8-1.3 sweet spot - the current ramp rate is sustainable.",
      "Caution": "climbing into the caution zone - keep an eye on how the next few days feel before adding more.",
      "High risk": "above 1.5 - the clearest 'ease up' signal on this whole dashboard. Worth trimming volume this week.",
    };
    const acwrTip = `${acwr} - ${ACWR_ACTIONS[acwrBand.label] || ""}`;
    const acwrTt = kpiTooltip(acwrTip);
    secondary.push(`
      <div class="kpi-card kpi-card-gauge" ${acwrTt.attr}>
        ${acwrTt.icon}
        <div class="kpi-value">${acwr}</div>
        <div class="kpi-label">Load tolerance</div>
        <div class="kpi-gauge">${barGaugeSVG(acwr, 0, 2.0, acwrBands)}</div>
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
    const STATUS_ACTIONS = {
      productive: "training is building fitness effectively - stay the course.",
      peaking: "you're at your fitness peak - exactly where you want to be heading into a key block.",
      maintaining: "holding steady - fine during a cutback or taper, worth building again once volume returns.",
      overreaching: "pushing hard - fine short-term, but pair with easy days and sleep or it tips into a hole.",
      detraining: "load has dropped off - expected during taper, worth a look anywhere else in the plan.",
      unproductive: "recent training isn't converting into fitness gains yet - common right after a layoff or illness, keep at HR-based volume before adding intensity.",
    };
    let statusTip = `${capitalize(status)} since ${fmtDateShort(sinceDate)} - ${STATUS_ACTIONS[status] || ""}`;
    if (badStatuses.includes(status) && (latestAcwrLabel === "Caution" || latestAcwrLabel === "High risk")) {
      statusTip += ` Combined with a load-tolerance reading of ${latestAcwrValue} (${latestAcwrLabel.toLowerCase()}), this is worth taking seriously - an easier week would help.`;
    }
    const statusTt = kpiTooltip(statusTip);
    secondary.push(`
      <div class="kpi-card" ${statusTt.attr}>
        ${statusTt.icon}
        <div class="kpi-value kpi-value-status">${status}</div>
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
// Week nav - prev/next arrows stepping one week at a time, replacing the
// old horizontally-scrolling strip of all 13 week tabs.
// ---------------------------------------------------------------------
function renderWeekNav(plan) {
  const el = document.getElementById("week-nav");
  const w = state.selectedWeek;
  const t = todayISO();
  const isCurrent = t >= w.start_date && t <= w.end_date;
  const idx = plan.weeks.findIndex(x => x.week_num === w.week_num);
  const hasPrev = idx > 0;
  const hasNext = idx < plan.weeks.length - 1;
  const atCurrentWeek = isCurrent;

  el.innerHTML = `
    <div class="week-nav-controls">
      <button type="button" class="week-nav-arrow" id="week-nav-prev" ${hasPrev ? "" : "disabled"} aria-label="Previous week">&#8249;</button>
      <div class="week-nav-current">
        <span class="wn-num">Week ${w.week_num} of ${plan.weeks.length}${isCurrent ? `<span class="wn-current-badge">current</span>` : ""}</span>
        <span class="wn-label">${capitalize(w.block)} &middot; ${fmtDateShort(w.start_date)}&ndash;${fmtDateShort(w.end_date)}</span>
      </div>
      <button type="button" class="week-nav-arrow" id="week-nav-next" ${hasNext ? "" : "disabled"} aria-label="Next week">&#8250;</button>
    </div>
    ${!atCurrentWeek ? `<button type="button" class="week-nav-today" id="week-nav-today">Today</button>` : ""}
  `;

  if (hasPrev) {
    document.getElementById("week-nav-prev").addEventListener("click", () => {
      state.selectedWeek = plan.weeks[idx - 1];
      renderAll();
    });
  }
  if (hasNext) {
    document.getElementById("week-nav-next").addEventListener("click", () => {
      state.selectedWeek = plan.weeks[idx + 1];
      renderAll();
    });
  }
  if (!atCurrentWeek) {
    document.getElementById("week-nav-today").addEventListener("click", () => {
      state.selectedWeek = findCurrentWeek(plan);
      renderAll();
    });
  }
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
      // Self-reported state now lives in Firebase (window.tdAuth), not
      // localStorage, so a check on one device shows up on every device.
      const key = localKey(dateISO, session.title);
      done = window.tdAuth.isCheckedIn(key);
      checkClass = done ? "done checkable" : "checkable";
    }
  } else if (session.type === "strength" || session.type === "core" || session.type === "pt") {
    const key = localKey(dateISO, session.title);
    done = window.tdAuth.isCheckedIn(key);
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

// Small forecast chip for a day-card-head, sourced from window.tdWeather
// (assets/js/weather.js). Returns "" when there's no data for this date -
// either the weather fetch hasn't resolved yet, failed, or the date is
// outside Open-Meteo's ~14-16 day forecast window (true for most of the
// 13-week plan; only "this week" and the near future will ever show a chip).
function weatherChipHTML(dateISO) {
  const w = window.tdWeather && window.tdWeather.forDate(dateISO);
  if (!w) return "";
  return `<span class="day-weather" title="${w.timeLabel} forecast">${w.tempF}&deg;F, ${w.precipPct}%, H: ${w.humidityPct}%</span>`;
}

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
          ${weatherChipHTML(day.date)}
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
      const isDone = window.tdAuth.isCheckedIn(key);
      window.tdAuth.setCheckin(key, !isDone);
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
      <h2>${fmtDateShort(localISO(weekStart))} &ndash; ${fmtDateShort(localISO(weekEnd))} retrospective</h2>
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

// Reads a live value from the page's CSS custom properties (theme colors),
// so chart colors always match the current dark/dark-maroon or light theme
// instead of being hardcoded to one. Re-read on every renderCharts() call
// (including the re-render triggered by a theme switch - see
// initThemeToggle()) rather than cached, since the value changes at runtime.
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// "#rrggbb" -> "rgba(r,g,b,alpha)", for bar fills / area tints where a solid
// theme color would be too heavy at 100% opacity.
function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Chart.js instances currently on screen, keyed by canvas id - tracked so
// renderCharts() can destroy and recreate them cleanly (Chart.js throws if
// you construct a new Chart on a canvas that already has one attached).
// Re-rendering happens both on initial load and whenever the theme toggles,
// so colors picked up via cssVar() above stay in sync with dark/light mode.
const chartInstances = {};
function makeChart(canvasId, config) {
  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  chartInstances[canvasId] = new Chart(canvas, config);
}

// Renders the small colored-dot + label row above a chart (replaces
// Chart.js's built-in legend, which ate into the plot area and looked
// cramped on a wide, short chart). `items` is [{ label, color }, ...].
function renderChartLegend(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.map(item => `
    <span class="chart-legend-item">
      <span class="chart-legend-dot" style="background:${item.color}"></span>${item.label}
    </span>`).join("");
}

function renderCharts(plan, history) {
  // Chart.js loads from a CDN via a <script> tag - if that request is slow,
  // blocked (ad/tracker blockers sometimes flag third-party CDN domains),
  // or briefly down, `Chart` won't be defined yet. Rather than throw (which
  // used to take out everything rendered after this point - see
  // renderSafely() in init()), show a plain message in each chart panel so
  // the rest of the page is unaffected.
  if (typeof Chart === "undefined") {
    document.querySelectorAll(".chart-panel canvas").forEach(canvas => {
      const msg = document.createElement("p");
      msg.className = "panel-sub";
      msg.style.margin = "0";
      msg.textContent = "Charts library didn't load - try refreshing the page.";
      canvas.replaceWith(msg);
    });
    return;
  }

  const accent = cssVar("--accent");
  const good = cssVar("--good");
  const warn = cssVar("--warn");
  const bad = cssVar("--bad");

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

  renderChartLegend("chart-mileage-legend", [
    { label: "Planned", color: hexToRgba(accent, 0.45) },
    { label: "Actual", color: good },
  ]);
  makeChart("chart-mileage", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Planned", data: planned, backgroundColor: hexToRgba(accent, 0.3), borderRadius: 3 },
        { label: "Actual", data: actual, backgroundColor: hexToRgba(good, 0.75), borderRadius: 3 },
      ],
    },
    options: chartOptions({ suffix: " mi" }),
  });

  const readiness = (history.readiness_history || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  renderChartLegend("chart-hrv-legend", [
    { label: "HRV", color: accent },
    { label: "Resting HR", color: warn },
  ]);
  makeChart("chart-hrv", {
    type: "line",
    data: {
      labels: readiness.map(r => fmtDateShort(r.date)),
      datasets: [
        { label: "HRV", data: readiness.map(r => r.hrv ?? r.hrv_last_night_avg ?? null),
          borderColor: accent, backgroundColor: "transparent", tension: 0.3, spanGaps: true,
          pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
        { label: "Resting HR", data: readiness.map(r => r.resting_hr ?? null),
          borderColor: warn, backgroundColor: "transparent", tension: 0.3, spanGaps: true, yAxisID: "y1",
          pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
      ],
    },
    options: dualAxisChartOptions({ suffix: " ms" }, { suffix: " bpm" }),
  });

  const load = (history.load_history || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  renderChartLegend("chart-load-legend", [
    { label: "ATL (fatigue)", color: bad },
    { label: "CTL (fitness)", color: accent },
    { label: "ACWR", color: warn },
  ]);
  makeChart("chart-load", {
    type: "line",
    data: {
      labels: load.map(l => fmtDateShort(l.date)),
      datasets: [
        { label: "ATL (fatigue)", data: load.map(l => l.atl ?? null), borderColor: bad, tension: 0.3,
          pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
        { label: "CTL (fitness)", data: load.map(l => l.ctl ?? null), borderColor: accent, tension: 0.3,
          pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
        { label: "ACWR", data: load.map(l => l.acwr ?? null), borderColor: warn, tension: 0.3, yAxisID: "y1",
          pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
      ],
    },
    options: dualAxisChartOptions({}, {}),
  });
}

// `yFormat`/`y1Format` optionally add a unit suffix to axis tick labels
// (e.g. " mi", " bpm") - makes the axes self-explanatory without needing the
// legend to spell out units. `beginAtZero` defaults on (right for a mileage
// bar chart, where 0 is a meaningful floor) but line charts of physiological
// trends (HRV/RHR, ATL/CTL/ACWR) turn it off - those values live in a narrow
// band far from zero, and forcing a 0 baseline would flatten the very
// variation this redesign is trying to make more visible.
function chartOptions(yFormat, beginAtZero = true) {
  const gridColor = hexToRgba(cssVar("--border"), 0.6);
  const tickColor = cssVar("--text-dim");
  const tooltipBg = cssVar("--panel");
  const tooltipBorder = cssVar("--border");
  const tooltipText = cssVar("--text");
  const tooltipDim = cssVar("--text-dim");

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: tooltipBg,
        titleColor: tooltipText,
        bodyColor: tooltipDim,
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
        boxPadding: 4,
      },
    },
    scales: {
      x: {
        ticks: { color: tickColor, font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
        grid: { display: false },
      },
      y: {
        beginAtZero,
        grace: "10%",
        ticks: {
          color: tickColor,
          font: { size: 11 },
          maxTicksLimit: 6,
          callback: v => yFormat?.suffix ? `${v}${yFormat.suffix}` : v,
        },
        grid: { color: gridColor },
      },
    },
  };
}

function dualAxisChartOptions(yFormat, y1Format) {
  // Line charts of physiological/load trends - narrow-band data, so no
  // forced 0 baseline (see chartOptions() comment above).
  const base = chartOptions(yFormat, false);
  const tickColor = cssVar("--text-dim");
  base.scales.y1 = {
    position: "right",
    beginAtZero: false,
    grace: "10%",
    ticks: {
      color: tickColor,
      font: { size: 11 },
      maxTicksLimit: 6,
      callback: v => y1Format?.suffix ? `${v}${y1Format.suffix}` : v,
    },
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
  const header = `
    <div class="panel-subheader">
      <div class="panel-kicker">RACE LOG</div>
      <h2>Results</h2>
    </div>`;
  if (!races.length) {
    el.innerHTML = `${header}<p class="panel-sub" style="margin:0;">No races logged yet.</p>`;
    return;
  }
  const rows = races.map(r => `
    <tr>
      <td>${r.date ? fmtDateShort(r.date) : (r.date_note || "?")}</td>
      <td class="strong">${r.name}</td>
      <td>${r.distance_mi.toFixed(2)} mi</td>
      <td>${r.time_display}</td>
      <td>${r.notes || ""}</td>
    </tr>`).join("");
  el.innerHTML = `
    ${header}
    <table class="simple">
      <thead><tr><th>Date</th><th>Race</th><th>Distance</th><th>Time</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderPaceZones(plan) {
  const el = document.getElementById("pace-zones-panel");
  const a = plan.athlete;
  const header = `
    <div class="panel-subheader">
      <div class="panel-kicker">REFERENCE</div>
      <h2>Pace zones &amp; context</h2>
    </div>`;
  const zones = a.pace_zones || [];
  if (!zones.length) {
    el.innerHTML = `${header}<p class="panel-sub" style="margin:0;">No pace zones defined yet.</p>`;
    return;
  }
  const zoneRows = zones.map(z => `
    <tr><td class="strong">${z.name}</td><td>${z.pace_per_mi}</td><td>${z.hr_zone !== null && z.hr_zone !== undefined ? "Zone " + z.hr_zone : "&mdash;"}</td></tr>
  `).join("");
  const context = (a.context || []).map(c => `<li>${c}</li>`).join("");
  el.innerHTML = `
    ${header}
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
  const header = `
    <div class="panel-subheader">
      <div class="panel-kicker">RACE DAY</div>
      <h2>${race.name} strategy</h2>
    </div>`;
  if (!strategy) {
    el.innerHTML = `${header}<p class="panel-sub" style="margin:0;">Race day strategy hasn't been added yet.</p>`;
    return;
  }

  const courseHtml = (race.course || []).map(c => `<li>${c}</li>`).join("");
  const splitRows = (strategy.splits || []).map(s => `
    <tr><td class="strong">${s.segment}</td><td>${s.target}</td><td>${s.note}</td></tr>
  `).join("");

  el.innerHTML = `
    ${header}
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
    // Chart colors are pulled from CSS custom properties (see cssVar() in
    // the charts section) rather than hardcoded, so they need a re-render
    // to actually pick up the new theme's palette - just flipping the
    // data-theme attribute doesn't repaint an already-drawn canvas. No-op
    // if charts haven't loaded yet (typeof Chart check inside renderCharts).
    if (state.plan && state.history && typeof Chart !== "undefined") {
      renderCharts(state.plan, state.history);
    }
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
  renderWeekNav(state.plan);
  renderWeekDetail(state.plan, state.history);
  renderCoachNotes();
}

// Runs fn() and swallows any error, logging it instead of letting it
// propagate. Used so that one section failing to render can't take down
// every section after it in init(), and can't clobber sections that
// already rendered successfully - each panel is responsible for its own
// failure, not the whole page. (Charts have their own async handling below
// rather than using this - see the chartReady block in init().)
function renderSafely(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`Failed to render ${label}:`, err);
  }
}

async function init() {
  await window.tdAuth.requireAuth();
  window.tdAuth.initSignOut();
  initThemeToggle();
  watchStickyHeader();
  initKPITooltips();

  // Only a failure here (the actual data the whole page depends on) is
  // serious enough to replace the KPI strip with an error message - nothing
  // else has rendered yet at this point, so there's nothing to preserve.
  let plan, history, workoutsManifest;
  try {
    [plan, history, workoutsManifest] = await Promise.all([
      loadJSON("data/plan.json"),
      loadJSON("data/history.json"),
      loadJSONOptional("data/workouts/index.json"),
    ]);
  } catch (err) {
    document.getElementById("kpi-primary").innerHTML =
      `<div class="kpi-card"><div class="kpi-label">Error loading dashboard data: ${err.message}</div></div>`;
    console.error(err);
    return;
  }

  state.plan = plan;
  state.history = history;
  state.workoutsByDate = buildWorkoutsByDate(workoutsManifest);
  state.selectedWeek = findCurrentWeek(plan);

  // Wait for the first snapshot of checkbox-completion data before the
  // first render (avoids a flash of "unchecked" then flicker to
  // "checked"); after that, re-render automatically whenever the data
  // changes - including from another device.
  await window.tdAuth.watchCheckins(() => renderAll());

  renderHeader(plan);
  renderAll();
  // From here on, each section renders independently - a problem in one
  // (e.g. the Chart.js CDN script failing to load) shows up only in that
  // section, not as a blank page or a wiped-out KPI strip.
  renderSafely("retro panel", () => renderRetro(history));
  renderSafely("race log", () => renderRaceLog(history));
  renderSafely("pace zones", () => renderPaceZones(plan));
  renderSafely("race strategy", () => renderRaceStrategy(plan));

  // Chart.js is vendored locally (assets/js/vendor/chart.umd.js, loaded as a
  // normal blocking <script> before this one) rather than fetched from a
  // CDN, so it's synchronously available by the time this line runs -
  // window.chartReady no longer exists. Still wrapped defensively in case
  // that ever changes back; renderCharts() itself checks
  // typeof Chart === "undefined" and shows a "didn't load" message if not.
  (async () => {
    try {
      if (window.chartReady) await window.chartReady;
      renderCharts(plan, history);
    } catch (err) {
      console.error("Failed to render charts:", err);
    }
  })();

  // Weather chips (assets/js/weather.js) - same fire-and-forget pattern as
  // charts above: never block the rest of the page on a third-party fetch.
  // Re-renders just the week-detail panel once data resolves (or fails,
  // which is also a no-op - weatherChipHTML() just returns "" then).
  if (window.tdWeather) {
    window.tdWeather.load().then(() => {
      renderSafely("week detail (weather)", () => renderWeekDetail(state.plan, state.history));
    });
  }
}

if (window.tdAuth) init();
else window.addEventListener("tdAuthReady", init, { once: true });
