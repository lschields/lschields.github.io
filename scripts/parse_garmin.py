#!/usr/bin/env python3
"""
parse_garmin.py

Weekly ingestion script. Feed it your new Garmin exports and it updates
data/history.json - the dashboard reads that file to compute actuals,
completion checkmarks, and the charts at the bottom of the page.

Usage:
    python3 scripts/parse_garmin.py path/to/activity1.fit path/to/activity2.fit path/to/garmin-coach-export.json
    python3 scripts/parse_garmin.py --race "Cambridge Half Marathon 2025" path/to/race.fit

Accepts, in any combination:
  - .fit activity files (exported per-activity from Garmin Connect: Activity > ... > Export Original)
  - Garmin health/readiness data exports (.json), in either of two shapes:
      * the original simplified coach-export format ({"athlete": ..., "readiness": ...,
        "load": ..., "trends": ...}) - see data/raw/ for an example. Superseded 2026-09-11
        but still parsed for backfilling/re-running old files.
      * the garmin-connect-browser-capture-extension format (source field identifies it) -
        a raw capture of Garmin Connect's own internal API responses
        ({"captures": [{url, data, status, capturedAt}, ...]}). This is the current
        going-forward export format as of 2026-09-12; see parse_extension_json() below.
  - --race "Name" immediately before a .fit file marks that activity as a race: it gets
    race:true + title on the activities entry (matches Grandma's Marathon's existing shape)
    and upserts a matching data/history.json "races" summary entry (time, distance, HR).
    Re-running is safe - matched by (date, name) and existing notes/date_note are preserved
    unless you explicitly overwrite them afterward.

It is safe to re-run: activities are de-duplicated by (date, distance), and
readiness/load entries are de-duplicated by date and merged rather than
replaced - a newer export wins on any field both formats provide, but a
field only one format carries (e.g. training-readiness score, which the
old format had and the new extension format doesn't) is preserved rather
than dropped if that date already has an entry.

This script only computes objective numbers (pace, mileage, HR, load, trend).
It does NOT rewrite the plan - that's a judgment call made in a Claude chat
session using this data plus how you say you're feeling, then saved via
scripts/build_plan.py.
"""
import json
import re
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
        "race_predictions": [],
    }


def save_history(history):
    history["generated_at"] = dt.datetime.utcnow().isoformat() + "Z"
    history["readiness_history"].sort(key=lambda r: r["date"])
    history["load_history"].sort(key=lambda r: r["date"])
    history["activities"].sort(key=lambda a: a["date"])
    history.setdefault("race_predictions", []).sort(key=lambda r: r["date"])
    HISTORY_PATH.write_text(json.dumps(history, indent=2))


