// Lightweight client-side weather lookup for Cambridge, MA, used to show a
// small forecast chip on "this week"'s day cards. Uses Open-Meteo
// (https://open-meteo.com) - free, no API key, CORS-friendly, static-site
// compatible.
//
// Forecasts are only meaningful ~14-16 days out (Open-Meteo caps at 16), so
// most of the 13-week plan will have no data for a given day - that's
// expected, not a bug. window.tdWeather.forDate() returns null for any date
// outside the forecast window, or if the fetch itself fails; callers should
// treat null as "just don't show a chip", never as an error to surface.
window.tdWeather = (function () {
  const LAT = 42.3736;
  const LON = -71.1097;
  const API_URL =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&hourly=temperature_2m,precipitation_probability,relative_humidity_2m` +
    `&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=16`;

  // What time of day to check the forecast for, by day of week (0=Sun..6=Sat) -
  // matches the plan's run schedule (Tue/Wed/Thu/Sat/Sun run, Mon/Fri are
  // PT-only, so there's no run time to check weather for and those days get
  // no chip). Weekday runs are early morning; weekend long runs start later.
  // Open-Meteo only returns whole-hour data, so 6:30am is approximated by
  // averaging the 6:00 and 7:00 readings.
  const DAY_TARGETS = {
    2: { hours: [6, 7], label: "6:30am" }, // Tue
    3: { hours: [6, 7], label: "6:30am" }, // Wed
    4: { hours: [6, 7], label: "6:30am" }, // Thu
    6: { hours: [9], label: "9:00am" },    // Sat
    0: { hours: [9], label: "9:00am" },    // Sun
  };

  let byDateHour = null; // "YYYY-MM-DDTHH:00" -> { tempF, precipPct, humidityPct }
  let loadPromise = null;

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(API_URL)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(data => {
        const map = {};
        const hourly = data.hourly || {};
        const times = hourly.time || [];
        const temps = hourly.temperature_2m || [];
        const precip = hourly.precipitation_probability || [];
        const humidity = hourly.relative_humidity_2m || [];
        times.forEach((t, i) => {
          // t looks like "2026-08-14T17:00" (local time, since &timezone= was set)
          if (typeof temps[i] !== "number") return;
          map[t] = {
            tempF: temps[i],
            precipPct: precip[i] ?? 0,
            humidityPct: humidity[i] ?? 0,
          };
        });
        byDateHour = map;
      })
      .catch(err => {
        // Non-critical enhancement - never let a weather failure show up as
        // a dashboard error. Just means no chips render.
        console.warn("Weather fetch failed (non-critical):", err);
        byDateHour = {};
      });
    return loadPromise;
  }

  function avg(vals) {
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }

  function forDate(dateISO) {
    if (!byDateHour) return null;
    const [y, m, d] = dateISO.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay(); // local date, not UTC-parsed
    const target = DAY_TARGETS[dow];
    if (!target) return null;

    const readings = target.hours
      .map(h => byDateHour[`${dateISO}T${String(h).padStart(2, "0")}:00`])
      .filter(Boolean);
    if (!readings.length) return null;

    return {
      tempF: Math.round(avg(readings.map(r => r.tempF))),
      precipPct: Math.round(avg(readings.map(r => r.precipPct))),
      humidityPct: Math.round(avg(readings.map(r => r.humidityPct))),
      timeLabel: target.label,
    };
  }

  return { load, forDate };
})();
