#!/usr/bin/env python3
"""
build_plan.py

Regenerates data/plan.json - the full periodized training plan for the
Cambridge Half Marathon (Nov 1, 2026), goal 1:28:00.

Rebuilt 2026-08-07 around Luke's preferred weekly pattern (Tue/Wed/Thu runs,
Sat long run, Sun recovery run, PT/prehab confined to Mon/Fri with light daily
touches on run days) using his own "cambridge_hm_plan.html" artifact as the
structural base - HR-zone methodology, phase philosophy, race strategy - with
paces/zones reconciled back to verified Garmin data (VO2max 53, LTHR 169) and
the 1:28 goal, since the artifact's VO2max 55 / LTHR 178 / 1:25 numbers aren't
supported by what's actually in data/history.json.

Extended 2026-08-07 (same day) to add back Week 1 (Aug 3-9) - the week Luke
was already mid-way through, running the artifact's own Week 2 workouts
(Tue/Wed easy runs already logged in history.json). The plan now spans the
full 13 weeks the artifact originally covered (Aug 3 - Nov 1), not just the
12 weeks from Aug 10 forward.

This is the source of truth for prescribed workouts. Edit this file (not
plan.json directly) when the plan needs to change, then re-run:

    python3 scripts/build_plan.py

Actual performance data lives separately in data/history.json (built by
scripts/parse_garmin.py) - plan.json never contains completion status.
Completion is computed at render time in the browser by matching
history.json activities against these sessions by date + type.
"""
import json
import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "plan.json"

RACE_DATE = dt.date(2026, 11, 1)  # Cambridge Half Marathon, Sunday
GOAL_TIME_SEC = 88 * 60  # 1:28:00
GOAL_PACE_PER_MI = "6:43"
GOAL_PACE_PER_KM = "4:10"

ATHLETE = {
    "name": "Luke",
    "race": {
        "name": "Cambridge Half Marathon",
        "date": RACE_DATE.isoformat(),
        "distance_mi": 13.10938,
        "goal_time_sec": GOAL_TIME_SEC,
        "goal_time_display": "1:28:00",
        "goal_pace_per_mi": GOAL_PACE_PER_MI,
        "goal_pace_per_km": GOAL_PACE_PER_KM,
        "course": [
            "Starts/finishes at CambridgeSide in East Cambridge; route through Kendall Square, "
            "Memorial Drive, Riverside, West Cambridge, Lower Allston, and Watertown.",
            "Flat and fast - minimal elevation change. No need to adjust pace for terrain; even "
            "pacing is rewarded on this course more than most.",
            "Historically cold and clear on race morning - dress in a throwaway layer you can shed "
            "early. Cold favors distance runners.",
        ],
    },
    "context": [
        "Ran Grandma's Marathon 6/20/2026 in 3:45:49 - GI distress during the race; pre-race training "
        "projection was ~3:28. Not used for pace-setting.",
        "3-4 week layoff after Grandma's for illness + sore Achilles, followed by a self-directed "
        "return to running through July that's visible in the logged activities (easy paces, "
        "9:00-9:48/mi, HR 128-149).",
        "Half marathon PR: 1:30. Ran this exact Cambridge course in 11/2025 in 1:35.",
        "Goal of 1:28 is real but ambitious - set from the PR/Cambridge-2025 evidence, not the "
        "marathon-day result. A Week 8 time trial recalibrates paces before the peak phase locks in.",
        "Plan rebuilt 2026-08-07 around a base template Luke built (cambridge_hm_plan.html): "
        "Tue/Wed/Thu/Sat/Sun running, Mon/Fri for PT/prehab, HR-based easy/long/recovery, "
        "pace-based tempo/intervals/goal-pace work. That artifact assumed VO2max 55 / LTHR 178 / "
        "a 1:25 goal - none of which match verified Garmin data (VO2max 53, LTHR 169 as of 8/7), "
        "so paces here are reconciled back to the 1:28 goal and real numbers.",
        "Plan spans 13 weeks, Aug 3 - Nov 1 2026 - Week 1 (Aug 3-9) picks up the week Luke had "
        "already started under the artifact's own schedule before this dashboard existed.",
    ],
    "hr_zones": [
        {"zone": 1, "name": "Warmup", "floor_bpm": 107, "ceil_bpm": 130},
        {"zone": 2, "name": "Easy", "floor_bpm": 131, "ceil_bpm": 144},
        {"zone": 3, "name": "Aerobic / Steady", "floor_bpm": 145, "ceil_bpm": 155},
        {"zone": 4, "name": "Threshold", "floor_bpm": 156, "ceil_bpm": 163},
        {"zone": 5, "name": "Max", "floor_bpm": 164, "ceil_bpm": 190},
    ],
    "lthr_bpm": 169,
    "pace_zones": [
        {"name": "Easy", "pace_per_mi": "HR-based, no pace target", "hr_zone": 2},
        {"name": "Long run", "pace_per_mi": "HR-based, no pace target", "hr_zone": 2},
        {"name": "Recovery", "pace_per_mi": "HR-based, no pace target", "hr_zone": 1},
        {"name": "Tempo / Threshold", "pace_per_mi": "6:35-6:45", "hr_zone": None},
        {"name": "Goal HM pace", "pace_per_mi": GOAL_PACE_PER_MI, "hr_zone": None},
        {"name": "VO2max intervals", "pace_per_mi": "6:00-6:15", "hr_zone": None},
        {"name": "Strides", "pace_per_mi": "5:30-5:45 (relaxed, not max effort)", "hr_zone": None},
    ],
    "race_strategy": {
        "splits": [
            {"segment": "Miles 1-2", "target": "6:55-7:05/mi", "note": "Deliberately conservative - adrenaline will make this feel too easy. Don't chase the crowd."},
            {"segment": "Miles 3-9", "target": f"{GOAL_PACE_PER_MI}/mi", "note": "Settle into goal pace, controlled not labored. Gel around mile 4 and mile 8-9, 2 min before a water stop, sip only."},
            {"segment": "Miles 10-12", "target": f"{GOAL_PACE_PER_MI}/mi, or a few sec faster if it feels easy", "note": "If you've paced it right you'll have something left - start spending it here, gently."},
            {"segment": "Mile 13.1", "target": "Empty the tank", "note": "Run through the line, not to it."},
        ],
        "fueling": "2 gels total - one around mile 4, one around mile 8-9, each a couple minutes before a "
                   "water stop. Sip water, don't gulp - GI distress at Grandma's came from too much fluid "
                   "with gels, not too little.",
        "if_behind_pace": "If you're 10-15 sec/mi slow by mile 6, don't chase it - hold effort and let it "
                           "come back in miles 10-12. Chasing pace early rarely ends well.",
    },
}

