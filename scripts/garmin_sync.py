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

import base64, io, json, os, sys, tarfile, time

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
                "garmin_id":         str(a["activityId"]),
                "activity_type":     _map_type(type_key),
                "date":              (a.get("startTimeLocal") or "")[:19],
                "title":             a.get("activityName") or type_key,
                "distance_km":       round(distance_m / 1000, 4),
                "duration_seconds":  int(duration_s),
                "calories":          int(a.get("calories") or 0),
                "avg_hr":            int(a["averageHR"])               if a.get("averageHR")             else None,
                "max_hr":            int(a["maxHR"])                   if a.get("maxHR")                  else None,
                "training_effect":   float(a["aerobicTrainingEffect"]) if a.get("aerobicTrainingEffect") else None,
                "avg_cadence":       int(float(cadence))               if cadence                         else None,
                "avg_speed_kmh":     round(speed_ms * 3.6, 4)         if speed_ms                        else None,
                "tss":               float(a["trainingStressScore"])   if a.get("trainingStressScore")    else None,
                "avg_power":         int(a["avgPower"])                if a.get("avgPower")               else None,
                "max_power":         int(a["maxPower"])                if a.get("maxPower")               else None,
                "elevation_gain":    float(a["elevationGain"])         if a.get("elevationGain")          else None,
                "normalized_power":  None,  # enriched later via activity detail
                "ftp":               None,  # enriched later via activity detail
            })
        except Exception as exc:
            print(f"  ⚠  Skipping activity {a.get('activityId')}: {exc}")
    return out


def _enrich_power_details(client, activities: list) -> None:
    """Fetch NP and FTP from the activity detail endpoint for cycling activities."""
    cycling = [a for a in activities if a["activity_type"] == "cycling" and a.get("avg_power")]
    if not cycling:
        return
    print(f"  Fetching power details for {len(cycling)} cycling activity/activities…")
    for a in cycling:
        detail = _api(client, f"/activity-service/activity/{a['garmin_id']}")
        if not detail:
            continue
        dto = detail.get("summaryDTO") or {}
        np  = dto.get("normalizedPower")
        # Garmin doesn't expose FTP directly in activity detail; estimate from
        # peak 20-minute power using the standard 95% protocol
        p20 = dto.get("maxPowerTwentyMinutes")
        ftp = int(float(p20) * 0.95) if p20 and float(p20) > 0 else None
        if np and float(np) > 0:
            a["normalized_power"] = int(float(np))
        if ftp:
            a["ftp"] = ftp
            print(f"    {a['title']}: NP={a['normalized_power']}W  FTP~{ftp}W (20min×0.95, p20={int(float(p20))}W)")
        else:
            print(f"    {a['title']}: NP={a['normalized_power']}W  FTP=None (no 20min power in this ride)")

