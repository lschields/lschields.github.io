# Garmin Running Data Exporter (Chrome extension)

A small personal Chrome extension that replaces the third-party Garmin add-in.
It doesn't call Garmin's API itself (Garmin blocks requests that don't come
from its own page code - confirmed directly). Instead it watches the real
API responses Garmin Connect's website loads while you browse it normally,
and lets you export everything it's seen as one JSON file.

Because it's reading exactly what your browser and Garmin's own JS exchange,
sport-specific data (like running vs. cycling heart rate zones) comes through
correctly - there's no guessing which activity type an endpoint means.

## Install (one-time)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (toggle, top right).
3. Click **Load unpacked**.
4. Select this `garmin-export-extension` folder.
5. Pin it (puzzle-piece icon in the toolbar → pin "Garmin Running Data Exporter") so it's
   easy to click each week.

Chrome will occasionally nag that "this extension is not from the Chrome Web Store" -
that's expected for a personal/unpacked extension and can be ignored.

## Weekly use

1. Log into [connect.garmin.com](https://connect.garmin.com) as usual.
2. Click the extension icon and check which rows are already green (captured this session
   carries over until you clear it, so you may already have some from earlier in the week).
3. For anything still grey, visit the page listed next to it in the left nav
   (Health Stats → Heart Rate, Performance Stats → Training Status, etc.) - just loading
   the page is enough, nothing to click beyond that.
4. Once everything you want is green, click **Export JSON**. It downloads to your normal
   Downloads folder as `garmin-export-YYYY-MM-DD.json`.
5. Upload that file (alongside your `.fit` activity files, same as before) to the Claude
   chat that maintains the dashboard.
6. Click **Clear captured data** if you want to start clean for next time - not required,
   exporting doesn't clear anything automatically.

## What it captures

Whatever loads while you're on these pages:

| Page (Garmin Connect left nav)              | What it captures                          |
|-----------------------------------------------|--------------------------------------------|
| Health Stats → Heart Rate                     | Heart rate zones (sport-specific), daily HR |
| Health Stats → Sleep                          | Sleep data                                  |
| Performance Stats → Training Status           | Training status, training load balance      |
| Performance Stats → VO2 Max                   | VO2 max                                     |
| Performance Stats → HRV Status                | HRV                                         |
| Settings → User Settings                      | Personal info (weight, gender, activity class) |
| Any dashboard/home page                       | Daily summary, wellness activity summary    |

## Output shape

```json
{
  "exported_at": "2026-09-09T21:40:00.000Z",
  "source": "garmin-connect-browser-capture-extension",
  "extension_version": "0.1.0",
  "captures": [
    {
      "url": "https://connect.garmin.com/gc-api/biometric-service/heartRateZones/",
      "status": 200,
      "capturedAt": "2026-09-09T21:38:12.000Z",
      "data": { "...": "parsed JSON body, whatever Garmin actually returned" }
    }
  ]
}
```

This is deliberately a *raw* capture - `data` is exactly what Garmin's API returned, not
reshaped into the dashboard's `history.json` format. That reshaping (mapping
`heartRateZones` into running-specific zones, folding VO2max/training load into the
athlete snapshot, etc.) happens in the Claude chat once we've seen a real export and know
the actual field names Garmin uses - endpoint URLs were confirmed by watching network
traffic, but response bodies couldn't be inspected in advance since the API refuses
unauthenticated-looking requests, including ours.

## Privacy

Everything stays local: `chrome.storage.local` on this machine, cleared whenever you click
Clear. Nothing is sent to any server other than Garmin's own (which your browser was
already talking to). The exported file only goes wherever you choose to upload it.