# ---------------------------------------------------------------------------
# Reusable strength / PT circuits (referenced by id from week definitions)
# ---------------------------------------------------------------------------

EXERCISES = {
    "achilles_isometric": {
        "name": "Achilles isometric calf hold",
        "prescription": "3 x 30-45s hold, straight leg, mid-range",
        "cue": "Pain during the hold should stay <=3/10. Stop the exercise, not the plan, if it spikes.",
        "category": "achilles_calf",
        "equipment": "Bodyweight (add a backpack to progress load)",
        "how_to": "Stand on the edge of a step on the ball of one foot (or on flat ground for less "
                  "load). Rise to about mid-range on your toes - not full extension - and hold there. "
                  "Keep the knee straight the whole time.",
    },
    "achilles_eccentric": {
        "name": "Eccentric heel drop (Alfredson protocol)",
        "prescription": "3 x 15 straight-leg + 3 x 15 bent-knee, both legs",
        "cue": "Slow 3-count lower off a step, use the good leg (or hands) to reset up. Mild ache is fine, sharp pain is not.",
        "category": "achilles_calf",
        "equipment": "A step or curb",
        "how_to": "Stand with heels hanging off the edge of a step. Rise onto both toes, then shift "
                  "your weight onto one leg and lower that heel below the step over a slow 3-count. "
                  "Use both feet (or a hand rail) to reset back up - only the lowering is single-leg. "
                  "For the bent-knee set, do the same movement with a soft knee bend to target the "
                  "soleus instead of the gastrocnemius.",
    },
    "tib_raise": {
        "name": "Tibialis raise",
        "prescription": "3 x 15-20, heels on a small plate or wall lean",
        "cue": "Builds shin/ankle strength that protects the Achilles as load climbs.",
        "category": "achilles_calf",
        "equipment": "Bodyweight, small plate optional",
        "how_to": "Lean back against a wall with your heels a foot or two out in front of you, "
                  "weight on your heels. Lift your toes and forefeet up toward your shins, then lower "
                  "with control. Keep it slow - this is a small range of motion.",
    },
    "calf_raise_straight": {
        "name": "Standing calf raise (straight leg)",
        "prescription": "4 x 12-15, add load once bodyweight is easy",
        "cue": "",
        "category": "achilles_calf",
        "equipment": "Bodyweight, progress to dumbbells/barbell",
        "how_to": "Stand on flat ground or the edge of a step with legs straight. Rise onto your toes "
                  "as high as you can, pause briefly at the top, then lower with control - don't just "
                  "drop.",
    },
    "calf_raise_bent": {
        "name": "Seated calf raise (bent knee)",
        "prescription": "3 x 15",
        "cue": "Targets soleus - the muscle that matters most late in a half marathon.",
        "category": "achilles_calf",
        "equipment": "Seated, a plate or dumbbell across the knees",
        "how_to": "Sit with feet flat and a weight resting across your knees. Push through the balls "
                  "of your feet to rise onto your toes, hold briefly, then lower with control.",
    },
    "single_leg_rdl": {
        "name": "Single-leg RDL",
        "prescription": "3 x 8-10/side",
        "cue": "Slow and controlled - this is a hip/hamstring + balance exercise, not a load exercise.",
        "category": "hip_glute",
        "equipment": "Bodyweight, or a light dumbbell in the opposite hand",
        "how_to": "Stand on one leg with a slight bend in the knee. Hinge forward at the hips, "
                  "reaching the opposite hand toward the floor while your free leg extends straight "
                  "back for balance. Keep your back flat throughout, then drive back up to standing.",
    },
    "bulgarian_split_squat": {
        "name": "Bulgarian split squat",
        "prescription": "3 x 8-10/side",
        "cue": "Progress load week to week once form is clean.",
        "category": "hip_glute",
        "equipment": "A bench or step; dumbbells to add load",
        "how_to": "Stand a couple feet in front of a bench and rest the top of your back foot on it. "
                  "Lower straight down until your front thigh is close to parallel with the ground, "
                  "keeping your torso upright, then drive back up through the front heel.",
    },
    "goblet_squat": {
        "name": "Goblet squat",
        "prescription": "3 x 10-12",
        "cue": "",
        "category": "hip_glute",
        "equipment": "A dumbbell or kettlebell",
        "how_to": "Hold a dumbbell or kettlebell vertically at your chest. Squat down keeping your "
                  "chest up and knees tracking over your toes, then stand back up.",
    },
    "hip_thrust": {
        "name": "Barbell/DB hip thrust",
        "prescription": "3 x 8-12",
        "cue": "Glute drive - directly supports late-race form when hip extensors fatigue.",
        "category": "hip_glute",
        "equipment": "A bench + barbell or dumbbell (bodyweight works too)",
        "how_to": "Sit on the ground with your upper back against a bench, feet flat, a barbell or "
                  "dumbbell across your hips. Drive through your heels to lift your hips until your "
                  "body forms a straight line from shoulders to knees, squeeze your glutes at the "
                  "top, then lower with control.",
    },
    "clamshell": {
        "name": "Banded clamshell",
        "prescription": "3 x 15-20/side",
        "cue": "Hip stability - keeps the knee tracking straight under fatigue.",
        "category": "hip_glute",
        "equipment": "A light resistance band",
        "how_to": "Lie on your side with a light band above your knees, hips and knees bent about 45 "
                  "degrees, feet together. Keeping your feet touching, open your top knee upward, "
                  "then lower with control.",
    },
    "monster_walk": {
        "name": "Banded monster walk",
        "prescription": "3 x 10 steps/direction",
        "cue": "",
        "category": "hip_glute",
        "equipment": "A resistance band",
        "how_to": "Place a light band around your ankles (or just above your knees), feet hip-width "
                  "apart, in a slight squat. Step sideways while keeping tension on the band, staying "
                  "low the whole time - don't let your feet come together.",
    },
    "step_down": {
        "name": "Slow step-down",
        "prescription": "3 x 8/side",
        "cue": "Eccentric knee control - the single best exercise for runner's knee prevention.",
        "category": "knee_stability",
        "equipment": "A step or low box",
        "how_to": "Stand on a step or low box on one leg. Slowly lower your other foot toward the "
                  "ground with control, tapping lightly, then push back up through the standing leg. "
                  "Keep the knee tracking straight over your toes - don't let it cave inward.",
    },
    "copenhagen_plank": {
        "name": "Copenhagen plank (knee-supported)",
        "prescription": "3 x 20-30s/side",
        "cue": "Adductor strength - commonly the missing piece behind hip and knee niggles.",
        "category": "core",
        "equipment": "A bench",
        "how_to": "Lie on your side with your top leg's shin or knee resting on a bench, bottom leg "
                  "free. Prop up on your forearm and lift your hips into a side-plank position, "
                  "holding steady.",
    },
    "side_plank": {
        "name": "Side plank w/ hip abduction",
        "prescription": "3 x 30-45s/side",
        "cue": "",
        "category": "core",
        "equipment": "Bodyweight",
        "how_to": "Lie on your side, prop up on your forearm with elbow under your shoulder, feet "
                  "stacked. Lift your hips so your body forms a straight line, hold, and optionally "
                  "lift your top leg for added hip work.",
    },
    "dead_bug": {
        "name": "Dead bug",
        "prescription": "3 x 10/side",
        "cue": "",
        "category": "core",
        "equipment": "Bodyweight",
        "how_to": "Lie on your back, arms reaching straight up, knees bent 90 degrees over your hips. "
                  "Slowly lower one arm overhead and the opposite leg toward the floor while keeping "
                  "your low back pressed into the ground, then return and switch sides.",
    },
    "pallof_press": {
        "name": "Pallof press",
        "prescription": "3 x 12/side",
        "cue": "",
        "category": "core",
        "equipment": "A resistance band anchored to something sturdy",
        "how_to": "Stand side-on to a band anchored at chest height, holding the handle at your "
                  "chest with both hands. Press the band straight out in front of you and hold, "
                  "resisting the rotation it creates, then pull back in with control.",
    },
    "plank": {
        "name": "Front plank",
        "prescription": "3 x 45-60s",
        "cue": "",
        "category": "core",
        "equipment": "Bodyweight",
        "how_to": "Forearms on the ground under your shoulders, body in a straight line from head to "
                  "heels, core and glutes braced. Hold without letting your hips sag or pike up.",
    },
    "single_leg_balance": {
        "name": "Single-leg balance reach",
        "prescription": "3 x 8 reaches/side",
        "cue": "Cheap injury insurance - do it in socks on a hard floor.",
        "category": "knee_stability",
        "equipment": "Bodyweight",
        "how_to": "Stand on one leg, barefoot or in socks on a hard floor. Reach your opposite hand "
                  "toward the ground or out to the side while keeping your standing leg stable, then "
                  "return to center. Progress by reaching further or closing your eyes.",
    },
}

