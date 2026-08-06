#!/usr/bin/env python3
"""
build_plan.py

Regenerates data/plan.json - the full periodized training plan for the
Cambridge Half Marathon (Nov 1, 2026), goal 1:28:00.

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
    },
    "context": [
        "Ran Grandma's Marathon 6/20/2026 in 3:45:49 - GI distress during the race; "
        "pre-race training projection was ~3:28.",
        "3-4 week layoff after Grandma's for illness + sore Achilles.",
        "Half marathon PR: 1:30. Ran this exact Cambridge course in 11/2025 in 1:35.",
        "Goal of 1:28 is a real but ambitious target given demonstrated sub-1:30 fitness - "
        "not supported by the marathon-day result alone (GI issues), so paces below are set "
        "from the PR/Cambridge-2025 evidence and will be recalibrated after the Week 8 time trial.",
    ],
    "hr_zones": [
        {"zone": 1, "name": "Recovery", "floor_bpm": 107, "ceil_bpm": 130},
        {"zone": 2, "name": "Easy / Aerobic", "floor_bpm": 131, "ceil_bpm": 144},
        {"zone": 3, "name": "Steady / Tempo", "floor_bpm": 145, "ceil_bpm": 155},
        {"zone": 4, "name": "Threshold", "floor_bpm": 156, "ceil_bpm": 163},
        {"zone": 5, "name": "VO2max+", "floor_bpm": 164, "ceil_bpm": 190},
    ],
    "lthr_bpm": 169,
    "pace_zones": [
        {"name": "Recovery", "pace_per_mi": "8:30-9:00", "hr_zone": 1},
        {"name": "Easy", "pace_per_mi": "7:50-8:20", "hr_zone": 2},
        {"name": "Long run", "pace_per_mi": "7:30-8:00", "hr_zone": 2},
        {"name": "Steady / MP-effort", "pace_per_mi": "7:00-7:15", "hr_zone": 3},
        {"name": "Tempo / Threshold", "pace_per_mi": "6:35-6:45", "hr_zone": "3-4"},
        {"name": "Goal HM pace", "pace_per_mi": GOAL_PACE_PER_MI, "hr_zone": "3-4"},
        {"name": "VO2max intervals", "pace_per_mi": "6:00-6:15", "hr_zone": "4-5"},
        {"name": "Strides", "pace_per_mi": "5:30-5:45 (relaxed, not max effort)", "hr_zone": "n/a"},
    ],
}

# ---------------------------------------------------------------------------
# Reusable strength / PT circuits (referenced by id from week definitions)
# ---------------------------------------------------------------------------

EXERCISES = {
    "achilles_isometric": {
        "name": "Achilles isometric calf hold",
        "prescription": "3 x 30-45s hold, straight leg, mid-range",
        "cue": "Pain during the hold should stay <=3/10. Stop the exercise, not the plan, if it spikes.",
    },
    "achilles_eccentric": {
        "name": "Eccentric heel drop (Alfredson protocol)",
        "prescription": "3 x 15 straight-leg + 3 x 15 bent-knee, both legs, daily",
        "cue": "Slow 3-count lower off a step, use the good leg (or hands) to reset up. Mild ache is fine, sharp pain is not.",
    },
    "tib_raise": {
        "name": "Tibialis raise",
        "prescription": "3 x 15-20, heels on a small plate or wall lean",
        "cue": "Builds shin/ankle strength that protects the Achilles as load climbs.",
    },
    "calf_raise_straight": {
        "name": "Standing calf raise (straight leg)",
        "prescription": "4 x 12-15, add load once bodyweight is easy",
        "cue": "",
    },
    "calf_raise_bent": {
        "name": "Seated calf raise (bent knee)",
        "prescription": "3 x 15",
        "cue": "Targets soleus - the muscle that matters most late in a half marathon.",
    },
    "single_leg_rdl": {
        "name": "Single-leg RDL",
        "prescription": "3 x 8-10/side",
        "cue": "Slow and controlled - this is a hip/hamstring + balance exercise, not a load exercise.",
    },
    "bulgarian_split_squat": {
        "name": "Bulgarian split squat",
        "prescription": "3 x 8-10/side",
        "cue": "Progress load week to week once form is clean.",
    },
    "goblet_squat": {
        "name": "Goblet squat",
        "prescription": "3 x 10-12",
        "cue": "",
    },
    "hip_thrust": {
        "name": "Barbell/DB hip thrust",
        "prescription": "3 x 8-12",
        "cue": "Glute drive - directly supports late-race form when hip extensors fatigue.",
    },
    "clamshell": {
        "name": "Banded clamshell",
        "prescription": "3 x 15-20/side",
        "cue": "Hip stability - keeps the knee tracking straight under fatigue.",
    },
    "monster_walk": {
        "name": "Banded monster walk",
        "prescription": "3 x 10 steps/direction",
        "cue": "",
    },
    "step_down": {
        "name": "Slow step-down",
        "prescription": "3 x 8/side",
        "cue": "Eccentric knee control - the single best exercise for runner's knee prevention.",
    },
    "copenhagen_plank": {
        "name": "Copenhagen plank (knee-supported)",
        "prescription": "3 x 20-30s/side",
        "cue": "Adductor strength - commonly the missing piece behind hip and knee niggles.",
    },
    "side_plank": {
        "name": "Side plank w/ hip abduction",
        "prescription": "3 x 30-45s/side",
        "cue": "",
    },
    "dead_bug": {
        "name": "Dead bug",
        "prescription": "3 x 10/side",
        "cue": "",
    },
    "pallof_press": {
        "name": "Pallof press",
        "prescription": "3 x 12/side",
        "cue": "",
    },
    "plank": {
        "name": "Front plank",
        "prescription": "3 x 45-60s",
        "cue": "",
    },
    "single_leg_balance": {
        "name": "Single-leg balance reach",
        "prescription": "3 x 8 reaches/side",
        "cue": "Cheap injury insurance - do it in socks on a hard floor.",
    },
}


def ex_list(*ids):
    return [EXERCISES[i] for i in ids]


# Strength templates by training phase - progression is: rebuild (prehab-heavy,
# light load) -> base/build (general strength + prehab maintenance) -> peak
# (heavier, lower volume) -> taper (light activation only).

def strength_rebuild_A():
    return {
        "type": "strength",
        "title": "Strength A - Prehab focus (Achilles/hip)",
        "exercises": ex_list(
            "achilles_isometric", "achilles_eccentric", "tib_raise",
            "clamshell", "monster_walk", "single_leg_balance",
        ),
        "note": "This block's real job is the Achilles and hips, not the barbell. Keep everything else light.",
    }


def strength_rebuild_B():
    return {
        "type": "strength",
        "title": "Strength B - Prehab focus (knee/core)",
        "exercises": ex_list(
            "achilles_eccentric", "step_down", "copenhagen_plank",
            "dead_bug", "side_plank", "goblet_squat",
        ),
        "note": "",
    }


def strength_build_A():
    return {
        "type": "strength",
        "title": "Strength A - Lower body",
        "exercises": ex_list(
            "goblet_squat", "single_leg_rdl", "bulgarian_split_squat",
            "calf_raise_straight", "clamshell", "plank",
        ),
        "note": "",
    }


def strength_build_B():
    return {
        "type": "strength",
        "title": "Strength B - Posterior chain",
        "exercises": ex_list(
            "hip_thrust", "step_down", "calf_raise_bent",
            "copenhagen_plank", "monster_walk", "pallof_press",
        ),
        "note": "",
    }


def strength_peak_A():
    return {
        "type": "strength",
        "title": "Strength A - Lower body (heavier, lower volume)",
        "exercises": ex_list(
            "goblet_squat", "single_leg_rdl", "bulgarian_split_squat", "calf_raise_straight",
        ),
        "note": "Cut volume, keep intensity - legs need to be fresh for quality running now.",
    }


def strength_peak_B():
    return {
        "type": "strength",
        "title": "Strength B - Maintenance",
        "exercises": ex_list("hip_thrust", "step_down", "clamshell", "calf_raise_bent"),
        "note": "",
    }


def strength_taper():
    return {
        "type": "strength",
        "title": "Activation only",
        "exercises": ex_list("clamshell", "monster_walk", "single_leg_balance", "tib_raise"),
        "note": "Bodyweight, low reps, zero soreness risk. This is about staying loose, not building anything new.",
    }


def core_circuit(level="base"):
    if level == "light":
        ids = ("dead_bug", "side_plank", "plank")
    elif level == "peak":
        ids = ("pallof_press", "side_plank", "dead_bug")
    else:
        ids = ("plank", "dead_bug", "pallof_press", "side_plank")
    return {"type": "core", "title": "Core", "exercises": ex_list(*ids), "note": ""}


def run_session(kind, title, distance_mi=None, duration_min=None, pace=None,
                 hr_zone=None, details="", note=""):
    return {
        "type": "run",
        "kind": kind,  # recovery | easy | long | steady | tempo | intervals | race | shakeout
        "title": title,
        "distance_mi": distance_mi,
        "duration_min": duration_min,
        "pace": pace,
        "hr_zone": hr_zone,
        "details": details,
        "note": note,
    }


def rest_day(note="Full rest, or 20-30min easy walk/spin if you feel restless."):
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

START_MONDAY = dt.date(2026, 8, 3)  # Week 1 Monday

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


# ---- Week 1 (Aug 3-9) - Rebuild -------------------------------------------------
add_week(
    1, "rebuild", "Rebuild - Weeks 1-2", "Return to running, calm the Achilles down, no pace targets",
    14,
    [
        "Your ACWR is sitting at 1.5 and training status read 'unproductive' the week I pulled your Garmin "
        "data - that's the load spiking faster than your body is absorbing it. This week undoes that: everything "
        "is capped at conversational effort and the Achilles work is daily, not optional.",
        "No paces this week on purpose. Run by feel and heart rate (stay in Zone 1-2, 107-144bpm). If the "
        "Achilles is more than mildly achy the next morning, swap that day's run for the bike or rest.",
    ],
    [
        [run_session("recovery", "Easy shakeout", distance_mi=3, hr_zone=1,
                      details="Flat ground if you have it. Walk breaks anytime.", note=""),
         {"type":"pt","title":"Daily Achilles work","exercises":ex_list("achilles_eccentric"),"note":"Do this every day this week, not just on strength days."}],
        [strength_rebuild_A()],
        [run_session("easy", "Easy run", distance_mi=3.5, hr_zone=2,
                      details="First few minutes should feel almost too easy.")],
        [strength_rebuild_B()],
        [rest_day()],
        [run_session("easy", "Easy run + strides", distance_mi=4, hr_zone=2,
                      details="Last 10 min: 4 x 20s relaxed strides, full recovery walk between.",
                      note="Strides are about leg speed/turnover, not effort - stay smooth.")],
        [run_session("long", "Long run (easy)", distance_mi=5, hr_zone=2,
                      details="No pace target. This is a time-on-feet run to remind your body what mileage feels like.")],
    ],
)

# ---- Week 2 (Aug 10-16) - Rebuild ----------------------------------------------
add_week(
    2, "rebuild", "Rebuild - Weeks 1-2", "Same shape, a bit more volume - watch the Achilles trend",
    18,
    [
        "If Week 1 went cleanly (no Achilles flare, HRV/RHR trending back to your baseline), we add modest "
        "volume. If it didn't go cleanly, repeat Week 1's mileage instead - tell me and I'll adjust the plan "
        "rather than push through.",
    ],
    [
        [run_session("recovery", "Easy shakeout", distance_mi=3.5, hr_zone=1),
         {"type":"pt","title":"Daily Achilles work","exercises":ex_list("achilles_eccentric"),"note":""}],
        [strength_rebuild_A()],
        [run_session("easy", "Easy run", distance_mi=4, hr_zone=2)],
        [strength_rebuild_B()],
        [rest_day()],
        [run_session("easy", "Easy run + strides", distance_mi=4.5, hr_zone=2,
                      details="Last 10 min: 6 x 20s relaxed strides.")],
        [run_session("long", "Long run (easy)", distance_mi=6, hr_zone=2,
                      details="Still no pace target - effort should stay conversational the entire way.")],
    ],
)

# ---- Week 3 (Aug 17-23) - Base --------------------------------------------------
add_week(
    3, "base", "Base - Weeks 3-4", "Back to structured paces, aerobic volume climbs",
    21,
    [
        "First week back on actual pace targets. Easy pace zone is 7:50-8:20/mi - resist the urge to run "
        "these faster just because it feels easy; the base phase is won on volume, not speed.",
    ],
    [
        [run_session("recovery", "Recovery run", distance_mi=3, pace="8:30-9:00", hr_zone=1)],
        [strength_build_A(), core_circuit("light")],
        [run_session("easy", "Easy run", distance_mi=4.5, pace="7:50-8:20", hr_zone=2)],
        [strength_build_B()],
        [rest_day()],
        [run_session("easy", "Easy run + strides", distance_mi=5, pace="7:50-8:20", hr_zone=2,
                      details="6 x 20s strides after.")],
        [run_session("long", "Long run", distance_mi=7.5, pace="7:30-8:00", hr_zone=2)],
    ],
)

# ---- Week 4 (Aug 24-30) - Base --------------------------------------------------
add_week(
    4, "base", "Base - Weeks 3-4", "Aerobic volume peaks for this block, first taste of steady effort",
    24,
    [
        "One new thing this week: a steady/MP-effort finish on Thursday. This is your first pace-aware "
        "quality work since the marathon - keep it controlled, this is a toe in the water, not a test.",
    ],
    [
        [run_session("recovery", "Recovery run", distance_mi=3, pace="8:30-9:00", hr_zone=1)],
        [strength_build_A(), core_circuit("light")],
        [run_session("easy", "Easy run", distance_mi=5, pace="7:50-8:20", hr_zone=2)],
        [strength_build_B()],
        [run_session("steady", "Easy + steady finish", distance_mi=5, pace="Easy 7:50-8:20, last 1.5mi @ 7:00-7:15",
                      hr_zone=3, details="Negative-split feel: build into the steady pace, don't jump into it.")],
        [rest_day()],
        [run_session("long", "Long run", distance_mi=8.5, pace="7:30-8:00", hr_zone=2)],
    ],
)

# ---- Week 5 (Aug 31-Sep 6) - Build 1 --------------------------------------------
add_week(
    5, "build", "Build - Weeks 5-8", "Threshold work begins",
    27,
    [
        "Welcome to the build phase. Wednesdays are now your quality day (tempo/threshold), Sundays stay "
        "aerobic but get longer. This is where the fitness for 1:28 actually gets made.",
    ],
    [
        [run_session("recovery", "Recovery run", distance_mi=3.5, pace="8:30-9:00", hr_zone=1)],
        [strength_build_A(), core_circuit()],
        [run_session("tempo", "Tempo run", distance_mi=6, pace="1mi warmup, 3mi @ 6:40-6:45, 1mi cooldown",
                      hr_zone=4, details="3 continuous miles at threshold - controlled hard, should feel like "
                      "you could hold it 20 more minutes if you had to.")],
        [strength_build_B()],
        [run_session("easy", "Easy run", distance_mi=4.5, pace="7:50-8:20", hr_zone=2)],
        [rest_day()],
        [run_session("long", "Long run", distance_mi=9, pace="7:30-8:00", hr_zone=2)],
    ],
)

# ---- Week 6 (Sep 7-13) - Build 2 -------------------------------------------------
add_week(
    6, "build", "Build - Weeks 5-8", "VO2max intervals introduced",
    30,
    [
        "Intervals replace tempo this week - the two quality types will alternate through the build phase "
        "so you get both the threshold and top-end stimulus without stacking them in the same week.",
    ],
    [
        [run_session("recovery", "Recovery run", distance_mi=3.5, pace="8:30-9:00", hr_zone=1)],
        [strength_build_A(), core_circuit()],
        [run_session("intervals", "VO2max intervals", distance_mi=6.5,
                      pace="1.5mi warmup, 6 x 800m @ 6:00-6:10/mi pace w/ 400m easy jog recovery, 1mi cooldown",
                      hr_zone=5, details="Effort should be hard but repeatable - if rep 6 falls apart, ease off rep "
                      "5 next time.")],
        [strength_build_B()],
        [run_session("easy", "Easy run", distance_mi=5, pace="7:50-8:20", hr_zone=2)],
        [rest_day()],
        [run_session("long", "Long run", distance_mi=10, pace="7:30-8:00", hr_zone=2)],
    ],
)

# ---- Week 7 (Sep 14-20) - Build 3 (cutback) --------------------------------------
add_week(
    7, "build", "Build - Weeks 5-8", "Cutback week - absorb the load before the next push",
    23,
    [
        "Planned step-back week: volume drops ~25% and the quality session is shorter. This isn't a rest week, "
        "just a lighter one - the adaptation from Weeks 5-6 happens now, while you're recovering, not while "
        "you're grinding.",
    ],
    [
        [run_session("recovery", "Recovery run", distance_mi=3, pace="8:30-9:00", hr_zone=1)],
        [strength_build_A(), core_circuit("light")],
        [run_session("tempo", "Tempo run (short)", distance_mi=5, pace="1mi warmup, 2mi @ 6:40-6:45, 1mi cooldown",
                      hr_zone=4)],
        [strength_build_B()],
        [run_session("easy", "Easy run", distance_mi=4, pace="7:50-8:20", hr_zone=2)],
        [rest_day()],
        [run_session("long", "Long run (easy)", distance_mi=7, pace="7:30-8:00", hr_zone=2)],
    ],
)

# ---- Week 8 (Sep 21-27) - Build 4 (time trial) -----------------------------------
add_week(
    8, "build", "Build - Weeks 5-8", "Calibration week - 10K time trial",
    28,
    [
        "This is the week we stop guessing. Race or time-trial a 10K on Saturday, fully rested for it. "
        "Whatever that number is, I'll use it (not the marathon result) to set your final goal pace and "
        "the Peak-block paces below - upload the file afterward and we'll recalibrate together.",
    ],
    [
        [run_session("recovery", "Recovery run", distance_mi=3, pace="8:30-9:00", hr_zone=1)],
        [strength_build_A(), core_circuit("light")],
        [run_session("easy", "Easy + strides", distance_mi=4, pace="7:50-8:20", hr_zone=2,
                      details="4 x 20s strides, keep everything easy 2 days out from the time trial.")],
        [rest_day()],
        [run_session("shakeout", "Pre-TT shakeout", distance_mi=2.5, pace="Easy, 3 x 15s strides")],
        [run_session("race", "10K time trial", distance_mi=6.2,
                      details="Race effort, ideally an actual local 10K. Warm up 1.5-2mi, cool down 1mi (not counted).",
                      note="This number recalibrates everything from here to race day.")],
        [run_session("long", "Long run (easy)", distance_mi=8, pace="7:30-8:00", hr_zone=2,
                      details="Easy - legs will still have Saturday in them.")],
    ],
)

# ---- Week 9 (Sep 28-Oct 4) - Peak 1 ----------------------------------------------
add_week(
    9, "peak", "Peak - Weeks 9-11", "Race-pace work begins",
    32,
    [
        "Peak phase: this is where goal-pace running shows up directly in the sessions. Paces below assume "
        "the Week 8 time trial confirmed 1:28 pace is on - update this week's session if it didn't.",
    ],
    [
        [run_session("recovery", "Recovery run", distance_mi=3.5, pace="8:30-9:00", hr_zone=1)],
        [strength_peak_A(), core_circuit("peak")],
        [run_session("tempo", "Race-pace intervals", distance_mi=7,
                      pace=f"1.5mi warmup, 3 x 1mi @ {GOAL_PACE_PER_MI} w/ 3min jog recovery, 1mi cooldown",
                      hr_zone=4)],
        [strength_peak_B()],
        [run_session("easy", "Easy run", distance_mi=5, pace="7:50-8:20", hr_zone=2)],
        [rest_day()],
        [run_session("long", "Long run w/ goal-pace finish", distance_mi=11,
                      pace="Easy 7:30-8:00, last 2mi @ goal pace 6:43", hr_zone=2)],
    ],
)

# ---- Week 10 (Oct 5-11) - Peak 2 -------------------------------------------------
add_week(
    10, "peak", "Peak - Weeks 9-11", "Longest long run, highest volume of the cycle",
    34,
    [
        "Highest-mileage week of the plan. The Sunday long run is the single most important session left - "
        "13 miles with real goal-pace running inside it is as close as you get to a rehearsal.",
    ],
    [
        [run_session("recovery", "Recovery run", distance_mi=3.5, pace="8:30-9:00", hr_zone=1)],
        [strength_peak_A(), core_circuit("peak")],
        [run_session("intervals", "VO2max intervals", distance_mi=7,
                      pace="1.5mi warmup, 5 x 1000m @ 6:05-6:15/mi w/ 400m jog recovery, 1mi cooldown", hr_zone=5)],
        [strength_peak_B()],
        [run_session("easy", "Easy run", distance_mi=5, pace="7:50-8:20", hr_zone=2)],
        [rest_day()],
        [run_session("long", "Long run w/ goal-pace segment", distance_mi=13,
                      pace=f"Easy 7:30-8:00, miles 8-11 @ goal pace {GOAL_PACE_PER_MI}, easy cooldown",
                      hr_zone=2, details="Practice race-day fueling on this run - whatever you plan to use on Nov 1.")],
    ],
)

# ---- Week 11 (Oct 12-18) - Peak 3 (begin taper transition) ----------------------
add_week(
    11, "peak", "Peak - Weeks 9-11", "Last real quality week, volume starts easing",
    27,
    [
        "Last hard week. Sharpen, don't strain - if anything feels off, this is the week to back off, not "
        "grind through, since there's no more time to recover a setback before the taper needs to start.",
    ],
    [
        [run_session("recovery", "Recovery run", distance_mi=3, pace="8:30-9:00", hr_zone=1)],
        [strength_peak_A()],
        [run_session("tempo", "Race-pace intervals", distance_mi=6.5,
                      pace=f"1.5mi warmup, 2 x 2mi @ {GOAL_PACE_PER_MI} w/ 3min jog recovery, 1mi cooldown",
                      hr_zone=4)],
        [strength_peak_B()],
        [run_session("easy", "Easy run", distance_mi=4.5, pace="7:50-8:20", hr_zone=2)],
        [rest_day()],
        [run_session("long", "Long run", distance_mi=10, pace="7:30-8:00, last 1mi @ goal pace", hr_zone=2)],
    ],
)

# ---- Week 12 (Oct 19-25) - Taper 1 -----------------------------------------------
add_week(
    12, "taper", "Taper - Weeks 12-13", "Volume drops ~35%, keep short touches of race pace",
    20,
    [
        "Taper starts now. The fitness is already there - this block is about arriving on Nov 1 rested, not "
        "about squeezing out more gains. Trust the volume drop.",
    ],
    [
        [run_session("recovery", "Recovery run", distance_mi=3, pace="8:30-9:00", hr_zone=1)],
        [strength_taper()],
        [run_session("tempo", "Short race-pace touch", distance_mi=5,
                      pace=f"1mi warmup, 2mi @ {GOAL_PACE_PER_MI}, 1mi cooldown", hr_zone=4,
                      details="Short and sharp - the point is confidence, not fitness.")],
        [rest_day()],
        [run_session("easy", "Easy run + strides", distance_mi=4, pace="7:50-8:20", hr_zone=2,
                      details="4 x 20s strides.")],
        [rest_day()],
        [run_session("long", "Long run (reduced)", distance_mi=7, pace="7:30-8:00", hr_zone=2)],
    ],
)

# ---- Week 13 (Oct 26-Nov 1) - Race week ------------------------------------------
add_week(
    13, "taper", "Taper - Weeks 12-13", "Race week",
    11.1,
    [
        "Race week. Everything here is about staying loose and well-rested, not training. Sleep and easy "
        "carb-forward eating matter more this week than any workout does.",
        "Goal: 1:28:00 (6:43/mi). Go out at or a few seconds slower than goal pace through 5K, settle in "
        "through halfway, and only spend what's left in the final 3 miles.",
    ],
    [
        [run_session("easy", "Easy run", distance_mi=3, pace="7:50-8:20", hr_zone=2)],
        [rest_day()],
        [run_session("shakeout", "Easy + strides", distance_mi=3, pace="Easy, 4 x 20s strides", hr_zone=2)],
        [rest_day()],
        [run_session("shakeout", "Shakeout", distance_mi=2, pace="Easy, 3 x 15s strides @ goal pace")],
        [rest_day(note="Travel/logistics day if needed. Legs up, hydrate, lay out race kit.")],
        [run_session("race", "CAMBRIDGE HALF MARATHON", distance_mi=13.10938,
                      pace=f"Goal {GOAL_PACE_PER_MI}/mi (1:28:00)",
                      details="You've done the work. Trust the pacing plan and go get it.")],
    ],
)

plan = {
    "generated_at": dt.datetime.utcnow().isoformat() + "Z",
    "athlete": ATHLETE,
    "weeks": WEEKS,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(plan, indent=2))
total_miles = sum(w["target_miles"] for w in WEEKS)
print(f"Wrote {OUT} - {len(WEEKS)} weeks, {total_miles:.1f} planned miles total")
