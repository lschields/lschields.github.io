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
  const TARGET_HOUR = 17; // 5pm local - roughly a typical after-work/after-school run time
  const API_URL =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&hourly=temperature_2m,precipitation_probability,relative_humidity_2m` +
    `&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=16`;

  let byDate = null; // dateISO -> { tempF, precipPct, humidityPct }, filled once the fetch resolves
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
          const [datePart, timePart] = t.split("T");
          if (parseInt(timePart, 10) !== TARGET_HOUR) return;
          if (typeof temps[i] !== "number") return;
          map[datePart] = {
            tempF: Math.round(temps[i]),
            precipPct: Math.round(precip[i] ?? 0),
            humidityPct: Math.round(humidity[i] ?? 0),
          };
        });
        byDate = map;
      })
      .catch(err => {
        // Non-critical enhancement - never let a weather failure show up as
        // a dashboard error. Just means no chips render.
        console.warn("Weather fetch failed (non-critical):", err);
        byDate = {};
      });
    return loadPromise;
  }

  function forDate(dateISO) {
    return byDate ? byDate[dateISO] || null : null;
  }

  return { load, forDate };
})();
