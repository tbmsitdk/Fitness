#!/usr/bin/env python3
"""
Daily Garmin Connect → Fitness App sync.

Fetches the last 2 days of activities and wellness data from Garmin Connect
and upserts them into the app via /api/insert.

Required environment variables:
  GARMIN_EMAIL     — Garmin Connect account email
  GARMIN_PASSWORD  — Garmin Connect account password
  APP_URL          — Base URL of the Vercel deployment (no trailing slash)

Optional:
  SYNC_DAYS        — How many days back to fetch (default: 2)
"""

import json
import os
import sys
from datetime import date, timedelta

import base64
import io
import tarfile
import requests
from garminconnect import Garmin, GarminConnectAuthenticationError

# ── Config ────────────────────────────────────────────────────────────────────

APP_URL         = os.environ["APP_URL"].rstrip("/")
GARMIN_EMAIL    = os.environ.get("GARMIN_EMAIL", "")
GARMIN_PASSWORD = os.environ.get("GARMIN_PASSWORD", "")
GARMIN_TOKENS   = os.environ.get("GARMIN_TOKENS", "")   # base64 token store (preferred)
SYNC_DAYS       = int(os.environ.get("SYNC_DAYS", "2"))

HEADERS = {"Content-Type": "application/json"}

# ── Activity type mapping ─────────────────────────────────────────────────────

_TYPE_MAP = {
    "cycling":            "cycling",
    "road_biking":        "cycling",
    "gravel_cycling":     "cycling",
    "mountain_biking":    "cycling",
    "indoor_cycling":     "cycling",
    "virtual_ride":       "cycling",
    "road_cycling":       "cycling",
    "running":            "running",
    "trail_running":      "running",
    "treadmill_running":  "running",
    "track_running":      "running",
    "walking":            "walking",
    "hiking":             "walking",
    "swimming":           "swimming",
    "lap_swimming":       "swimming",
    "open_water_swimming":"swimming",
    "strength_training":  "strength",
    "fitness_equipment":  "strength",
    "yoga":               "yoga",
    "pilates":            "yoga",
}

def _map_type(type_key: str) -> str:
    key = (type_key or "").lower()
    for k, v in _TYPE_MAP.items():
        if k in key:
            return v
    return "other"

# ── Activity parsing ──────────────────────────────────────────────────────────

def _parse_activities(raw: list) -> list:
    out = []
    for a in raw:
        try:
            type_key  = (a.get("activityType") or {}).get("typeKey", "other")
            distance_m = float(a.get("distance") or 0)
            duration_s = float(a.get("duration") or 0)
            speed_ms   = float(a.get("averageSpeed") or 0)

            cadence = (
                a.get("averageRunningCadenceInStepsPerMinute") or
                a.get("avgBikingCadenceInRevPerMinute") or
                a.get("averageBikingCadenceInRevPerMinute")
            )

            out.append({
                "garmin_id":        str(a["activityId"]),
                "activity_type":    _map_type(type_key),
                "date":             (a.get("startTimeLocal") or "")[:19],
                "title":            a.get("activityName") or type_key,
                "distance_km":      round(distance_m / 1000, 4),
                "duration_seconds": int(duration_s),
                "calories":         int(a.get("calories") or 0),
                "avg_hr":           int(a["averageHR"])        if a.get("averageHR")             else None,
                "max_hr":           int(a["maxHR"])            if a.get("maxHR")                  else None,
                "training_effect":  float(a["aerobicTrainingEffect"]) if a.get("aerobicTrainingEffect") else None,
                "avg_cadence":      int(float(cadence))        if cadence                         else None,
                "avg_speed_kmh":    round(speed_ms * 3.6, 4)  if speed_ms                        else None,
                "tss":              float(a["trainingStressScore"]) if a.get("trainingStressScore") else None,
                "avg_power":        int(a["avgPower"])         if a.get("avgPower")               else None,
                "max_power":        int(a["maxPower"])         if a.get("maxPower")               else None,
                "elevation_gain":   float(a["elevationGain"]) if a.get("elevationGain")          else None,
            })
        except Exception as exc:
            print(f"  ⚠  Skipping activity {a.get('activityId')}: {exc}")
    return out

# ── Wellness parsing ──────────────────────────────────────────────────────────

