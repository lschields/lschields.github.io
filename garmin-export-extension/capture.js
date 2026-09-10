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
    /\/gc-api\/biometric-service\/heartRateZones/i,
    /\/gc-api\/wellness-service\/wellness\/dailyHeartRate/i,
    /\/gc-api\/wellness-service\/wellness\/dailySleepData/i,
    /\/gc-api\/usersummary-service\/usersummary\/daily\//i,
    /\/gc-api\/wellnessactivity-service\/activity\/summary/i,
    /\/gc-api\/metrics-service\/metrics\/maxmet\/latest/i,
    /\/gc-api\/metrics-service\/metrics\/trainingloadbalance\/latest/i,
    /\/gc-api\/metrics-service\/metrics\/trainingstatus\/daily/i,
    /\/gc-api\/metrics-service\/metrics\/heataltitudeacclimation\/latest/i,
    /\/gc-api\/hrv-service\/hrv\//i,
    /\/gc-api\/userprofile-service\/userprofile\/personal-information/i,
    /\/gc-api\/userprofile-service\/userprofile\/user-settings/i,
  ];

  function isWanted(url) {
    return typeof url === "string" && WHITELIST.some((re) => re.test(url));
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
                    url,
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
            url,
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
