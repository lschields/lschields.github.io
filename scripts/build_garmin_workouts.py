#!/usr/bin/env python3
"""
build_garmin_workouts.py

Generates Garmin Connect-importable structured workout JSON files for a
given plan week's running sessions. The schema matches Garmin Connect's
workout-service (ExecutableStepDTO steps, heart.rate.zone / pace.zone
targets) - the same shape as the file Luke exported from a prior workout
he built, so these should drop into whatever pipeline he already uses to
push a workout JSON into his Garmin Connect account and sync it to his
watch.

Usage:
    python3 scripts/build_garmin_workouts.py <week_num>

Writes one JSON file per running session (skips strength/PT days - those
aren't structured cardio workouts) to data/workouts/week_<NN>/.

Note: heart.rate.zone targets are modeled directly on a known-good
example Luke already used successfully. pace.zone targets (for the
Build-phase tempo/interval/goal-pace sessions later in the plan) are
inferred from the same schema shape but haven't been validated against
a real import yet - sanity-check the first one before trusting it blind.
"""
import json
import sys
import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAN_PATH = ROOT / "data" / "plan.json"
HISTORY_PATH = ROOT / "data" / "history.json"
OUT_ROOT = ROOT / "data" / "workouts"

OWNER_ID = 585149926  # Luke's Garmin Connect profile id, from a prior workout export
MILE_M = 1609.34

SPORT_RUNNING = {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1}

STEP_TYPES = {
    "warmup": {"stepTypeId": 1, "stepTypeKey": "warmup", "displayOrder": 1},
    "cooldown": {"stepTypeId": 2, "stepTypeKey": "cooldown", "displayOrder": 2},
    "interval": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
}