def _fetch_wellness(api: Garmin, d: date) -> dict:
    ds = d.isoformat()
    rec: dict = {"date": ds}

    # Steps + stress
    try:
        summary = api.get_user_summary(ds)
        if summary:
            steps = summary.get("totalSteps")
            if steps and steps > 0:
                rec["steps"] = int(steps)
            stress = summary.get("averageStressLevel", -1)
            if stress and stress > 0:
                rec["stress_score"] = int(stress)
    except Exception as exc:
        print(f"  ⚠  Steps/stress {ds}: {exc}")

    # Resting HR
    try:
        rhr_data = api.get_rhr_day(ds)
        if rhr_data:
            # Prefer restingHeartRate field if present
            rhr_val = rhr_data.get("restingHeartRate") or rhr_data.get("value")
            if rhr_val and int(rhr_val) > 0:
                rec["resting_hr"] = int(rhr_val)
    except Exception as exc:
        print(f"  ⚠  RHR {ds}: {exc}")

    # HRV
    try:
        hrv = api.get_hrv_data(ds)
        if hrv and hrv.get("hrvSummary"):
            val = (
                hrv["hrvSummary"].get("lastNight") or
                hrv["hrvSummary"].get("weeklyAvg")
            )
            if val and float(val) > 0:
                rec["hrv_rmssd"] = round(float(val), 2)
    except Exception as exc:
        print(f"  ⚠  HRV {ds}: {exc}")

    # Sleep
    try:
        sleep = api.get_sleep_data(ds)
        dto   = (sleep or {}).get("dailySleepDTO") or {}
        secs  = dto.get("sleepTimeSeconds") or 0
        if secs > 0:
            rec["sleep_hours"] = round(secs / 3600, 2)
            score = ((dto.get("sleepScores") or {}).get("overall") or {}).get("value")
            if score:
                rec["sleep_score"] = int(score)
    except Exception as exc:
        print(f"  ⚠  Sleep {ds}: {exc}")

    # Body battery (daily peak)
    try:
        bb = api.get_body_battery(ds, ds)
        if bb and isinstance(bb, list):
            values_array = (bb[0] or {}).get("bodyBatteryValuesArray") or []
            values = [v[1] for v in values_array if isinstance(v, list) and len(v) > 1 and v[1] is not None]
            if values:
                rec["body_battery"] = int(max(values))
    except Exception as exc:
        print(f"  ⚠  Body battery {ds}: {exc}")

    return rec

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    # ── Login (token-based preferred; falls back to credentials)
    TOKEN_DIR = "/tmp/garmin_token_store"

    if GARMIN_TOKENS:
        print("Logging in with saved tokens…")
        try:
            buf = io.BytesIO(base64.b64decode(GARMIN_TOKENS))
            with tarfile.open(fileobj=buf, mode="r:gz") as tar:
                tar.extractall("/tmp")
            # Pass credentials to constructor (required by garminconnect even with tokenstore),
            # but login() will use the token store and skip password auth.
            api = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
            api.login(TOKEN_DIR)
            print("  ✓ Logged in via saved tokens")
        except Exception as exc:
            print(f"  ✗ Token login failed: {exc}")
            print("    Re-run garmin_mfa_login.py flow to refresh tokens.")
            sys.exit(1)
    else:
        print(f"Logging in to Garmin Connect ({GARMIN_EMAIL})…")
        try:
            api = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
            api.login()
            print("  ✓ Logged in via credentials")
        except GarminConnectAuthenticationError as exc:
            print(f"  ✗ Authentication failed: {exc}")
            sys.exit(1)

    today = date.today()
    start = today - timedelta(days=SYNC_DAYS)

    # ── Activities
    print(f"\nFetching activities {start} → {today}…")
    try:
        raw_acts = api.get_activities_by_date(start.isoformat(), today.isoformat())
        activities = _parse_activities(raw_acts)
        print(f"  ✓ {len(activities)} activities")
    except Exception as exc:
        print(f"  ✗ Failed to fetch activities: {exc}")
        activities = []

    # ── Wellness (one record per day)
    print("\nFetching wellness data…")
    wellness = []
    for i in range(SYNC_DAYS + 1):
        d = start + timedelta(days=i)
        print(f"  {d}…", end=" ", flush=True)
        rec = _fetch_wellness(api, d)
        wellness.append(rec)
        fields = [k for k in rec if k != "date"]
        print(f"({', '.join(fields) or 'no data'})")

    # ── Ensure DB tables exist
    print(f"\nInitialising database…")
    try:
        r = requests.post(f"{APP_URL}/api/init-db", headers=HEADERS, timeout=30)
        r.raise_for_status()
        print("  ✓ DB ready")
    except Exception as exc:
        print(f"  ✗ init-db failed: {exc}")
        sys.exit(1)

    # ── Upsert
    print("Upserting data…")
    try:
        payload = {"activities": activities, "wellness": wellness}
        r = requests.post(
            f"{APP_URL}/api/insert",
            headers=HEADERS,
            json=payload,
            timeout=30,
        )
        r.raise_for_status()
        result = r.json()
        print(
            f"  ✓ {result.get('insertedActivities', 0)} activities, "
            f"{result.get('insertedWellness', 0)} wellness records upserted"
        )
    except Exception as exc:
        print(f"  ✗ Insert failed: {exc}")
        sys.exit(1)

    print("\nSync complete.")


if __name__ == "__main__":
    main()
