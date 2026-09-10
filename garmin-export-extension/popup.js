const KNOWN = [
  {
    match: /heartRateZones/i,
    label: "Heart Rate Zones",
    hint: "Health Stats → Heart Rate",
  },
  {
    match: /dailyHeartRate/i,
    label: "Daily Heart Rate",
    hint: "Health Stats → Heart Rate",
  },
  {
    match: /dailySleepData/i,
    label: "Sleep",
    hint: "Health Stats → Sleep",
  },
  {
    match: /usersummary\/daily\//i,
    label: "Daily Summary",
    hint: "any dashboard page",
  },
  {
    match: /wellnessactivity\/activity\/summary/i,
    label: "Wellness Activity Summary",
    hint: "Home dashboard",
  },
  {
    match: /maxmet\/latest/i,
    label: "VO2 Max",
    hint: "Performance Stats → VO2 Max",
  },
  {
    match: /trainingloadbalance\/latest/i,
    label: "Training Load (ATL / CTL / ACWR)",
    hint: "Performance Stats → Training Status",
  },
  {
    match: /trainingstatus\/daily/i,
    label: "Training Status",
    hint: "Performance Stats → Training Status",
  },
  {
    match: /heataltitudeacclimation\/latest/i,
    label: "Heat / Altitude Acclimation",
    hint: "Performance Stats → Training Status",
  },
  {
    match: /hrv-service\/hrv\//i,
    label: "HRV Status",
    hint: "Performance Stats → HRV Status",
  },
  {
    match: /personal-information/i,
    label: "Personal Info",
    hint: "Settings → User Settings",
  },
  {
    match: /userprofile\/user-settings/i,
    label: "User Settings",
    hint: "Settings → User Settings",
  },
];

function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

async function loadCaptures() {
  const { captures } = await chrome.storage.local.get({ captures: {} });
  return captures;
}

function render(captures) {
  const urls = Object.keys(captures);
  const list = document.getElementById("list");
  list.innerHTML = "";

  KNOWN.forEach((k) => {
    const foundUrl = urls.find((u) => k.match.test(u));
    const li = document.createElement("li");
    li.className = foundUrl ? "got" : "missing";
    const sub = foundUrl ? "captured " + timeAgo(captures[foundUrl].capturedAt) : "visit: " + k.hint;
    li.innerHTML =
      '<span class="dot"></span><div><div class="label">' +
      k.label +
      '</div><div class="hint">' +
      sub +
      "</div></div>";
    list.appendChild(li);
  });

  const countEl = document.getElementById("count");
  countEl.textContent = urls.length + " response" + (urls.length === 1 ? "" : "s") + " captured total";

  document.getElementById("exportBtn").disabled = urls.length === 0;
}

async function refresh() {
  render(await loadCaptures());
}

document.getElementById("exportBtn").addEventListener("click", async () => {
  const captures = await loadCaptures();
  const payload = {
    exported_at: new Date().toISOString(),
    source: "garmin-connect-browser-capture-extension",
    extension_version: chrome.runtime.getManifest().version,
    captures: Object.values(captures),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = "garmin-export-" + stamp + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ captures: {} });
  refresh();
});

refresh();
// Popup stays open only while you're looking at it, so also refresh if storage
// changes while it's open (e.g. you click a link in the same tab behind it).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.captures) refresh();
});
