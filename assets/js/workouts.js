// Workout Files repository page.
// Reads data/workouts/index.json (built by scripts/build_workouts_manifest.py)
// and lists every generated Garmin Connect workout file, grouped by week
// folder, with an individual download link per file plus a "download this
// week as .zip" button (via JSZip, loaded from cdnjs) for batch grabbing a
// week's files in one go.

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

async function loadJSONOptional(path) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function weekLabel(weekFolder) {
  const m = /week_(\d+)/.exec(weekFolder);
  return m ? `Week ${Number(m[1])}` : weekFolder;
}

function groupByWeek(workouts) {
  const groups = {};
  for (const w of workouts) {
    (groups[w.week] = groups[w.week] || []).push(w);
  }
  return Object.keys(groups).sort().map(week => ({
    week,
    label: weekLabel(week),
    files: groups[week].slice().sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

async function downloadZip(files, zipName, triggerEl) {
  if (typeof JSZip === "undefined") {
    alert("Zip library failed to load - try downloading files individually instead.");
    return;
  }
  const originalText = triggerEl.textContent;
  triggerEl.textContent = "Zipping...";
  triggerEl.disabled = true;
  try {
    const zip = new JSZip();
    await Promise.all(files.map(async f => {
      const res = await fetch(f.path);
      if (!res.ok) throw new Error(`Failed to fetch ${f.path}`);
      const text = await res.text();
      zip.file(f.filename, text);
    }));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    console.error(err);
    alert(`Couldn't build the zip: ${err.message}`);
  } finally {
    triggerEl.textContent = originalText;
    triggerEl.disabled = false;
  }
}

function fmtDateShort(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function renderWeeks(manifest) {
  const el = document.getElementById("workout-weeks");
  const workouts = (manifest && manifest.workouts) || [];

  if (!workouts.length) {
    el.innerHTML = `
      <div class="panel-subheader">
        <div class="panel-kicker">REPOSITORY</div>
        <h2>No workout files yet</h2>
      </div>
      <p class="panel-sub">Once workout files are generated for an upcoming week, they'll show up here
      individually and as a batch .zip download.</p>`;
    return;
  }

  const groups = groupByWeek(workouts);

  el.innerHTML = groups.map(g => `
    <div class="workout-week-group">
      <div class="panel-subheader workout-week-head">
        <div class="panel-kicker">${g.label.toUpperCase()}</div>
        <h2>${g.files.length} workout file${g.files.length === 1 ? "" : "s"}</h2>
        <button type="button" class="btn-zip" data-week="${g.week}">Download week as .zip</button>
      </div>
      <div class="workout-file-list">
        ${g.files.map(f => `
          <a class="workout-file-row" href="${f.path}" download>
            <span class="workout-file-date">${fmtDateShort(f.date)}</span>
            <span class="workout-file-name">${f.workout_name}</span>
            <span class="workout-file-dl">&#8681; Download</span>
          </a>`).join("")}
      </div>
    </div>`).join("");

  el.querySelectorAll(".btn-zip").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = groups.find(g => g.week === btn.dataset.week);
      if (group) downloadZip(group.files, `${group.week}_workouts.zip`, btn);
    });
  });

  if (groups.length > 1) {
    const allBtn = document.createElement("div");
    allBtn.className = "workout-download-all";
    allBtn.innerHTML = `<button type="button" class="btn-zip btn-zip-all">Download all ${workouts.length} files as .zip</button>`;
    el.prepend(allBtn);
    allBtn.querySelector("button").addEventListener("click", (e) => {
      downloadZip(workouts, "all_workouts.zip", e.target);
    });
  }
}

async function init() {
  initThemeToggle();
  watchStickyHeader();
  try {
    const manifest = await loadJSONOptional("data/workouts/index.json");
    renderWeeks(manifest);
  } catch (err) {
    document.getElementById("workout-weeks").innerHTML =
      `<div class="panel-kicker">ERROR</div><h2>Couldn't load workout files: ${err.message}</h2>`;
    console.error(err);
  }
}

init();
