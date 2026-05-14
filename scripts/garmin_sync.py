#!/usr/bin/env python3
"""
Daily Garmin Connect → Fitness App sync using garth directly.

Uses saved OAuth tokens (no login call, no MFA, no IP rate-limit issue).
garth loads the token store and makes authenticated calls with the bearer
token. If the access token is expired, garth refreshes it silently using
the refresh token — no credentials or MFA needed.

Required env vars:
  GARMIN_TOKENS  — base64-encoded token store (from garmin_mfa_login.py)
  APP_URL        — base URL of the Vercel deployment

Optional:
  SYNC_DAYS      — days back to fetch (default 2)
"""

import base64, io, json, os, sys, tarfile

import requests

GARMIN_TOKENS = os.environ["GARMIN_TOKENS"]
APP_URL       = os.environ["APP_URL"].rstrip("/")
SYNC_DAYS     = int(os.environ.get("SYNC_DAYS", "2"))
SYNC_SECRET          = os.environ.get("SYNC_SECRET", "")
VERCEL_BYPASS_SECRET = os.environ.get("VERCEL_BYPASS_SECRET", "")

TOKEN_DIR = "/tmp/garmin_token_store"
HEADERS   = {"Content-Type": "application/json"}
if SYNC_SECRET:
    HEADERS["Authorization"] = f"Bearer {SYNC_SECRET}"
if VERCEL_BYPASS_SECRET:
    HEADERS["x-vercel-protection-bypass"] = VERCEL_BYPASS_SECRET

# ── Activity type normalisation ───────────────────────────────────────────────

_TYPE_MAP = {
    "cycling": "cycling", "road_biking": "cycling", "gravel_cycling": "cycling",
    "mountain_biking": "cycling", "indoor_cycling": "cycling",
    "virtual_ride": "cycling", "road_cycling": "cycling",
    "running": "running", "trail_running": "running",
    "treadmill_running": "running", "track_running": "running",
    "walking": "walking", "hiking": "walking",
    "swimming": "swimming", "lap_swimming": "swimming",
    "open_water_swimming": "swimming",
    "strength_training": "strength", "fitness_equipment": "strength",
    "yoga": "yoga", "pilates": "yoga",
}

def _map_type(type_key: str) -> str:
    k = (type_key or "").lower()
    for key, val in _TYPE_MAP.items():
        if key in k:
            return val
    return "other"

# ── Activity parsing ──────────────────────────────────────────────────────────

def _parse_activities(raw: list) -> list:
    out = []
    for a in raw:
        try:
            type_key   = (a.get("activityType") or {}).get("typeKey", "other")
            distance_m = float(a.get("distance") or 0)
            duration_s = float(a.get("duration") or 0)
            speed_ms   = float(a.get("averageSpeed") or 0)
            cadence    = (a.get("averageRunningCadenceInStepsPerMinute") or
                          a.get("avgBikingCadenceInRevPerMinute") or
                          a.get("averageBikingCadenceInRevPerMinute"))
            out.append({
                "garmin_id":        str(a["activityId"]),
                "activity_type":    _map_type(type_key),
                "date":             (a.get("startTimeLocal") or "")[:19],
                "title":            a.get("activityName") or type_key,
                "distance_km":      round(distance_m / 1000, 4),
                "duration_seconds": int(duration_s),
                "calories":         int(a.get("calories") or 0),
                "avg_hr":           int(a["averageHR"])             if a.get("averageHR")             else None,
                "max_hr":           int(a["maxHR"])                 if a.get("maxHR")                  else None,
                "training_effect":  float(a["aerobicTrainingEffect"]) if a.get("aerobicTrainingEffect") else None,
                "avg_cadence":      int(float(cadence))             if cadence                         else None,
                "avg_speed_kmh":    round(speed_ms * 3.6, 4)       if speed_ms                        else None,
                "tss":              float(a["trainingStressScore"]) if a.get("trainingStressScore")    else None,
                "avg_power":        int(a["avgPower"])              if a.get("avgPower")               else None,
                "max_power":        int(a["maxPower"])              if a.get("maxPower")               else None,
                "elevation_gain":   float(a["elevationGain"])       if a.get("elevationGain")          else None,
            })
        except Exception as exc:
            print(f"  ⚠  Skipping activity {a.get('activityId')}: {exc}")
    return out

# ── Garth API helper ──────────────────────────────────────────────────────────

def _api(client, path, params=None):
    """Call Garmin Connect API using garth's authenticated session."""
    try:
        return client.connectapi(path, params=params)
    except Exception:
        return None

# ── Wellness per day ──────────────────────────────────────────────────────────

