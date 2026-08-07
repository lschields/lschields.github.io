// PT & Prehab Reference page.
// Reads the exercise_library / exercise_categories arrays out of data/plan.json
// (same file the dashboard uses) and renders one card per exercise, grouped by
// category. Read-only, no localStorage, no completion tracking - this page is
// just "how do I do this movement," not a workout log.

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

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function exerciseCardHTML(ex) {
  return `
    <div class="exercise-card">
      <div class="exercise-card-head">
        <span class="exercise-card-name">${ex.name}</span>
        <span class="exercise-card-prescription">${ex.prescription}</span>
      </div>
      ${ex.how_to ? `<div class="exercise-card-howto">${ex.how_to}</div>` : ""}
      <div class="exercise-card-foot">
        ${ex.equipment ? `<span class="exercise-card-equipment">&#9881; ${ex.equipment}</span>` : ""}
      </div>
      ${ex.cue ? `<div class="exercise-card-cue">${ex.cue}</div>` : ""}
    </div>`;
}

function renderExerciseLibrary(plan) {
  const el = document.getElementById("exercise-categories");
  const categories = plan.exercise_categories || [];
  const library = plan.exercise_library || [];

  if (!library.length) {
    el.innerHTML = `<div class="panel-kicker">REFERENCE</div><h2>No exercise library found</h2>`;
    return;
  }

  el.innerHTML = categories.map(cat => {
    const items = library.filter(e => e.category === cat.id);
    if (!items.length) return "";
    return `
      <div class="exercise-category">
        <div class="panel-kicker">${cat.label.toUpperCase()}</div>
        <div class="exercise-grid">${items.map(exerciseCardHTML).join("")}</div>
      </div>`;
  }).join("");
}

async function init() {
  initThemeToggle();
  try {
    const plan = await loadJSON("data/plan.json");
    renderExerciseLibrary(plan);
  } catch (err) {
    document.getElementById("exercise-categories").innerHTML =
      `<div class="panel-kicker">ERROR</div><h2>Couldn't load exercise library: ${err.message}</h2>`;
    console.error(err);
  }
}

init();
