// Runs in the isolated content-script world (has chrome.* access, unlike capture.js).
// Just forwards what capture.js observed to the background service worker for storage.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || !data.__garminExportCapture || !data.entry) return;
  try {
    chrome.runtime.sendMessage({ type: "GARMIN_EXPORT_CAPTURED", entry: data.entry });
  } catch (e) {
    /* extension context may be reloading; drop this one silently */
  }
});
