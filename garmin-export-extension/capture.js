// Runs in the MAIN world (the page's own JS context), injected at document_start.
// Garmin Connect's API (gc-api/*) rejects requests that don't come from its own
// bundled fetch/XHR wrappers (confirmed: replaying the exact same URL with the
// same cookies from outside that wrapper gets a 403). So instead of trying to
// call the API ourselves, we watch the *real* requests Garmin's own page code
// makes and copy the responses as they fly by. This only sees traffic for
// whatever pages you actually visit - see popup.html for the list of pages to
// click through each time you want a full export.
(function () {
  const WHITELIST = [
    // Original set
    /\/gc-api\/biometric-service\/heartRateZones/i,
    /\/gc-api\/wellness-service\/wellness\/dailyHeartRate/i,
    /\/gc-api\/wellness-service\/wellness\/dailySleepData/i,
    /\/gc-api\/usersummary-service\/usersummary\/daily\//i,
    /\/gc-api\/metrics-service\/metrics\/maxmet\/latest/i,
    /\/gc-api\/metrics-service\/metrics\/trainingloadbalance\/latest/i,
    /\/gc-api\/metrics-service\/metrics\/trainingstatus\/daily/i,
    /\/gc-api\/metrics-service\/metrics\/heataltitudeacclimation\/latest/i,
    /\/gc-api\/hrv-service\/hrv\//i,
    /\/gc-api\/userprofile-service\/userprofile\/personal-information/i,
    /\/gc-api\/userprofile-service\/userprofile\/user-settings/i,
    // Added for: weight, health status, respiration, fitness age, stress,
    // body battery, race predictor, running economy, training effect,
    // running tolerance, running lactate threshold, endurance score, hill
    // score, HRV stress - all confirmed live via Health Stats / Performance
    // Stats pages. Calories and training status were already covered above
    // (usersummary/daily and trainingstatus/daily respectively).
    /\/gc-api\/weight-service\/weight\//i,
    /\/gc-api\/healthstatus-service\/healthstatus\/summary/i,
    /\/gc-api\/wellness-service\/wellness\/daily\/respiration/i,
    /\/gc-api\/fitnessage-service\/fitnessage/i,
    /\/gc-api\/wellness-service\/wellness\/dailyStress/i,
    /\/gc-api\/wellness-service\/wellness\/bodyBattery\/events/i,
    /\/gc-api\/metrics-service\/metrics\/racepredictions\/latest/i,
    /\/gc-api\/metrics-service\/metrics\/runningeconomy\/latest/i,
    /\/gc-api\/fitnessstats-service\/activity\/all/i,
    /\/gc-api\/metrics-service\/metrics\/runningtolerance\/stats/i,
    /\/gc-api\/biometric-service\/biometric\/latestLactateThreshold/i,
    /\/gc-api\/biometric-service\/biometric\/powerToWeight\/latest/i,
    /\/gc-api\/metrics-service\/metrics\/endurancescore/i,
    /\/gc-api\/metrics-service\/metrics\/hillscore/i,
    /\/gc-api\/metrics-service\/internal\/manualstresslevel\/daily/i,
    // Bonus: richer range-based sleep stats seen alongside Health Status,
    // in addition to the single-day dailySleepData above.
    /\/gc-api\/sleep-service\/stats\/sleep\/daily/i,
    // Readiness Score AND Recovery Time both come from this one response -
    // the Training Readiness page shows Recovery Time as one of the listed
    // "Factors" alongside Sleep Score/HRV/Acute Load, with no separate
    // network call of its own (confirmed: no request URL containing
    // "recovery" fires on that page - it's a field inside this JSON body).
    /\/gc-api\/metrics-service\/metrics\/trainingreadiness\//i,
  ];

  function isWanted(url) {
    return typeof url === "string" && WHITELIST.some((re) => re.test(url));
  }

  // Garmin's own code sometimes calls fetch()/XHR with a path relative to the
  // page (e.g. "/gc-api/...") instead of a full URL. Resolve to absolute
  // before storing, so the same endpoint always lands under one export key
  // instead of splitting into a relative-path entry and an absolute one.
  function toAbsoluteUrl(url) {
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return url;
    }
  }

  function emit(entry) {
    window.postMessage({ __garminExportCapture: true, entry }, "*");
  }

  // --- fetch() ---
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (...args) {
      const promise = origFetch.apply(this, args);
      try {
        const input = args[0];
        const url = typeof input === "string" ? input : input && input.url;
        if (isWanted(url)) {
          promise
            .then((res) => {
              res
                .clone()
                .text()
                .then((body) => {
                  emit({
                    url: toAbsoluteUrl(url),
                    status: res.status,
                    capturedAt: new Date().toISOString(),
                    body,
                  });
                })
                .catch(() => {});
            })
            .catch(() => {});
        }
      } catch (e) {
        /* never break the page */
      }
      return promise;
    };
  }

  // --- XMLHttpRequest ---
  const OrigOpen = XMLHttpRequest.prototype.open;
  const OrigSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__garminExportUrl = url;
    return OrigOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("loadend", () => {
      try {
        const url = this.__garminExportUrl;
        if (isWanted(url) && typeof this.responseText === "string") {
          emit({
            url: toAbsoluteUrl(url),
            status: this.status,
            capturedAt: new Date().toISOString(),
            body: this.responseText,
          });
        }
      } catch (e) {
        /* never break the page */
      }
    });
    return OrigSend.apply(this, args);
  };
})();