def _fetch_ftp_fallback(client, activities: list, display_name: str = "") -> None:
    """Try profile-level endpoints to find the user's current FTP."""
    ftp = None

    # 1. Fitness stats with display_name (garminconnect uses this path)
    for path in (
        f"/fitnessstats-service/fitnessStats/{display_name}" if display_name else None,
        "/fitnessstats-service/fitnessStats",
    ):
        if not path or ftp:
            continue
        stats = _api(client, path)
        if isinstance(stats, list):
            for entry in stats:
                v = (entry.get("value") or entry.get("bikeFtp") or
                     entry.get("functionalThresholdPower"))
                if v and float(v) > 0:
                    ftp = int(float(v)); break
        elif isinstance(stats, dict):
            for key in ("bikeFtp", "functionalThresholdPower", "cyclingFtp", "value"):
                v = stats.get(key)
                if v and float(v) > 0:
                    ftp = int(float(v)); break
        if ftp:
            print(f"  ✓ FTP from {path}: {ftp}W")

    # 2. User settings
    if not ftp:
        profile = _api(client, "/userprofile-service/userprofile/user-settings")
        ud = (profile or {}).get("userData") or profile or {}
        for key in ("cyclingFTPSetting", "cyclingFtp", "bikeFtp", "functionalThresholdPower"):
            val = ud.get(key)
            if val:
                try:
                    v = float(val)
                    if v > 0:
                        ftp = int(v)
                        print(f"  ✓ FTP from user-settings.{key}: {ftp}W")
                        break
                except (TypeError, ValueError):
                    pass

    # 3. Personal record / max metrics
    if not ftp:
        pr = _api(client, f"/personalrecord-service/personalrecord/prs/{display_name}" if display_name else "/personalrecord-service/personalrecord/prs")
        if isinstance(pr, list):
            for rec in pr:
                if "ftp" in str(rec.get("prTypeLabelKey", "")).lower():
                    val = rec.get("value")
                    if val and float(val) > 0:
                        ftp = int(float(val))
                        print(f"  ✓ FTP from PR: {ftp}W")
                        break

    # 4. Max metrics endpoint (used by some garminconnect versions)
    if not ftp:
        mx = _api(client, f"/fitnessstats-service/fitnessStats/{display_name}/maxMetrics" if display_name else None)
        if isinstance(mx, list):
            for m in mx:
                v = m.get("genericVO", {}).get("value") if isinstance(m.get("genericVO"), dict) else None
                if v and "ftp" in str(m.get("fitnessStatType", "")).lower():
                    ftp = int(float(v))
                    print(f"  ✓ FTP from maxMetrics: {ftp}W")
                    break

    if ftp:
        for a in activities:
            if a["activity_type"] == "cycling" and not a.get("ftp"):
                a["ftp"] = ftp
    else:
        print("  ⚠  FTP not found in any profile endpoint")


# ── Garth API helper ──────────────────────────────────────────────────────────

def _api(client, path, params=None, _retries=3):
    """Call Garmin Connect API using garth's authenticated session.
    Retries up to _retries times on 429 rate-limit responses."""
    for attempt in range(_retries):
        try:
            return client.connectapi(path, params=params)
        except Exception as exc:
            if '429' in str(exc) and attempt < _retries - 1:
                wait = 60 * (attempt + 1)   # 60s, then 120s
                print(f"  ⚠  Rate limited (429), waiting {wait}s before retry {attempt + 2}/{_retries}…")
                time.sleep(wait)
            else:
                return None
    return None

# ── Wellness per day ──────────────────────────────────────────────────────────

