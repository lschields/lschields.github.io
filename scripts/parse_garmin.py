#!/usr/bin/env python3
"""
parse_garmin.py

Weekly ingestion script. Feed it your new Garmin exports and it updates
data/history.json - the dashboard reads that file to compute actuals,
completion checkmarks, and the charts at the bottom of the page.

Usage:
    python3 scripts/parse_garmin.py path/to/activity1.fit path/to/activity2.fit path/to/garmin-coach-export.json

Accepts, in any combination:
  - .fit activity files (exported per-activity from Garmin Connect: Activity > ... > Export Original)
  - Garmin Coach/health data exports (.json, in the shape produced for this project - see
    data/raw/ for an example)

It is safe to re-run: activities are de-duplicated by (date, distance), and
readiness/load entries are de-duplicated by date (newer export wins).

This script only computes objective numbers (pace, mileage, HR, load, trend).
It does NOT rewrite the plan - that's a judgment call made in a Claude chat
session using this data plus how you say you're feeling, then saved via
scripts/build_plan.py.
"""
import json
import sys
import shutil
import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HISTORY_PATH = ROOT / "data" / "history.json"
RAW_DIR = ROOT / "data" / "raw"


def load_history():
    if HISTORY_PATH.exists():
        return json.loads(HISTORY_PATH.read_text())
    return {
        "generated_at": None,
        "athlete_snapshot": {},
        "readiness_history": [],
        "load_history": [],
        "activities": [],
        "races": [],
    }


def save_history(history):
    history["generated_at"] = dt.datetime.utcnow().isoformat() + "Z"
    history["readiness_history"].sort(key=lambda r: r["date"])
    history["load_history"].sort(key=lambda r: r["date"])
    history["activities"].sort(key=lambda a: a["date"])
    HISTORY_PATH.write_text(json.dumps(history, indent=2))