CATEGORY_LABELS = {
    "achilles_calf": "Achilles & calf",
    "hip_glute": "Hip & glute",
    "knee_stability": "Knee & stability",
    "core": "Core",
}


def ex_list(*ids):
    return [EXERCISES[i] for i in ids]


# Monday / Friday main PT sessions, by phase.

def pt_rebuild_mon():
    return {
        "type": "strength",
        "title": "PT - Achilles/hip focus",
        "exercises": ex_list(
            "achilles_isometric", "achilles_eccentric", "tib_raise",
            "clamshell", "monster_walk", "single_leg_balance",
        ),
        "note": "This block's real job is the Achilles and hips, not the barbell. Keep everything else light.",
    }


def pt_rebuild_fri():
    return {
        "type": "strength",
        "title": "PT - Knee/core focus",
        "exercises": ex_list(
            "achilles_eccentric", "step_down", "copenhagen_plank",
            "dead_bug", "side_plank", "goblet_squat",
        ),
        "note": "",
    }


def pt_build_mon():
    return {
        "type": "strength",
        "title": "PT - Lower body",
        "exercises": ex_list(
            "goblet_squat", "single_leg_rdl", "bulgarian_split_squat",
            "calf_raise_straight", "clamshell", "plank",
        ),
        "note": "",
    }


