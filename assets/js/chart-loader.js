// Loads Chart.js from multiple CDNs in sequence, falling back to the next
// one if a source fails or takes too long. Chart.js was previously loaded
// from a single cdnjs <script> tag; when that request was slow, blocked, or
// briefly down, `Chart` stayed undefined and every chart panel showed a
// "didn't load, refresh" message (app.js/trends.js already handle that
// gracefully - see renderCharts()/renderWeeklyChart() - this file exists to
// make that fallback message need to show up less often in the first
// place). This script defines window.chartReady, a promise that resolves
// to true once Chart is available (from whichever source worked first) or
// false if every source failed/timed out. app.js and trends.js await it
// before calling into Chart.js, without blocking the rest of the page -
// this script starts loading immediately (it's placed early in <body>), so
// by the time renderCharts() is actually reached later in each page's
// init() sequence, there's usually already an answer either way.
window.chartReady = (function () {
  const SOURCES = [
    "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js",
    "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js",
    "https://unpkg.com/chart.js@4.4.4/dist/chart.umd.min.js",
  ];
  const TIMEOUT_MS = 6000;

  function loadOne(src) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => finish(true);
      el.onerror = () => finish(false);
      setTimeout(() => finish(false), TIMEOUT_MS);
      document.head.appendChild(el);
    });
  }

  return (async () => {
    for (const src of SOURCES) {
      if (await loadOne(src)) return true;
    }
    return false;
  })();
})();