def fmt_pace(seconds_per_mile):
    m = int(seconds_per_mile // 60)
    s = int(round(seconds_per_mile % 60))
    if s == 60:
        m += 1
        s = 0
    return f"{m}:{s:02d}"


# fitparse's bundled sport-code table doesn't cover every value Garmin has
# introduced (newer non-running activity types in particular) - when it
# can't resolve one, session.get("sport") comes back as a raw int instead of
# a string. Left as-is, that raw int reaches history.json and crashes the
# dashboard's capitalize(a.sport) call in renderRetro() if that activity is
# ever the most recently logged one (found 2026-08-15 via activity
# 24016477933_ACTIVITY.fit, 2026-08-17 - a Garmin mobility/stretch session,
# confirmed by Luke). A couple of known overrides, then a safe generic
# fallback so no future unmapped code can do the same thing.
SPORT_NAME_OVERRIDES = {
    86: "mobility",
}


def resolve_sport(raw_sport):
    if isinstance(raw_sport, str):
        return raw_sport
    if isinstance(raw_sport, int) and raw_sport in SPORT_NAME_OVERRIDES:
        return SPORT_NAME_OVERRIDES[raw_sport]
    return "activity"


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
        "sport": resolve_sport(session.get("sport")),
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


def _strip_query(url):
    return url.split("?", 1)[0]


def _captures_matching(captures, pattern):
    """Data payloads (status 200 only) for captures whose URL - query string
    stripped, since the extension cache-busts some endpoints with a random
    `_=<timestamp>` param - matches the given regex, in original order."""
    rx = re.compile(pattern)
    return [c["data"] for c in captures
            if c.get("status") == 200 and rx.search(_strip_query(c.get("url", "")))]


def _capture_one(captures, pattern):
    matches = _captures_matching(captures, pattern)
    return matches[0] if matches else None


def parse_extension_json(data):
    """Parse a garmin-connect-browser-capture-extension export.

    This format (identified by data["source"]) is a raw dump of ~40-50 Garmin
    Connect internal API responses captured by Luke's browser extension -
    data["captures"] = [{url, data, status, capturedAt}, ...] - structurally
    nothing like the simplified coach-export JSON parse_coach_json() expects.
    Before this function existed, feeding one of these into parse_coach_json()
    silently produced a garbage all-null entry (hit on 2026-09-10/09-11,
    fixed by hand at the time - see project memory). This is the real parser,
    built 2026-09-12 once Luke settled on this extension as the permanent
    going-forward weekly export, replacing the old simplified coach export.

    Each metric below is pulled from whichever specific internal endpoint
    actually carries it (they're spread across ~10 different Garmin
    services) rather than treating the capture list generically.

    Two known, permanent gaps versus the old format: no training-readiness
    score/level and no recovery-time-hours - the extension doesn't currently
    capture the endpoint(s) those come from. Left out rather than faked;
    worth flagging if a future decision leans on either one.
    """
    captures = data.get("captures", [])

    usersummary = _capture_one(captures, r"usersummary-service/usersummary/daily/[^/]+$")
    hrv_daily = _capture_one(captures, r"hrv-service/hrv/daily/\d{4}-\d{2}-\d{2}/\d{4}-\d{2}-\d{2}$")
    sleep_stats = _capture_one(captures, r"sleep-service/stats/sleep/daily/\d{4}-\d{2}-\d{2}/\d{4}-\d{2}-\d{2}$")
    training_status = _capture_one(captures, r"trainingstatus/daily/\d{4}-\d{2}-\d{2}$")
    training_load_balance = _capture_one(captures, r"trainingloadbalance/latest/\d{4}-\d{2}-\d{2}$")
    running_tolerance = _capture_one(captures, r"runningtolerance/stats$")
    race_predictions = _capture_one(captures, r"racepredictions/latest/[a-f0-9-]+$")
    heart_rate_zones = _capture_one(captures, r"biometric-service/heartRateZones/$")

    # The extension hits personal-information several times with different
    # cache-busting query params; one specific call requests
    # includeBiometric=false and comes back with biometricProfile: null.
    # Query-stripping collapses all of these to the same URL, so pick the
    # first one that actually has a populated biometricProfile rather than
    # trusting capture order.
    personal_info = next(
        (c for c in _captures_matching(captures, r"personal-information/[a-f0-9-]+$")
         if c.get("biometricProfile")),
        None,
    )

    # Target date: prefer an actual Garmin calendarDate over exported_at (a
    # UTC timestamp of when the extension ran, which rolls to the next day
    # for an evening US run - confirmed happening on the 2026-09-12 export).
    date = None
    for source in (usersummary, training_status, race_predictions):
        if source and source.get("calendarDate"):
            date = source["calendarDate"]
            break
    if not date:
        date = (data.get("exported_at") or "")[:10] or dt.date.today().isoformat()

    # --- athlete_snapshot patch (merged onto the existing snapshot by the
    # caller, not a full replace - see merge_athlete_snapshot()) ---
    running_zones = next((z for z in (heart_rate_zones or []) if z.get("sport") == "RUNNING"), None)
    athlete = {}
    if personal_info and personal_info.get("biometricProfile"):
        bio = personal_info["biometricProfile"]
        athlete["vo2max"] = bio.get("vo2Max")
        athlete["lthr"] = bio.get("lactateThresholdHeartRate")
        athlete["weight_kg"] = round(bio["weight"] / 1000, 1) if bio.get("weight") else None
    if running_zones:
        # This is the permanent fix for the "athlete_snapshot.zones.hr is
        # actually cycling data" bug (see project memory, root-caused
        # 2026-09-03) - pulled straight from Garmin's own sport-tagged zone
        # table instead of the ambiguous/wrong field the old export used.
        athlete["lthr"] = running_zones.get("lactateThresholdHeartRateUsed", athlete.get("lthr"))
        athlete["max_hr"] = running_zones.get("maxHeartRateUsed")
        athlete["zones"] = {"hr": [
            {"zone": i + 1, "floor_bpm": running_zones.get(f"zone{i + 1}Floor")}
            for i in range(5)
        ]}
    athlete = {k: v for k, v in athlete.items() if v is not None}

    # --- readiness_history entry ---
    readiness_entry = {"date": date}
    if usersummary:
        readiness_entry.update({
            "resting_hr": usersummary.get("restingHeartRate"),
            "resting_hr_7day_avg": usersummary.get("lastSevenDaysAvgRestingHeartRate"),
            "body_battery_high": usersummary.get("bodyBatteryHighestValue"),
            "avg_stress_level": usersummary.get("averageStressLevel"),
            "avg_waking_respiration": usersummary.get("avgWakingRespirationValue"),
        })
    if hrv_daily and hrv_daily.get("hrvSummaries"):
        today_hrv = next((s for s in hrv_daily["hrvSummaries"] if s.get("calendarDate") == date),
                          hrv_daily["hrvSummaries"][-1])
        readiness_entry.update({
            "hrv_status": today_hrv.get("status"),
            "hrv_last_night_avg": today_hrv.get("lastNightAvg"),
            "hrv_7day_avg": today_hrv.get("weeklyAvg"),
        })
    if sleep_stats and sleep_stats.get("individualStats"):
        today_sleep = next((s for s in sleep_stats["individualStats"] if s.get("calendarDate") == date), None)
        if today_sleep:
            v = today_sleep.get("values", {})
            total_s = v.get("totalSleepTimeInSeconds") or 0

            def sleep_pct(key):
                return round(100 * v[key] / total_s, 1) if total_s and v.get(key) is not None else None

            readiness_entry.update({
                "sleep_score": v.get("sleepScore"),
                "sleep_total_hours": round(total_s / 3600, 1) if total_s else None,
                "sleep_deep_pct": sleep_pct("deepTime"),
                "sleep_rem_pct": sleep_pct("remTime"),
                "sleep_light_pct": sleep_pct("lightTime"),
            })
    readiness_entry = {k: v for k, v in readiness_entry.items() if v is not None}

    # --- load_history entry ---
    load_entry = {"date": date}
    if training_status and training_status.get("latestTrainingStatusData"):
        device_data = next(iter(training_status["latestTrainingStatusData"].values()))
        acute = device_data.get("acuteTrainingLoadDTO", {})
        phrase = device_data.get("trainingStatusFeedbackPhrase") or ""
        load_entry.update({
            "atl": acute.get("dailyTrainingLoadAcute"),
            "ctl": acute.get("dailyTrainingLoadChronic"),
            "acwr": acute.get("dailyAcuteChronicWorkloadRatio"),
            "acwr_status": acute.get("acwrStatus"),
            "training_status_detail": phrase or None,
            # "PRODUCTIVE_3" -> "productive", so the dashboard's plain-word
            # training-status log line matches what the old export produced.
            "training_status": re.sub(r"_\d+$", "", phrase).lower() or None,
        })
    if running_tolerance:
        rt = running_tolerance[0] if isinstance(running_tolerance, list) else running_tolerance
        load_entry.update({
            "running_tolerance_feedback": rt.get("runningToleranceFeedBackPhrase"),
            "acute_impact_load": rt.get("acuteImpactLoad"),
            "acute_tolerance": rt.get("acuteTolerance"),
        })
    if training_load_balance and training_load_balance.get("metricsTrainingLoadBalanceDTOMap"):
        tlb = next(iter(training_load_balance["metricsTrainingLoadBalanceDTOMap"].values()))
        load_entry.update({
            "monthly_load_aerobic_high": tlb.get("monthlyLoadAerobicHigh"),
            "monthly_load_aerobic_low": tlb.get("monthlyLoadAerobicLow"),
            "monthly_load_anaerobic": tlb.get("monthlyLoadAnaerobic"),
            "training_balance_feedback": tlb.get("trainingBalanceFeedbackPhrase"),
        })
    load_entry.update({
        "vo2max": athlete.get("vo2max"),
        "lthr": athlete.get("lthr"),
        "weight_kg": athlete.get("weight_kg"),
    })
    load_entry = {k: v for k, v in load_entry.items() if v is not None}

    # --- race prediction entry - new, the old format never had this ---
    race_prediction_entry = None
    if race_predictions:
        def pace_per_mi(sec, miles):
            return fmt_pace(sec / miles) if sec else None

        race_prediction_entry = {
            "date": date,
            "time_5k_sec": race_predictions.get("time5K"),
            "time_10k_sec": race_predictions.get("time10K"),
            "time_half_sec": race_predictions.get("timeHalfMarathon"),
            "time_marathon_sec": race_predictions.get("timeMarathon"),
            "pace_5k_per_mi": pace_per_mi(race_predictions.get("time5K"), 3.10686),
            "pace_10k_per_mi": pace_per_mi(race_predictions.get("time10K"), 6.21371),
            "pace_half_per_mi": pace_per_mi(race_predictions.get("timeHalfMarathon"), 13.10938),
        }
        race_prediction_entry = {k: v for k, v in race_prediction_entry.items() if v is not None}

    return athlete, readiness_entry, load_entry, race_prediction_entry


def merge_athlete_snapshot(history, patch):
    """Shallow-merge new athlete fields onto the existing snapshot instead of
    replacing it outright, so a source that only reports running fitness
    (like the browser-capture export, which has no cycling data at all)
    doesn't blow away previously-known fields it simply doesn't carry
    (cycling ftp, zones.power)."""
    if not patch:
        return
    snapshot = history.setdefault("athlete_snapshot", {})
    for k, v in patch.items():
        if v is None:
            continue
        if k == "zones" and isinstance(v, dict) and isinstance(snapshot.get("zones"), dict):
            snapshot["zones"] = {**snapshot["zones"], **v}
        else:
            snapshot[k] = v


def upsert_by_date(records, new_record):
    """Merge (not replace) the record for this date - different Garmin
    export formats carry different, non-overlapping metrics for the same
    day (e.g. only the old coach export has a training-readiness score;
    only the new browser-capture export has running-tolerance data), so a
    later parse of one format shouldn't erase fields only the other format
    ever provides. On any field both records set, the new one wins."""
    for i, r in enumerate(records):
        if r["date"] == new_record["date"]:
            records[i] = {**r, **new_record}
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


def upsert_race(races, race):
    for i, r in enumerate(races):
        if r["date"] == race["date"] and r["name"] == race["name"]:
            races[i] = {**r, **race}  # preserve hand-written notes/date_note unless explicitly overwritten
            return
    races.append(race)


def main(argv):
    if not argv:
        print(__doc__)
        return 1

    history = load_history()

    pending_race_name = None
    args = list(argv)
    i = 0
    while i < len(args):
        arg = args[i]

        if arg == "--race":
            if i + 1 >= len(args):
                print("  ! --race needs a name argument")
                return 1
            pending_race_name = args[i + 1]
            i += 2
            continue

        path = Path(arg)
        i += 1
        if not path.exists():
            print(f"  ! not found: {path}")
            continue

        if path.suffix.lower() == ".fit":
            race_name = pending_race_name
            pending_race_name = None
            label = "race" if race_name else "activity"
            print(f"Parsing FIT {label}: {path.name}")
            activity = parse_fit(path)
            if activity:
                if race_name:
                    activity["race"] = True
                    activity["title"] = race_name
                added = upsert_activity(history["activities"], activity)
                print(f"  -> {activity['date']}  {activity['distance_mi']}mi  "
                      f"{activity['avg_pace_per_mi']}/mi  HR {activity['avg_hr']}  "
                      f"({'updated' if not added else 'added'})")
                if race_name and activity.get("date"):
                    dur = activity["duration_sec"]
                    h, rem = divmod(int(round(dur)), 3600)
                    m, s = divmod(rem, 60)
                    time_display = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
                    race_entry = {
                        "name": race_name,
                        "date": activity["date"],
                        "distance_mi": activity["distance_mi"],
                        "time_sec": dur,
                        "time_display": time_display,
                        "avg_hr": activity.get("avg_hr"),
                        "max_hr": activity.get("max_hr"),
                        "avg_pace_per_mi": activity.get("avg_pace_per_mi"),
                        "notes": "",
                    }
                    upsert_race(history.setdefault("races", []), race_entry)
                    print(f"  -> race log: {race_name} on {activity['date']}, {time_display}")
            archive_raw(path, activity["date"] if activity else None)

        elif path.suffix.lower() == ".json":
            raw = json.loads(path.read_text())
            if raw.get("source") == "garmin-connect-browser-capture-extension":
                print(f"Parsing Garmin browser-capture export: {path.name}")
                athlete, readiness_entry, load_entry, race_prediction_entry = parse_extension_json(raw)
                merge_athlete_snapshot(history, athlete)
                upsert_by_date(history["readiness_history"], readiness_entry)
                upsert_by_date(history["load_history"], load_entry)
                if race_prediction_entry:
                    upsert_by_date(history.setdefault("race_predictions", []), race_prediction_entry)

                print(f"  -> readiness/load snapshot for {readiness_entry['date']}"
                      + (", race predictions updated" if race_prediction_entry else ""))
                archive_raw(path, readiness_entry["date"])

            else:
                print(f"Parsing coach/health export: {path.name}")
                athlete, readiness_entry, load_entry, trends = parse_coach_json(path)
                merge_athlete_snapshot(history, athlete)
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
    print(f"  races: {len(history.get('races', []))}")
    print(f"  race predictions: {len(history.get('race_predictions', []))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
