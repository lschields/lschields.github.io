#!/usr/bin/env python3
"""
build_workouts_manifest.py

Scans data/workouts/**/*.json (the Garmin Connect workout files produced by
scripts/build_garmin_workouts.py) and writes data/workouts/index.json - a
flat manifest the static dashboard can fetch() to know which dates have a
downloadable workout file available, without needing a server-side directory
listing (GitHub Pages can't do that).

Run this any time new workout files are added or removed, then commit
data/workouts/index.json alongside them:

    python3 scripts/build_workouts_manifest.py

This is intentionally decoupled from build_garmin_workouts.py - it just reads
whatever *.json files exist under data/workouts/, so it doesn't care which
script or session produced them, or from which chat.
"""
import json
import re
import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKOUTS_ROOT = ROOT / "data" / "workouts"
OUT = WORKOUTS_ROOT / "index.json"

DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})")


def main():
    entries = []
    if WORKOUTS_ROOT.exists():
        for path in sorted(WORKOUTS_ROOT.glob("*/*.json")):
            m = DATE_RE.match(path.name)
            if not m:
                continue  # not a dated workout file (e.g. a stray non-conforming json)
            date = m.group(1)
            try:
                data = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                continue
            entries.append({
                "date": date,
                "week": path.parent.name,
                "filename": path.name,
                "path": f"data/workouts/{path.parent.name}/{path.name}",
                "workout_name": data.get("workoutName", path.stem),
            })

    entries.sort(key=lambda e: (e["date"], e["filename"]))

    manifest = {
        "generated_at": dt.datetime.utcnow().isoformat() + "Z",
        "workouts": entries,
    }
    OUT.write_text(json.dumps(manifest, indent=2))
    print(f"Wrote {OUT.relative_to(ROOT)} - {len(entries)} workout file(s) indexed "
          f"across {len(set(e['week'] for e in entries))} week folder(s)")


if __name__ == "__main__":
    main()
