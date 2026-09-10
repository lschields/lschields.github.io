// Background service worker: receives captured entries from relay.js and
// stores the latest response per endpoint URL in chrome.storage.local.
// Data persists across browser sessions until you hit "Clear" in the popup,
// so you can capture over several visits before exporting once a week.

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return undefined;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "GARMIN_EXPORT_CAPTURED") return;
  const entry = msg.entry;
  if (!entry || !entry.url) return;

  const parsed = tryParseJson(entry.body);

  chrome.storage.local.get({ captures: {} }, ({ captures }) => {
    captures[entry.url] = {
      url: entry.url,
      status: entry.status,
      capturedAt: entry.capturedAt,
      data: parsed,
      raw: parsed === undefined ? entry.body : undefined,
    };
    chrome.storage.local.set({ captures });
  });
});