def pt_build_fri():
    return {
        "type": "strength",
        "title": "PT - Posterior chain",
        "exercises": ex_list(
            "hip_thrust", "step_down", "calf_raise_bent",
            "copenhagen_plank", "monster_walk", "pallof_press",
        ),
        "note": "",
    }


def pt_peak_mon():
    return {
        "type": "strength",
        "title": "PT - Lower body (heavier, lower volume)",
        "exercises": ex_list(
            "goblet_squat", "single_leg_rdl", "bulgarian_split_squat", "calf_raise_straight",
        ),
        "note": "Cut volume, keep intensity - legs need to be fresh for quality running now.",
    }


def pt_peak_fri():
    return {
        "type": "strength",
        "title": "PT - Maintenance",
        "exercises": ex_list("hip_thrust", "step_down", "clamshell", "calf_raise_bent"),
        "note": "",
    }


def pt_taper():
    return {
        "type": "strength",
        "title": "PT - Activation only",
        "exercises": ex_list("clamshell", "monster_walk", "single_leg_balance", "tib_raise"),
        "note": "Bodyweight, low reps, zero soreness risk. This is about staying loose, not building anything new.",
    }


def light_touch(*ids, note=""):
    """A quick 1-exercise item to sprinkle on run days - not a full PT session.
    Mon/Fri carry the real volume; this is just enough to keep the Achilles/hips
    happy between those days without stacking a full regimen every day."""
    return {"type": "pt", "title": "Quick touch", "exercises": ex_list(*ids), "note": note}


def run_session(kind, title, distance_mi=None, duration_min=None, pace=None,
                 hr_zone=None, details="", note=""):
    return {
        "type": "run",
        "kind": kind,  # recovery | easy | long | tempo | intervals | mp | race | shakeout
        "title": title,
        "distance_mi": distance_mi,
        "duration_min": duration_min,
        "pace": pace,
        "hr_zone": hr_zone,
        "details": details,
        "note": note,
    }


def rest_day(note="Full rest. No PT today - this is a real day off."):
    return {"type": "rest", "title": "Rest", "note": note}


DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def week_dates(week_num, start_monday):
    d0 = start_monday + dt.timedelta(days=7 * (week_num - 1))
    return [d0 + dt.timedelta(days=i) for i in range(7)]


def build_day(date, sessions):
    return {"date": date.isoformat(), "day_name": DOW[date.weekday()], "sessions": sessions}


# ---------------------------------------------------------------------------
# Week definitions
# ---------------------------------------------------------------------------

START_MONDAY = dt.date(2026, 8, 3)  # Week 1 Monday - the week Luke was already mid-way through

WEEKS = []


def add_week(week_num, block, block_label, focus, target_miles, coach_notes, day_sessions):
    """day_sessions: list of 7 lists (Mon..Sun), each a list of session dicts."""
    dates = week_dates(week_num, START_MONDAY)
    days = [build_day(dates[i], day_sessions[i]) for i in range(7)]
    WEEKS.append({
        "week_num": week_num,
        "block": block,
        "block_label": block_label,
        "start_date": dates[0].isoformat(),
        "end_date": dates[6].isoformat(),
        "focus": focus,
        "target_miles": target_miles,
        "coach_notes": coach_notes,
        "days": days,
    })