def fmt_pace(seconds_per_mile):
    m = int(seconds_per_mile // 60)
    s = int(round(seconds_per_mile % 60))
    if s == 60:
        m += 1
        s = 0
    return f"{m}:{s:02d}"


def parse_fit(path: Path):
    import fitparse  # pip install fitparse --break-system-packages
    f = fitparse.FitFile(str(path))
    session = None
    for rec in f.get_messages("session"):
        session = {d.name: d.value for d in rec}
        break
    if session is None:
        print(f"  ! no session message found in {path.name}, skipping")
        return None

    total_distance_m = session.get("total_distance") or 0
    total_time_s = session.get("total_timer_time") or session.get("total_elapsed_time") or 0
    distance_mi = total_distance_m / 1609.34 if total_distance_m else 0
    duration_sec = total_time_s

    pace_sec_per_mi = (duration_sec / distance_mi) if distance_mi > 0 else None
    start_time = session.get("start_time")
    date = start_time.date().isoformat() if isinstance(start_time, (dt.datetime, dt.date)) else None

    cadence = session.get("avg_running_cadence")
    activity = {
        "source_file": path.name,
        "date": date,
        "start_time": start_time.isoformat() if isinstance(start_time, (dt.datetime, dt.date)) else None,
        "sport": session.get("sport"),
        "distance_mi": round(distance_mi, 2),
        "duration_sec": round(duration_sec, 1),
        "avg_pace_per_mi": fmt_pace(pace_sec_per_mi) if pace_sec_per_mi else None,
        "avg_pace_sec_per_mi": round(pace_sec_per_mi, 1) if pace_sec_per_mi else None,
        "avg_hr": session.get("avg_heart_rate"),
        "max_hr": session.get("max_heart_rate"),
        "avg_power": session.get("avg_power"),
        "avg_cadence_spm": cadence * 2 if cadence else None,
        "avg_vertical_oscillation_mm": session.get("avg_vertical_oscillation"),
        "avg_stance_time_ms": session.get("avg_stance_time"),
        "avg_stance_time_balance_pct": session.get("avg_stance_time_balance"),
        "total_ascent_m": session.get("total_ascent"),
        "total_calories": session.get("total_calories"),
        "total_training_effect": session.get("total_training_effect"),
    }
    return activity


def parse_coach_json(path: Path):
    data = json.loads(path.read_text())
    exported_at = data.get("exported_at", "")
    date = exported_at[:10] if exported_at else dt.date.today().isoformat()

    readiness = data.get("readiness", {})
    load = data.get("load", {})
    athlete = data.get("athlete", {})

    readiness_entry = {"date": date, **readiness}
    # Fold a few athlete-level fitness metrics into the dated load entry too, not just
    # the always-overwritten athlete_snapshot - this is what lets the dashboard draw
    # sparklines for VO2max/lactate threshold over time instead of a single flat value.
    load_entry = {
        "date": date,
        **load,
        "vo2max": athlete.get("vo2max"),
        "lthr": athlete.get("lthr"),
        "weight_kg": athlete.get("weight_kg"),
    }

    trend_entries = []
    for point in data.get("trends", {}).get("hrv_7d", []):
        trend_entries.append(("hrv", point["date"], point["hrv"]))
    for point in data.get("trends", {}).get("resting_hr_7d", []):
        trend_entries.append(("resting_hr", point["date"], point["resting_hr"]))

    return athlete, readiness_entry, load_entry, trend_entries


def upsert_by_date(records, new_record):
    for i, r in enumerate(records):
        if r["date"] == new_record["date"]:
            records[i] = new_record
            return
    records.append(new_record)


def upsert_activity(activities, new_activity):
    if not new_activity:
        return False
    for a in activities:
        if a["date"] == new_activity["date"] and abs((a["distance_mi"] or 0) - (new_activity["distance_mi"] or 0)) < 0.15:
            a.update(new_activity)
            return True
    activities.append(new_activity)
    return True


def week_folder(date_str):
    """Monday-of-week folder name (YYYY-MM-DD) for a given ISO date string.

    Weeks run Monday-Sunday, matching the START_MONDAY convention in
    scripts/build_plan.py. Falls back to "unsorted" if no date is known.
    """
    if not date_str:
        return "unsorted"
    try:
        d = dt.date.fromisoformat(date_str[:10])
    except ValueError:
        return "unsorted"
    monday = d - dt.timedelta(days=d.weekday())
    return monday.isoformat()


def archive_raw(path: Path, date_str=None):
    week_dir = RAW_DIR / week_folder(date_str)
    week_dir.mkdir(parents=True, exist_ok=True)
    dest = week_dir / path.name
    if not dest.exists():
        try:
            shutil.copy2(path, dest)
        except Exception:
            pass


def main(argv):
    if not argv:
        print(__doc__)
        return 1

    history = load_history()

    for arg in argv:
        path = Path(arg)
        if not path.exists():
            print(f"  ! not found: {path}")
            continue

        if path.suffix.lower() == ".fit":
            print(f"Parsing FIT activity: {path.name}")
            activity = parse_fit(path)
            if activity:
                added = upsert_activity(history["activities"], activity)
                print(f"  -> {activity['date']}  {activity['distance_mi']}mi  "
                      f"{activity['avg_pace_per_mi']}/mi  HR {activity['avg_hr']}  "
                      f"({'updated' if not added else 'added'})")
            archive_raw(path, activity["date"] if activity else None)

        elif path.suffix.lower() == ".json":
            print(f"Parsing coach/health export: {path.name}")
            athlete, readiness_entry, load_entry, trends = parse_coach_json(path)
            if athlete:
                history["athlete_snapshot"] = athlete
            upsert_by_date(history["readiness_history"], readiness_entry)
            upsert_by_date(history["load_history"], load_entry)

            # Fold the 7-day HRV/RHR trend points in as lightweight daily entries too,
            # so the chart has more than one dot even between weekly uploads.
            for metric, tdate, value in trends:
                existing = next((r for r in history["readiness_history"] if r["date"] == tdate), None)
                if existing:
                    existing.setdefault(metric, value)
                else:
                    history["readiness_history"].append({"date": tdate, metric: value})

            print(f"  -> readiness/load snapshot for {readiness_entry['date']}, "
                  f"{len(trends)} trend points folded in")
            archive_raw(path, readiness_entry["date"])

        else:
            print(f"  ! unrecognized file type, skipping: {path.name}")

    save_history(history)
    print(f"\nSaved {HISTORY_PATH}")
    print(f"  activities: {len(history['activities'])}")
    print(f"  readiness entries: {len(history['readiness_history'])}")
    print(f"  load entries: {len(history['load_history'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