def _fetch_wellness(client, display_name: str, ds: str) -> dict:
    rec: dict = {"date": ds}

    # Steps + stress
    try:
        s = _api(client, f"/usersummary-service/usersummary/daily/{display_name}",
                 params={"calendarDate": ds})
        if s:
            if (s.get("totalSteps") or 0) > 0:
                rec["steps"] = int(s["totalSteps"])
            stress = s.get("averageStressLevel", -1) or -1
            if stress > 0:
                rec["stress_score"] = int(stress)
    except Exception as exc:
        print(f"  ⚠  Steps/stress {ds}: {exc}")

    # RHR
    try:
        rhr = _api(client, f"/userstats-service/wellness/daily/{display_name}",
                   params={"fromDate": ds, "untilDate": ds})
        if rhr and rhr.get("allMetrics", {}).get("metricsMap", {}).get("WELLNESS_RESTING_HEART_RATE"):
            vals = rhr["allMetrics"]["metricsMap"]["WELLNESS_RESTING_HEART_RATE"]
            if vals:
                rec["resting_hr"] = int(vals[-1].get("value", 0)) or None
    except Exception as exc:
        print(f"  ⚠  RHR {ds}: {exc}")

    # HRV
    try:
        hrv = _api(client, f"/hrv-service/hrv/{ds}")
        if hrv and hrv.get("hrvSummary"):
            val = hrv["hrvSummary"].get("lastNight") or hrv["hrvSummary"].get("weeklyAvg")
            if val and float(val) > 0:
                rec["hrv_rmssd"] = round(float(val), 2)
    except Exception as exc:
        print(f"  ⚠  HRV {ds}: {exc}")

    # Sleep
    try:
        sleep = _api(client, f"/wellness-service/wellness/dailySleepData/{display_name}",
                     params={"date": ds, "nonSleepBufferMinutes": 60})
        dto = (sleep or {}).get("dailySleepDTO") or {}
        secs = dto.get("sleepTimeSeconds") or 0
        if secs > 0:
            rec["sleep_hours"] = round(secs / 3600, 2)
            score = ((dto.get("sleepScores") or {}).get("overall") or {}).get("value")
            if score:
                rec["sleep_score"] = int(score)
    except Exception as exc:
        print(f"  ⚠  Sleep {ds}: {exc}")

    # Body battery
    try:
        bb = _api(client, f"/wellness-service/wellness/bodyBattery/valuesByDate/{ds}/{ds}")
        if bb and isinstance(bb, list) and bb:
            vals = [v[1] for v in (bb[0].get("bodyBatteryValuesArray") or [])
                    if isinstance(v, list) and len(v) > 1 and v[1] is not None]
            if vals:
                rec["body_battery"] = int(max(vals))
    except Exception as exc:
        print(f"  ⚠  Body battery {ds}: {exc}")

    return rec

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    from datetime import date, timedelta
    import garth

    # ── Load tokens from base64 store
    print("Loading Garmin auth tokens…")
    buf = io.BytesIO(base64.b64decode(GARMIN_TOKENS))
    with tarfile.open(fileobj=buf, mode="r:gz") as tar:
        tar.extractall("/tmp")

    if not os.path.exists(TOKEN_DIR):
        print(f"  ✗ Token directory not found at {TOKEN_DIR}")
        sys.exit(1)

    client = garth.Client()
    client.load(TOKEN_DIR)
    print("  ✓ Tokens loaded")

    # ── Get display name (needed for some endpoints)
    try:
        profile = client.connectapi("/userprofile-service/userprofile/user-settings")
        display_name = (profile.get("userData") or {}).get("displayName") or ""
        print(f"  ✓ Logged in as: {display_name}")
    except Exception as exc:
        print(f"  ✗ Could not fetch profile: {exc}")
        sys.exit(1)

    today = date.today()
    start = today - timedelta(days=SYNC_DAYS)

    # ── Activities
    print(f"\nFetching activities {start} → {today}…")
    try:
        raw = client.connectapi(
            "/activitylist-service/activities/search/activities",
            params={"startDate": start.isoformat(), "endDate": today.isoformat(),
                    "limit": 100, "start": 0}
        ) or []
        activities = _parse_activities(raw)
        print(f"  ✓ {len(activities)} activities")
    except Exception as exc:
        print(f"  ✗ Activities fetch failed: {exc}")
        activities = []

    # ── Wellness
    print("\nFetching wellness data…")
    wellness = []
    for i in range(SYNC_DAYS + 1):
        d  = start + timedelta(days=i)
        ds = d.isoformat()
        print(f"  {ds}…", end=" ", flush=True)
        rec = _fetch_wellness(client, display_name, ds)
        wellness.append(rec)
        fields = [k for k in rec if k != "date"]
        print(f"({', '.join(fields) or 'no data'})")

    # ── Ensure DB tables exist
    print("\nInitialising database…")
    r = requests.post(f"{APP_URL}/api/init-db", headers=HEADERS, timeout=30)
    r.raise_for_status()
    print("  ✓ DB ready")

    # ── Upsert
    print("Upserting data…")
    r = requests.post(f"{APP_URL}/api/insert", headers=HEADERS,
                      json={"activities": activities, "wellness": wellness}, timeout=30)
    r.raise_for_status()
    result = r.json()
    print(f"  ✓ {result.get('insertedActivities', 0)} activities, "
          f"{result.get('insertedWellness', 0)} wellness records upserted")
    print("\nSync complete.")


if __name__ == "__main__":
    main()