# ---- Week 1 (Aug 3-9) - Rebuild ---------------------------------------------
add_week(
    1, "rebuild", "Rebuild - Weeks 1-3", "The week you'd already started - now folded into this plan",
    21,
    [
        "This is the week you were already running off the old artifact's schedule before this "
        "dashboard existed - Tue and Wed are already logged (nice work), so this just picks up where "
        "that plan left off and brings the rest of the week under the same HR-based rules as "
        "everything else here: no pace numbers on easy/long/recovery days.",
        "Heads up: this week's volume (~21mi) on top of the marathon recovery build-up is exactly why "
        "your ACWR read 1.5 (elevated) as of Aug 6. That's expected, not a red flag by itself - but "
        "it's why next week backs off to 18mi instead of continuing to climb.",
    ],
    [
        [pt_rebuild_mon()],
        [run_session("easy", "Easy run", distance_mi=4, hr_zone=2,
                      details="Already logged."),
         light_touch("achilles_eccentric")],
        [run_session("easy", "Easy run", distance_mi=4, hr_zone=2,
                      details="Already logged."),
         light_touch("achilles_eccentric")],
        [run_session("easy", "Easy run", distance_mi=3, hr_zone=2,
                      details="Add 4 x 20s strides only if the Achilles has been completely pain-free."),
         light_touch("achilles_eccentric")],
        [pt_rebuild_fri()],
        [run_session("long", "Long run (easy)", distance_mi=7, hr_zone=2,
                      details="No pace target - time on feet, nothing more.")],
        [run_session("recovery", "Recovery run", distance_mi=3, hr_zone=1,
                      details="Should feel almost too easy the whole way.")],
    ],
)

# ---- Week 2 (Aug 10-16) - Rebuild -------------------------------------------
add_week(
    2, "rebuild", "Rebuild - Weeks 1-3", "Intentional step-back after an elevated ACWR reading",
    18,
    [
        "Volume dips from ~21 to 18mi this week on purpose - Week 1 pushed ACWR to 1.5 (elevated), "
        "so this week gives that number room to settle back toward the 0.8-1.3 safe range before we "
        "build again. Everything stays HR-based, no pace numbers.",
        "Every easy/long/recovery run: stay in Zone 1-2 (up to ~144bpm). If you catch yourself "
        "drifting into Zone 3, slow down - walk if you have to.",
        "Week 1 update: Thu and Sun got skipped for 95F+/70% humidity heat, and Saturday's long run "
        "was cut to 6.52mi at an 11:02/mi average (walking by the end) just to hold HR under 143 - "
        "exactly the right call, nothing to make up. That actually left ACWR at 1.1 (healthy) already, "
        "not the 1.5 this cutback was originally sized for - but Achilles/HRV/RHR were all trending "
        "well before the heat hit, so there's no reason to add volume back either. Staying at 18mi as "
        "planned; if heat like this repeats, cap HR the same way and treat the shortened/skipped "
        "session as correct, not a gap to backfill.",
    ],
    [
        [pt_rebuild_mon()],
        [run_session("easy", "Easy run", distance_mi=4, hr_zone=2),
         light_touch("achilles_eccentric")],
        [run_session("easy", "Easy run", distance_mi=4, hr_zone=2),
         light_touch("achilles_eccentric")],
        [run_session("easy", "Easy run", distance_mi=4, hr_zone=2),
         light_touch("achilles_eccentric")],
        [pt_rebuild_fri()],
        [run_session("long", "Long run (easy)", distance_mi=6, hr_zone=2,
                      details="No pace target - time on feet, nothing more.")],
        [run_session("recovery", "Recovery run", distance_mi=3, hr_zone=1,
                      details="Should feel almost too easy the whole way.")],
    ],
)

