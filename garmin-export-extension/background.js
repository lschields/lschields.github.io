// Background service worker: receives captured entries from relay.js and
// stores the latest response per endpoint URL in chrome.storage.local.
// Data persists across browser sessions until you hit "Clear" in the panel,
// so you can capture over several visits before exporting once a week.

// Clicking the toolbar icon opens the side panel instead of a popup - unlike
// a popup, the side panel stays docked in the window and doesn't close when
// you click into the page, so it can stay open while you browse Garmin
// Connect and update live as each row gets captured.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("sidePanel setPanelBehavior failed:", error));

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