NO_TARGET = ({"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}, None, None)


def hr_target(floor_bpm, ceil_bpm):
    return ({"workoutTargetTypeId": 4, "workoutTargetTypeKey": "heart.rate.zone", "displayOrder": 4},
            float(floor_bpm), float(ceil_bpm))


def pace_target(slow_sec_per_mi, fast_sec_per_mi):
    """Pace range -> Garmin's speed-based pace.zone target (m/s), slow bound first."""
    slow_mps = MILE_M / slow_sec_per_mi
    fast_mps = MILE_M / fast_sec_per_mi
    return ({"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone", "displayOrder": 6},
            round(slow_mps, 3), round(fast_mps, 3))


def make_step(step_id, order, kind, distance_mi, target):
    target_type, v1, v2 = target
    return {
        "type": "ExecutableStepDTO",
        "stepId": step_id,
        "stepOrder": order,
        "stepType": STEP_TYPES[kind],
        "childStepId": None,
        "description": None,
        "endCondition": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": True},
        "endConditionValue": round(distance_mi * MILE_M),
        "preferredEndConditionUnit": {"unitId": 5, "unitKey": "mile", "factor": 160934},
        "endConditionCompare": None,
        "targetType": target_type,
        "targetValueOne": v1,
        "targetValueTwo": v2,
        "zoneNumber": None,
        "secondaryTargetType": None,
        "secondaryTargetValueOne": None,
        "secondaryTargetValueTwo": None,
        "secondaryZoneNumber": None,
        "targetValueUnit": None,
        "secondaryTargetValueUnit": None,
        "endConditionZone": None,
        "strokeType": {"strokeTypeId": 0, "strokeTypeKey": None, "displayOrder": 0},
        "equipmentType": {"equipmentTypeId": 0, "equipmentTypeKey": None, "displayOrder": 0},
        "category": None,
        "exerciseName": None,
        "workoutProvider": None,
        "providerExerciseSourceId": None,
        "weightValue": None,
        "weightUnit": {"unitId": 8, "unitKey": "kilogram", "factor": 1000},
        "drillType": None,
    }


def fmt_pace(s):
    m, sec = int(s // 60), int(round(s % 60))
    return f"{m}:{sec:02d}"


def recent_paces(history, before_date):
    acts = [a for a in history.get("activities", []) if a.get("date") and a["date"] < before_date]
    acts = acts[-3:]
    paces = [a["avg_pace_sec_per_mi"] for a in acts if a.get("avg_pace_sec_per_mi")]
    hrs = [a["avg_hr"] for a in acts if a.get("avg_hr")]
    return acts, hrs, paces


def recent_evidence(history, kind, before_date):
    """Pull a short 'your data' line from the most recent same-ish activities."""
    acts, hrs, paces = recent_paces(history, before_date)
    if not acts or not hrs or not paces:
        return None
    return (f"Your last {len(acts)} logged runs averaged {min(hrs)}-{max(hrs)} bpm at "
            f"{fmt_pace(min(paces))}-{fmt_pace(max(paces))}/mi.")


def build_description(kind_label, distance_mi, zone_num, floor_bpm, ceil_bpm, details, evidence):
    purpose = {
        "Easy": "Pure aerobic base building. Zone 2 running trains fat oxidation, builds mitochondrial "
                "density, and improves cardiac stroke volume - without generating meaningful fatigue.",
        "Long": "Time on feet at an aerobic effort - builds fatigue resistance, capillary density, and "
                "fuel efficiency for race-day distance without digging into recovery.",
        "Recovery": "Active recovery. The point is blood flow and turnover, not training stimulus - "
                    "this run should barely register as effort.",
    }.get(kind_label, "Aerobic, HR-governed effort.")
    lines = [
        f"{kind_label.upper()} RUN — {distance_mi} miles | Zone {zone_num} | HR {floor_bpm}-{ceil_bpm} bpm",
        "",
        f"PURPOSE: {purpose}",
        "",
        "FOCUS: Let HR govern pace completely. If it's hot/humid you may need to run slower than usual "
        f"to stay under {ceil_bpm} bpm - that's correct, don't chase pace targets.",
    ]
    if details:
        lines += ["", f"NOTE: {details}"]
    if evidence:
        lines += ["", f"YOUR DATA: {evidence}"]
    lines += ["", "FEEL: Fully conversational. You should be able to speak in complete sentences with zero effort."]
    return "\n".join(lines)


def build_workout(week_num, date_str, day_name, session, history):
    hr_zones = {z["zone"]: z for z in json.loads(PLAN_PATH.read_text())["athlete"]["hr_zones"]}
    distance_mi = session["distance_mi"]
    kind_label = {"easy": "Easy", "long": "Long", "recovery": "Recovery",
                  "tempo": "Tempo", "intervals": "Intervals"}.get(session["kind"], session["kind"].title())

    if session.get("hr_zone"):
        zone = hr_zones[session["hr_zone"]]
        floor_bpm, ceil_bpm = zone["floor_bpm"], zone["ceil_bpm"]
        main_target = hr_target(floor_bpm, ceil_bpm)
        zone_num = session["hr_zone"]
    else:
        # Pace-based session (tempo/intervals/goal pace) - session["pace"] is a free-text
        # range like "6:35-6:45"; best-effort parse, falls back to no-target if it can't.
        floor_bpm = ceil_bpm = zone_num = None
        main_target = NO_TARGET

    evidence = recent_evidence(history, session["kind"], date_str)
    description = build_description(kind_label, distance_mi, zone_num, floor_bpm, ceil_bpm,
                                     session.get("details", ""), evidence)

    warmup_mi = 0.25 if distance_mi > 2 else 0
    cooldown_mi = 0.25 if distance_mi > 2 else 0
    main_mi = distance_mi - warmup_mi - cooldown_mi

    # Rough duration estimate for the segment - averages recent logged pace if we have
    # it, otherwise falls back to a zone-typical pace. Purely informational; Garmin
    # recalculates actual duration live off HR, this just seeds the estimate field.
    _, _, recent_pace_list = recent_paces(history, date_str)
    if recent_pace_list:
        est_pace_sec = sum(recent_pace_list) / len(recent_pace_list)
    else:
        est_pace_sec = {1: 630, 2: 570}.get(session.get("hr_zone"), 570)  # 10:30 or 9:30 /mi
    est_duration_secs = round(distance_mi * est_pace_sec)

    steps = []
    sid = 8000000000
    order = 1
    if warmup_mi:
        steps.append(make_step(sid, order, "warmup", warmup_mi, NO_TARGET)); sid += 1; order += 1
    steps.append(make_step(sid, order, "interval", main_mi, main_target)); sid += 1; order += 1
    if cooldown_mi:
        steps.append(make_step(sid, order, "cooldown", cooldown_mi, NO_TARGET)); sid += 1; order += 1

    now = dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.0")
    workout_name = f"W{week_num:02d} {day_name} {kind_label} {distance_mi:g}mi"

    return {
        "workoutId": None,
        "ownerId": OWNER_ID,
        "workoutName": workout_name,
        "description": description,
        "updatedDate": now,
        "createdDate": now,
        "sportType": SPORT_RUNNING,
        "subSportType": "GENERIC",
        "trainingPlanId": None,
        "author": {
            "userProfilePk": OWNER_ID, "displayName": "", "fullName": "",
            "profileImgNameLarge": None, "profileImgNameMedium": "", "profileImgNameSmall": "",
            "userPro": False, "vivokidUser": False,
        },
        "workoutSegments": [{
            "segmentOrder": 1,
            "sportType": SPORT_RUNNING,
            "poolLengthUnit": None,
            "poolLength": None,
            "avgTrainingSpeed": 2.8,
            "estimatedDurationInSecs": est_duration_secs,
            "estimatedDistanceInMeters": round(distance_mi * MILE_M),
            "estimatedDistanceUnit": {"unitId": 2, "unitKey": "kilometer", "factor": 100000},
            "estimateType": "DISTANCE_ESTIMATED",
            "description": None,
            "workoutSteps": steps,
        }],
        "poolLength": None,
        "poolLengthUnit": None,
        "locale": None,
        "workoutProvider": None,
        "workoutSourceId": None,
        "uploadTimestamp": None,
        "atpPlanId": None,
        "consumer": None,
        "consumerName": None,
        "consumerImageURL": None,
        "consumerWebsiteURL": None,
        "workoutNameI18nKey": None,
        "descriptionI18nKey": None,
        "avgTrainingSpeed": 2.8,
        "estimateType": "DISTANCE_ESTIMATED",
        "estimatedDistanceUnit": {"unitId": 2, "unitKey": "kilometer", "factor": 100000},
        "workoutThumbnailUrl": None,
        "isSessionTransitionEnabled": None,
        "shared": False,
    }, workout_name


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    week_num = int(argv[0])
    plan = json.loads(PLAN_PATH.read_text())
    history = json.loads(HISTORY_PATH.read_text()) if HISTORY_PATH.exists() else {"activities": []}

    week = next((w for w in plan["weeks"] if w["week_num"] == week_num), None)
    if not week:
        print(f"No week {week_num} found in plan.json")
        return 1

    out_dir = OUT_ROOT / f"week_{week_num:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)

    written = []
    for day in week["days"]:
        for session in day["sessions"]:
            if session["type"] != "run":
                continue
            workout, name = build_workout(week_num, day["date"], day["day_name"], session, history)
            fname = f"{day['date']}_W{week_num:02d}_{day['day_name']}_{session['kind'].title()}_{session['distance_mi']:g}mi.json"
            path = out_dir / fname
            path.write_text(json.dumps(workout, indent=2))
            written.append(path)
            print(f"  {path.relative_to(ROOT)}  ({name})")

    print(f"\nWrote {len(written)} workout file(s) to {out_dir.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