# ---- Week 3 (Aug 17-23) - Rebuild -------------------------------------------
add_week(
    3, "rebuild", "Rebuild - Weeks 1-3", "Building, on the strength of a clean Week 2",
    22,
    [
        "Decision made: building to 22mi as originally planned. Week 2 was fully completed for the "
        "first time this cycle (all 5 sessions, 21mi actual) with zero Achilles flare, pace-at-HR "
        "kept improving all week (easy pace dropped from ~9:30/mi to 8:35-8:44/mi at the same or "
        "lower HR), and training status flipped to 'productive' for two straight readings.",
        "HRV/RHR didn't show the clean downtrend/uptrend this note originally asked for - they were "
        "flat and noisy (RHR 43-48, HRV 50-68) rather than trending. Saturday's low-readiness reading "
        "(29) had a clear one-off cause (a late heavy meal + short sleep + GI upset the night before), "
        "not a training-load problem, and fully rebounded by Sunday (readiness 29->45, HRV 54->61, "
        "great sleep). Weighed against everything else, that's not a reason to hold back.",
        "ACWR is still elevated (1.6-1.7) - watch it, but a chunk of that is mechanical: last week's "
        "healthy-looking 1.1 was artificially low because heat forced two skipped sessions, so "
        "finally running the full prescribed week was always going to push it up. If Achilles or "
        "readiness turn genuinely worse this week, say so and this gets revisited immediately.",
    ],
    [
        [pt_rebuild_mon()],
        [run_session("easy", "Easy run", distance_mi=4.5, hr_zone=2),
         light_touch("achilles_eccentric")],
        [run_session("easy", "Easy run + strides", distance_mi=5, hr_zone=2,
                      details="Last 10 min: 4 x 20s relaxed strides, full recovery between."),
         light_touch("achilles_eccentric")],
        [run_session("easy", "Easy run", distance_mi=4.5, hr_zone=2),
         light_touch("achilles_eccentric")],
        [pt_rebuild_fri()],
        [run_session("long", "Long run (easy)", distance_mi=7, hr_zone=2)],
        [run_session("recovery", "Recovery run", distance_mi=3.5, hr_zone=1)],
    ],
)

# ---- Week 4 (Aug 24-30) - Base -----------------------------------------------
add_week(
    4, "base", "Base - Weeks 4-5", "Aerobic volume builds, still fully HR-led",
    25,
    [
        "Base phase. Still no pace targets on any of these - the point right now is volume the "
        "aerobic system can absorb cleanly, not speed.",
    ],
    [
        [pt_build_mon()],
        [run_session("easy", "Easy run + strides", distance_mi=5, hr_zone=2,
                      details="Last 10 min: 4 x 20s relaxed strides, full recovery between."),
         light_touch("achilles_eccentric")],
        [run_session("easy", "Easy run", distance_mi=5.5, hr_zone=2)],
        [run_session("easy", "Easy run + strides", distance_mi=5, hr_zone=2,
                      details="6 x 20s strides after.")],
        [pt_build_fri()],
        [run_session("long", "Long run", distance_mi=8, hr_zone=2)],
        [run_session("recovery", "Recovery run", distance_mi=3.5, hr_zone=1)],
    ],
)

# ---- Week 5 (Aug 31-Sep 6) - Base ---------------------------------------------
add_week(
    5, "base", "Base - Weeks 4-5", "First tempo of the cycle",
    28,
    [
        "First pace-based quality session shows up Thursday. Keep it honest but controlled - this "
        "is a toe in the water, not a test. Tempo pace is 6:35-6:45/mi, full stop - don't run it by "
        "feel or let HR override the pace here.",
    ],
    [
        [pt_build_mon()],
        [run_session("easy", "Easy run", distance_mi=5.5, hr_zone=2),
         light_touch("calf_raise_straight")],
        [run_session("easy", "Easy run", distance_mi=5, hr_zone=2)],
        [run_session("tempo", "Tempo run", distance_mi=6,
                      pace="1.5mi warmup, 3mi @ 6:35-6:45, 1.5mi cooldown",
                      details="3 continuous miles at threshold pace - controlled hard, not a race.")],
        [pt_build_fri()],
        [run_session("long", "Long run", distance_mi=9.5, hr_zone=2)],
        [run_session("recovery", "Recovery run", distance_mi=4, hr_zone=1)],
    ],
)

# ---- Week 6 (Sep 7-13) - Build ------------------------------------------------
add_week(
    6, "build", "Build - Weeks 6-8", "Intervals introduced, hard/easy/hard weekday pattern begins",
    31,
    [
        "From here, Tue and Thu carry the quality (intervals, then tempo/goal-pace work), Wed stays "
        "easy between them, and Saturday's long run stays aerobic. This is the hard-easy-hard "
        "shape that makes the quality days actually count.",
    ],
    [
        [pt_build_mon()],
        [run_session("intervals", "VO2max intervals", distance_mi=6,
                      pace="1.5mi warmup, 5 x 800m @ 6:00-6:10/mi w/ 400m jog recovery, 1mi cooldown",
                      details="Hard but repeatable - if rep 5 falls apart, ease off rep 4 next time.")],
        [run_session("easy", "Easy run", distance_mi=5.5, hr_zone=2)],
        [run_session("tempo", "Tempo run", distance_mi=6.5,
                      pace="1.5mi warmup, 3.5mi @ 6:35-6:45, 1mi cooldown")],
        [pt_build_fri()],
        [run_session("long", "Long run", distance_mi=10, hr_zone=2)],
        [run_session("recovery", "Recovery run", distance_mi=4, hr_zone=1)],
    ],
)