def _fetch_wellness(client, display_name: str, ds: str) -> dict:
    rec: dict = {"date": ds}

    # Steps + stress + body battery (all in daily summary)
    s = _api(client, f"/usersummary-service/usersummary/daily/{display_name}",
             params={"calendarDate": ds})
    if s:
        if (s.get("totalSteps") or 0) > 0:
            rec["steps"] = int(s["totalSteps"])
        stress = s.get("averageStressLevel", -1) or -1
        if stress > 0:
            rec["stress_score"] = int(stress)
        # Body battery peak is often in the daily summary
        bb_high = s.get("bodyBatteryHighestValue") or s.get("bodyBatteryMostRecentValue")
        if bb_high and int(bb_high) > 0:
            rec["body_battery"] = int(bb_high)

    # RHR
    rhr = _api(client, f"/userstats-service/wellness/daily/{display_name}",
               params={"fromDate": ds, "untilDate": ds})
    if rhr:
        metrics = (rhr.get("allMetrics") or {}).get("metricsMap") or {}
        vals = metrics.get("WELLNESS_RESTING_HEART_RATE") or []
        if vals:
            v = int(vals[-1].get("value", 0) or 0)
            if v > 0:
                rec["resting_hr"] = v

    # HRV (optional — not all devices support it)
    hrv = _api(client, f"/hrv-service/hrv/{ds}")
    if hrv:
        summary = hrv.get("hrvSummary") or {}
        val = summary.get("lastNight") or summary.get("weeklyAvg")
        if val and float(val) > 0:
            rec["hrv_rmssd"] = round(float(val), 2)

    # Sleep
    sleep = _api(client, f"/wellness-service/wellness/dailySleepData/{display_name}",
                 params={"date": ds, "nonSleepBufferMinutes": 60})
    dto = (sleep or {}).get("dailySleepDTO") or {}
    secs = dto.get("sleepTimeSeconds") or 0
    if secs > 0:
        rec["sleep_hours"] = round(secs / 3600, 2)
        score = ((dto.get("sleepScores") or {}).get("overall") or {}).get("value")
        if score:
            rec["sleep_score"] = int(score)

    # Body battery — dedicated endpoint as fallback if not in daily summary
    if "body_battery" not in rec:
        bb = (_api(client, f"/wellness-service/wellness/bodyBattery/valuesByDate/{ds}/{ds}") or
              _api(client, f"/wellness-service/wellness/bodyBattery/{display_name}/valuesByDate/{ds}/{ds}"))
        if bb and isinstance(bb, list) and bb:
            vals = [v[1] for v in (bb[0].get("bodyBatteryValuesArray") or [])
                    if isinstance(v, list) and len(v) > 1 and v[1] is not None]
            if vals:
                rec["body_battery"] = int(max(vals))

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

    # ── Get display name (needed for some endpoints) — retry on 429
    try:
        profile = None
        for attempt in range(3):
            try:
                profile = client.connectapi("/userprofile-service/userprofile/user-settings")
                break
            except Exception as exc:
                if '429' in str(exc) and attempt < 2:
                    wait = 60 * (attempt + 1)
                    print(f"  ⚠  Rate limited on profile fetch, waiting {wait}s…")
                    time.sleep(wait)
                else:
                    raise
        ud = (profile or {}).get("userData") or {}
        # Try multiple fields — Garmin uses displayName or userName depending on account type
        display_name = (ud.get("displayName") or ud.get("userName") or
                        str(ud.get("userId") or ""))
        if not display_name:
            # Fallback: social profile
            try:
                sp = client.connectapi("/userprofile-service/socialProfile")
                display_name = sp.get("displayName") or sp.get("userName") or ""
            except Exception:
                pass
        # Weight in grams → kg
        weight_g = ud.get("weight")
        weight_kg = round(float(weight_g) / 1000, 1) if weight_g else None
        print(f"  ✓ Logged in as: {display_name}  weight: {weight_kg}kg")
    except Exception as exc:
        print(f"  ✗ Could not fetch profile: {exc}")
        sys.exit(1)

    today = date.today()
    start = today - timedelta(days=SYNC_DAYS)

    # ── Activities (paginated — 100 per page)
    print(f"\nFetching activities {start} → {today}…")
    try:
        raw, offset = [], 0
        while True:
            page = client.connectapi(
                "/activitylist-service/activities/search/activities",
                params={"startDate": start.isoformat(), "endDate": today.isoformat(),
                        "limit": 100, "start": offset}
            ) or []
            raw.extend(page)
            if len(page) < 100:
                break
            offset += 100
            time.sleep(0.5)  # avoid rate-limiting on large backfills
        activities = _parse_activities(raw)
        print(f"  ✓ {len(activities)} activities")
        _enrich_power_details(client, activities)
        # Stamp weight_kg onto cycling activities for W/kg (not stored in DB, used by insert API)
        if weight_kg:
            for a in activities:
                if a["activity_type"] == "cycling":
                    a["weight_kg"] = weight_kg
    except Exception as exc:
        print(f"  ✗ Activities fetch failed: {exc}")
        activities = []

    # ── Wellness (batch upsert every 30 days on large backfills)
    print("\nFetching wellness data…")
    wellness = []
    BATCH_UPSERT = 30  # flush to DB every N days to avoid memory issues
    for i in range(SYNC_DAYS + 1):
        d  = start + timedelta(days=i)
        ds = d.isoformat()
        print(f"  {ds}…", end=" ", flush=True)
        rec = _fetch_wellness(client, display_name, ds)
        if weight_kg:
            rec["weight_kg"] = weight_kg
        wellness.append(rec)
        fields = [k for k in rec if k != "date"]
        print(f"({', '.join(fields) or 'no data'})")
        # Throttle on large backfills
        if SYNC_DAYS > 7:
            time.sleep(0.3)
        # Intermediate flush every BATCH_UPSERT days
        if len(wellness) >= BATCH_UPSERT and SYNC_DAYS > 30:
            r = requests.post(f"{APP_URL}/api/insert", headers=HEADERS,
                              json={"activities": [], "wellness": wellness}, timeout=60)
            if r.ok:
                print(f"  → flushed {len(wellness)} wellness records")
            wellness = []

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