# ---- Week 7 (Sep 14-20) - Build ------------------------------------------------
add_week(
    7, "build", "Build - Weeks 6-8", "Volume and intensity both step up",
    34,
    [
        "Highest load so far. If sleep or HRV dip noticeably this week, that's the signal to trim "
        "Wednesday's easy run, not skip Tuesday or Thursday.",
    ],
    [
        [pt_build_mon()],
        [run_session("intervals", "VO2max intervals", distance_mi=7,
                      pace="1.5mi warmup, 5 x 1mi @ 6:05-6:15/mi w/ 3min jog recovery, 1mi cooldown")],
        [run_session("easy", "Easy run", distance_mi=6, hr_zone=2)],
        [run_session("tempo", "Tempo run", distance_mi=7,
                      pace="1.5mi warmup, 4mi @ 6:35-6:45, 1.5mi cooldown")],
        [pt_build_fri()],
        [run_session("long", "Long run", distance_mi=11, hr_zone=2)],
        [run_session("recovery", "Recovery run", distance_mi=4, hr_zone=1)],
    ],
)

# ---- Week 8 (Sep 21-27) - Build (cutback + time trial) -------------------------
add_week(
    8, "build", "Build - Weeks 6-8", "Cutback week - and a 10K time trial to stop guessing on paces",
    26,
    [
        "Planned step-back: volume drops and Tuesday's intervals get shorter. The adaptation from "
        "Weeks 6-7 happens now, while you're recovering, not while you're grinding.",
        "Thursday is a 10K time trial (or an actual local 10K if one lines up) - fully rested for it, "
        "real race effort. Whatever that number is replaces the marathon result for pace-setting from "
        "here forward. Upload the file after and we'll recalibrate the Peak-block paces together.",
    ],
    [
        [pt_build_mon()],
        [run_session("intervals", "Short intervals", distance_mi=5,
                      pace="1.5mi warmup, 4 x 800m @ 6:05-6:15/mi w/ 400m jog recovery, 1mi cooldown")],
        [run_session("easy", "Easy + strides", distance_mi=4, hr_zone=2,
                      details="4 x 20s strides, keep it easy two days out from the time trial.")],
        [run_session("race", "10K time trial", distance_mi=6.2,
                      details="Race effort. Warm up 1.5-2mi, cool down 1mi (not counted in the day's total).",
                      note="This number recalibrates every pace from here to race day.")],
        [pt_rebuild_fri()],
        [run_session("long", "Long run (easy)", distance_mi=8, hr_zone=2,
                      details="Easy - legs will still have Thursday in them.")],
        [run_session("recovery", "Recovery run", distance_mi=3, hr_zone=1)],
    ],
)

# ---- Week 9 (Sep 28-Oct 4) - Peak -----------------------------------------------
add_week(
    9, "peak", "Peak - Weeks 9-11", "Goal-pace work begins",
    34,
    [
        "Peak phase - goal pace shows up directly in sessions now. Numbers below assume the Week 8 "
        "time trial confirmed 1:28 pace is on target; adjust this week's paces first if it didn't.",
    ],
    [
        [pt_peak_mon()],
        [run_session("intervals", "VO2max intervals", distance_mi=7,
                      pace="1.5mi warmup, 5 x 1mi @ 6:00-6:10/mi w/ 3min jog recovery, 1mi cooldown")],
        [run_session("easy", "Easy run", distance_mi=6, hr_zone=2)],
        [run_session("mp", "Goal-pace run", distance_mi=7,
                      pace=f"1.5mi warmup, 4mi @ {GOAL_PACE_PER_MI}, 1.5mi cooldown",
                      details="Should feel controlled, not desperate.")],
        [pt_peak_fri()],
        [run_session("long", "Long run w/ goal-pace finish", distance_mi=12,
                      hr_zone=2, details="Easy the whole way except the last 2mi - shift those to goal "
                      f"pace ({GOAL_PACE_PER_MI}/mi).")],
        [run_session("recovery", "Recovery run", distance_mi=4, hr_zone=1)],
    ],
)

# ---- Week 10 (Oct 5-11) - Peak -----------------------------------------------
add_week(
    10, "peak", "Peak - Weeks 9-11", "Highest volume of the cycle, longest goal-pace run",
    37,
    [
        "Biggest week of the plan. Saturday's long run is the closest thing to a rehearsal you'll "
        "get - practice whatever race-day fueling you're planning to use.",
    ],
    [
        [pt_peak_mon()],
        [run_session("intervals", "VO2max intervals", distance_mi=7.5,
                      pace="1.5mi warmup, 6 x 1000m @ 6:00-6:10/mi w/ 3min jog recovery, 1mi cooldown")],
        [run_session("easy", "Easy run", distance_mi=6, hr_zone=2)],
        [run_session("mp", "Goal-pace run", distance_mi=9,
                      pace=f"1.5mi warmup, 6mi @ {GOAL_PACE_PER_MI}, 1.5mi cooldown")],
        [pt_peak_fri()],
        [run_session("long", "Long run w/ goal-pace segment", distance_mi=13,
                      hr_zone=2, details=f"Easy, with miles 8-11 @ goal pace ({GOAL_PACE_PER_MI}/mi), "
                      "easy cooldown. Practice race-day fueling on this one.")],
        [run_session("recovery", "Recovery run", distance_mi=4, hr_zone=1)],
    ],
)

# ---- Week 11 (Oct 12-18) - Peak -----------------------------------------------
add_week(
    11, "peak", "Peak - Weeks 9-11", "Last real quality week, volume starts easing",
    30,
    [
        "Last hard week. Sharpen, don't strain - there's no time left to recover a setback before "
        "taper needs to start, so if anything feels off, back off rather than grind through.",
    ],
    [
        [pt_peak_mon()],
        [run_session("intervals", "VO2max intervals", distance_mi=6,
                      pace="1.5mi warmup, 4 x 1mi @ 6:00-6:10/mi w/ 3min jog recovery, 1mi cooldown")],
        [run_session("easy", "Easy run", distance_mi=5, hr_zone=2)],
        [run_session("mp", "Goal-pace run", distance_mi=7,
                      pace=f"1.5mi warmup, 4mi @ {GOAL_PACE_PER_MI}, 1.5mi cooldown")],
        [pt_peak_fri()],
        [run_session("long", "Long run", distance_mi=10, hr_zone=2,
                      details=f"Easy, last 1mi @ goal pace ({GOAL_PACE_PER_MI}/mi).")],
        [run_session("recovery", "Recovery run", distance_mi=3.5, hr_zone=1)],
    ],
)

# ---- Week 12 (Oct 19-25) - Taper -----------------------------------------------
add_week(
    12, "taper", "Taper - Weeks 12-13", "Volume drops, keep short touches of goal pace",
    22,
    [
        "Taper starts now. The fitness is already there - this block is about arriving on Nov 1 "
        "rested, not squeezing out more gains. Trust the volume drop.",
    ],
    [
        [pt_taper()],
        [run_session("intervals", "Short sharpener", distance_mi=5,
                      pace="1.5mi warmup, 3 x 1mi @ 6:05-6:15/mi w/ 3min jog recovery, 1mi cooldown")],
        [run_session("easy", "Easy run", distance_mi=4.5, hr_zone=2)],
        [run_session("mp", "Goal-pace touch", distance_mi=5,
                      pace=f"1mi warmup, 2mi @ {GOAL_PACE_PER_MI}, 1mi cooldown",
                      details="Short and sharp - this is about confidence, not fitness.")],
        [pt_taper()],
        [run_session("long", "Long run (reduced)", distance_mi=8, hr_zone=2)],
        [run_session("recovery", "Recovery run", distance_mi=3.5, hr_zone=1)],
    ],
)

# ---- Week 13 (Oct 26-Nov 1) - Race week -----------------------------------------
add_week(
    13, "taper", "Taper - Weeks 12-13", "Race week",
    12.1,
    [
        "Race week - Mon and Fri are full rest now, not PT days. Everything here is about staying "
        "loose and well-rested. Sleep and easy carb-forward eating matter more this week than any "
        "workout does.",
        "Course is flat and fast with cold, clear conditions typical on race morning - dress in a "
        "layer you can throw away at the start. Goal: 1:28:00. Go out conservative through mile 2, "
        "settle into goal pace by mile 3, hold through mile 12, then empty the tank.",
    ],
    [
        [rest_day()],
        [run_session("easy", "Easy + strides", distance_mi=4, hr_zone=2, details="4 x 20s strides.")],
        [run_session("easy", "Easy run", distance_mi=3, hr_zone=2)],
        [run_session("shakeout", "Confidence run", distance_mi=4,
                      pace=f"2mi easy, 2mi @ {GOAL_PACE_PER_MI}",
                      details="Feel the goal pace one more time. Should feel easy.")],
        [rest_day(note="Carb-load dinner, early to bed, nothing new to eat.")],
        [run_session("shakeout", "Shakeout", distance_mi=2, pace="Very easy, 4 loose strides",
                      details="Lay out kit, pin bib, bed by 9:30pm.")],
        [run_session("race", "CAMBRIDGE HALF MARATHON", distance_mi=13.10938,
                      pace=f"Goal {GOAL_PACE_PER_MI}/mi (1:28:00)",
                      details="Wake 4:30am, familiar breakfast by 5:00, arrive by 6:00, warm up 1.5mi, "
                      "corral by 6:45. You've done the work - trust the pacing plan and go get it.")],
    ],
)

CATEGORY_ORDER = ["achilles_calf", "hip_glute", "knee_stability", "core"]
exercise_library = []
for _cat in CATEGORY_ORDER:
    items = [{"id": k, **v} for k, v in EXERCISES.items() if v["category"] == _cat]
    items.sort(key=lambda e: e["name"])
    exercise_library.extend(items)

plan = {
    "generated_at": dt.datetime.utcnow().isoformat() + "Z",
    "athlete": ATHLETE,
    "weeks": WEEKS,
    "exercise_library": exercise_library,
    "exercise_categories": [{"id": c, "label": CATEGORY_LABELS[c]} for c in CATEGORY_ORDER],
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(plan, indent=2))
total_miles = sum(w["target_miles"] for w in WEEKS)
print(f"Wrote {OUT} - {len(WEEKS)} weeks, {total_miles:.1f} planned miles total")
