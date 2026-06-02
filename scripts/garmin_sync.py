#!/usr/bin/env python3
"""
Daily Garmin Connect → Fitness App sync using python-garminconnect.

garminconnect wraps garth for auth. We split token-loading (disk-only, instant)
from the profile API call (network, rate-limited). Profile failure is NON-FATAL:
activities don't need display_name, wellness methods that require it are skipped.

Required env vars:
  GARMIN_TOKENS  — base64-encoded token store (from garmin_get_tokens.py)
  APP_URL        — base URL of the Vercel deployment

Optional:
  SYNC_DAYS      — days back to fetch (default 2)
"""

import base64, io, os, sys, tarfile, time
from datetime import datetime as _dt

import requests
from garminconnect import Garmin

APP_URL              = os.environ["APP_URL"].rstrip("/")
SYNC_DAYS            = int(os.environ.get("SYNC_DAYS", "2"))
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
            avg_hr_raw = a.get("averageHR") or a.get("avgHR")
            max_hr_raw = a.get("maxHR")
            out.append({
                "garmin_id":         str(a["activityId"]),
                "activity_type":     _map_type(type_key),
                "date":              (a.get("startTimeLocal") or "")[:19],
                "title":             a.get("activityName") or type_key,
                "distance_km":       round(distance_m / 1000, 4),
                "duration_seconds":  int(duration_s),
                "calories":          int(a.get("calories") or 0),
                "avg_hr":            int(avg_hr_raw)                    if avg_hr_raw                       else None,
                "max_hr":            int(max_hr_raw)                    if max_hr_raw                       else None,
                "training_effect":   float(a["aerobicTrainingEffect"])  if a.get("aerobicTrainingEffect")   else None,
                "avg_cadence":       int(float(cadence))                if cadence                           else None,
                "avg_speed_kmh":     round(speed_ms * 3.6, 4)          if speed_ms                          else None,
                "tss":               float(a["trainingStressScore"])    if a.get("trainingStressScore")      else None,
                "avg_power":         int(a["avgPower"])                 if a.get("avgPower")                 else None,
                "max_power":         int(a["maxPower"])                 if a.get("maxPower")                 else None,
                "elevation_gain":    float(a["elevationGain"])          if a.get("elevationGain")            else None,
                "normalized_power":  None,
                "ftp":               None,
            })
        except Exception as exc:
            print(f"  ⚠  Skipping activity {a.get('activityId')}: {exc}")
    return out


def _enrich_power_details(api: Garmin, activities: list) -> None:
    """Fetch NP and FTP from the activity detail endpoint for cycling activities."""
    cycling = [a for a in activities if a["activity_type"] == "cycling" and a.get("avg_power")]
    if not cycling:
        return
    print(f"  Fetching power details for {len(cycling)} cycling activity/activities…")
    for a in cycling:
        try:
            detail = api.connectapi(f"/activity-service/activity/{a['garmin_id']}")
        except Exception:
            continue
        if not detail:
            continue
        dto = detail.get("summaryDTO") or {}
        np  = dto.get("normalizedPower")
        p20 = dto.get("maxPowerTwentyMinutes")
        ftp = int(float(p20) * 0.95) if p20 and float(p20) > 0 else None
        if np and float(np) > 0:
            a["normalized_power"] = int(float(np))
        if ftp:
            a["ftp"] = ftp
            print(f"    {a['title']}: NP={a['normalized_power']}W  FTP~{ftp}W (p20={int(float(p20))}W)")
        else:
            print(f"    {a['title']}: NP={a.get('normalized_power')}W  FTP=None")


# ── Wellness per day ──────────────────────────────────────────────────────────

def _fetch_wellness(api: Garmin, ds: str) -> dict:
    rec: dict = {"date": ds}

    # Daily summary: steps, stress, body battery, RHR
    # get_stats() → get_user_summary() uses api.display_name internally.
    # If display_name is set (login succeeded) this works. Otherwise skip.
    if api.display_name:
        try:
            stats = api.get_stats(ds) or {}
            steps = int(stats.get("totalSteps") or 0)
            if steps > 0:
                rec["steps"] = steps
            stress = int(stats.get("averageStressLevel") or -1)
            if stress > 0:
                rec["stress_score"] = stress
            rhr = int(stats.get("restingHeartRate") or 0)
            if rhr > 0:
                rec["resting_hr"] = rhr
            bb = int(stats.get("bodyBatteryHighestValue") or
                     stats.get("bodyBatteryMostRecentValue") or 0)
            if bb > 0:
                rec["body_battery"] = bb
        except Exception:
            pass

    # HRV — endpoint doesn't require display_name
    try:
        hrv = api.get_hrv_data(ds) or {}
        summary = hrv.get("hrvSummary") or {}
        val = summary.get("lastNight") or summary.get("weeklyAvg")
        if val and float(val) > 0:
            rec["hrv_rmssd"] = round(float(val), 2)
    except Exception:
        pass

    # Sleep — garminconnect resolves display_name internally
    if api.display_name:
        try:
            sleep = api.get_sleep_data(ds) or {}
            dto   = sleep.get("dailySleepDTO") or {}
            secs  = dto.get("sleepTimeSeconds") or 0
            if secs > 0:
                rec["sleep_hours"] = round(secs / 3600, 2)
                score = ((dto.get("sleepScores") or {}).get("overall") or {}).get("value")
                if score:
                    rec["sleep_score"] = int(score)
        except Exception:
            pass

    # VO2max + fitness age
    # Try userstats endpoint first (works for most devices)
    if api.display_name:
        try:
            us = api.connectapi(
                f"/userstats-service/wellness/daily/{api.display_name}",
                params={"fromDate": ds, "untilDate": ds}
            ) or {}
            metrics = (us.get("allMetrics") or {}).get("metricsMap") or {}
            for vo2_key in ("WELLNESS_VO2_MAX", "STAT_VO2_MAX_NO_RUNNING", "STAT_VO2_MAX",
                            "WELLNESS_ACTIVE_VO2_MAX", "STAT_VO2_MAX_CYCLING"):
                vo2_vals = metrics.get(vo2_key) or []
                if vo2_vals:
                    v2 = float(vo2_vals[-1].get("value", 0) or 0)
                    if v2 > 0:
                        rec["vo2max"] = round(v2, 1)
                        break
            for fa_key in ("STAT_FITNESSAGE", "WELLNESS_FITNESSAGE", "STAT_FITNESSAGE_ACTIVE"):
                fa_vals = metrics.get(fa_key) or []
                if fa_vals:
                    fa = int(float(fa_vals[-1].get("value", 0) or 0))
                    if fa > 0:
                        rec["fitness_age"] = fa
                        break
        except Exception as exc:
            print(f"  [warn] userstats VO2/fitness age fetch failed: {exc}")

    # Fallback: try max_metrics endpoint if VO2max still missing
    if "vo2max" not in rec:
        try:
            mm = api.get_max_metrics(ds) or {}
            # get_max_metrics returns a list of dicts with 'generic' key
            if isinstance(mm, list) and mm:
                mm = mm[0]
            generic = mm.get("generic") or {}
            v2 = generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")
            if v2 and float(v2) > 0:
                rec["vo2max"] = round(float(v2), 1)
        except Exception:
            pass

    # Body battery fallback (doesn't need display_name)
    if "body_battery" not in rec:
        try:
            bb_list = api.get_body_battery(ds, ds)
            if bb_list and isinstance(bb_list, list):
                vals = [v[1] for v in (bb_list[0].get("bodyBatteryValuesArray") or [])
                        if isinstance(v, list) and len(v) > 1 and v[1] is not None]
                if vals:
                    rec["body_battery"] = int(max(vals))
        except Exception:
            pass

    return rec


# ── Main ──────────────────────────────────────────────────────────────────────

def _post_sync_log(status, sync_days, activities_synced, wellness_synced, duration_seconds, error_message=None):
    """Non-fatal — sync still counts as done even if logging fails."""
    try:
        requests.post(
            f"{APP_URL}/api/sync-log",
            headers=HEADERS,
            json={
                "status": status,
                "sync_days": sync_days,
                "activities_synced": activities_synced,
                "wellness_synced": wellness_synced,
                "duration_seconds": duration_seconds,
                "error_message": error_message,
            },
            timeout=10,
        )
    except Exception as exc:
        print(f"  ⚠  Could not write sync log ({exc})")


def main():
    from datetime import date, timedelta

    _start = time.time()

    # ── Load token store: try DB first (stays fresh after each sync), fall back to secret
    print("Loading Garmin auth tokens…")

    def _extract_tokens(b64_data: str) -> bool:
        """Extract base64-encoded tarball into TOKEN_DIR. Returns True on success."""
        try:
            buf = io.BytesIO(base64.b64decode(b64_data))
            with tarfile.open(fileobj=buf, mode="r:gz") as tar:
                tar.extractall("/tmp")
            return os.path.exists(TOKEN_DIR)
        except Exception as exc:
            print(f"  ⚠  Failed to extract tokens: {exc}")
            return False

    token_loaded = False

    # 1. Try DB (has the most recently refreshed tokens)
    try:
        r = requests.get(
            f"{APP_URL}/api/garmin-tokens",
            headers=HEADERS,
            timeout=10,
        )
        if r.ok:
            db_token = r.json().get("token_data")
            if db_token:
                if _extract_tokens(db_token):
                    print("  ✓ Tokens loaded from DB (most recent)")
                    token_loaded = True
                else:
                    print("  ⚠  DB tokens corrupt, falling back to secret")
    except Exception as exc:
        print(f"  ⚠  Could not reach token API ({exc}), falling back to secret")

    # 2. Fall back to GARMIN_TOKENS env var (GitHub Secret)
    if not token_loaded:
        garmin_tokens_env = os.environ.get("GARMIN_TOKENS", "")
        if not garmin_tokens_env:
            print("  ✗ No token source available (DB empty and GARMIN_TOKENS not set)")
            sys.exit(1)
        if not _extract_tokens(garmin_tokens_env):
            print(f"  ✗ Token directory not found at {TOKEN_DIR} after extracting secret")
            print("    Re-run the Regenerate Garmin Tokens workflow to refresh.")
            sys.exit(1)
        print("  ✓ Tokens loaded from GitHub Secret")

    # ── Login (loads tokens + fetches profile via SSO, not OAuth exchange)
    # garminconnect 0.3.x uses its own SSO client — no garth, no rate-limited
    # /oauth-service/oauth/exchange/user/2.0 endpoint.
    api = Garmin()
    _LOGIN_WAITS = [30, 60, 120]
    for attempt in range(len(_LOGIN_WAITS) + 1):
        try:
            api.login(tokenstore=TOKEN_DIR)
            print(f"  ✓ Logged in as: {api.display_name}")
            # ── Save refreshed token store back to DB so next run uses up-to-date tokens
            try:
                buf_out = io.BytesIO()
                with tarfile.open(fileobj=buf_out, mode="w:gz") as tar:
                    tar.add(TOKEN_DIR, arcname="garmin_token_store")
                fresh_b64 = base64.b64encode(buf_out.getvalue()).decode()
                r = requests.put(
                    f"{APP_URL}/api/garmin-tokens",
                    headers=HEADERS,
                    json={"token_data": fresh_b64},
                    timeout=10,
                )
                if r.ok:
                    print("  ✓ Refreshed tokens saved to DB")
                else:
                    print(f"  ⚠  Could not save tokens to DB: {r.status_code}")
            except Exception as exc:
                print(f"  ⚠  Token save failed (non-fatal): {exc}")
            break
        except Exception as exc:
            s = str(exc).lower()
            is_429 = "429" in str(exc)
            is_net  = not is_429 and any(k in s for k in ("timed out", "timeout", "connection"))
            if (is_429 or is_net) and attempt < len(_LOGIN_WAITS):
                wait = _LOGIN_WAITS[attempt]
                kind = "rate limited" if is_429 else "network error"
                print(f"  ⚠  {kind} on login (attempt {attempt+1}/{len(_LOGIN_WAITS)+1}), retrying in {wait}s…")
                time.sleep(wait)
            else:
                print(f"  ✗ Login failed: {exc}")
                print("    Token store is likely in the old 0.2.x format.")
                print("    Go to GitHub Actions → 'Regenerate Garmin Tokens' → Run workflow,")
                print("    submit the SMS code at <APP_URL>/garmin-setup, then update GARMIN_TOKENS.")
                sys.exit(1)

    # ── Body composition from Garmin smart scale
    # Extracts weight + fat% + muscle + bone + water + visceral fat + metabolic age per day.
    weight_by_date:    dict[str, float] = {}
    body_comp_by_date: dict[str, dict]  = {}
    fallback_weight_kg: float | None = None
    try:
        today_str = date.today().isoformat()
        start_str = (date.today() - timedelta(days=SYNC_DAYS)).isoformat()
        comp = api.get_body_composition(start_str, today_str) or {}
        entries = comp.get("dateWeightList") or comp.get("totalAverage") or []
        if isinstance(entries, list):
            for entry in entries:
                d = entry.get("calendarDate") or entry.get("date")
                if not d:
                    continue
                w = entry.get("weight")  # grams
                if w:
                    weight_by_date[d] = round(float(w) / 1000, 1)
                # Extract body composition fields (confirmed available on this scale)
                bc: dict = {}
                if entry.get("bodyFat") is not None:
                    bc["body_fat_pct"] = round(float(entry["bodyFat"]), 2)
                if entry.get("muscleMass") is not None:
                    bc["muscle_mass_kg"] = round(float(entry["muscleMass"]) / 1000, 2)
                if entry.get("boneMass") is not None:
                    bc["bone_mass_kg"] = round(float(entry["boneMass"]) / 1000, 3)
                if entry.get("bodyWater") is not None:
                    bc["body_water_pct"] = round(float(entry["bodyWater"]), 2)
                # visceralFat and metabolicAge not available on this scale model
                if bc:
                    body_comp_by_date[d] = bc
        if weight_by_date:
            bc_days = sum(1 for v in body_comp_by_date.values() if v)
            print(f"  ✓ Weight: {len(weight_by_date)} days · Body comp: {bc_days} days with scale data")
        else:
            # Try user-profile static weight as fallback
            prof = api.connectapi("/userprofile-service/userprofile/user-settings") or {}
            weight_g = (prof.get("userData") or {}).get("weight")
            fallback_weight_kg = round(float(weight_g) / 1000, 1) if weight_g else None
            if fallback_weight_kg:
                print(f"  ✓ Weight (profile fallback): {fallback_weight_kg}kg")
    except Exception as exc:
        print(f"  ⚠  Could not fetch body composition ({exc})")

    today = date.today()
    start = today - timedelta(days=SYNC_DAYS)

    # ── Activities
    print(f"\nFetching activities {start} → {today}…")
    try:
        if SYNC_DAYS <= 30:
            # garminconnect paginates automatically
            raw = api.get_activities_by_date(start.isoformat(), today.isoformat()) or []
        else:
            # Use larger page size for big backfills to reduce round-trips
            raw, offset = [], 0
            while True:
                page = api.connectapi(
                    "/activitylist-service/activities/search/activities",
                    params={"startDate": start.isoformat(), "endDate": today.isoformat(),
                            "limit": 100, "start": offset}
                ) or []
                raw.extend(page)
                if len(page) < 100:
                    break
                offset += 100
                time.sleep(0.5)
        activities = _parse_activities(raw)
        print(f"  ✓ {len(activities)} activities")
        _enrich_power_details(api, activities)
        for a in activities:
            if a["activity_type"] == "cycling":
                act_date = (a.get("date") or "")[:10]
                w = weight_by_date.get(act_date) or fallback_weight_kg
                if w:
                    a["weight_kg"] = w
    except Exception as exc:
        print(f"  ✗ Activities fetch failed: {exc}")
        activities = []

    # ── Fetch fitness age (try several endpoints, log results for diagnosis)
    current_fitness_age = None
    # ── Fetch biometric profile (vo2Max + fitness age search)
    print("\n  Fetching biometric profile + fitness age…")
    _profile_vo2max   = None
    current_fitness_age = None
    dn = api.display_name or ""
    try:
        resp = api.connectapi("/userprofile-service/userprofile/personal-information") or {}
        biometric = resp.get("biometricProfile") or {}
        bv2 = biometric.get("vo2Max")
        if bv2 and float(bv2) > 0:
            _profile_vo2max = round(float(bv2), 1)
            print(f"  ✓ VO2max (biometric profile): {_profile_vo2max}")
    except Exception as exc:
        print(f"  ⚠  biometric profile error: {exc}")

    # Try additional fitness age endpoints
    fa_candidates = [
        f"/fitnessage-service/fitnessage/{dn}/profile" if dn else None,
        f"/fitnessage-service/fitnessage/users/{dn}" if dn else None,
        f"/fitnessage-service/fitnessage/users/{dn}/profile" if dn else None,
        f"/userstats-service/stats/fitness/age/{dn}" if dn else None,
        "/fitnessage-service/fitnessage/profile/summary",
        f"/wellness-service/wellness/fitnessage/{dn}" if dn else None,
    ]
    for endpoint in fa_candidates:
        if not endpoint:
            continue
        try:
            r = api.connectapi(endpoint) or {}
            if not r:
                continue
            top_keys = list(r.keys()) if isinstance(r, dict) else []
            # Search for fitness age in response
            for fa_key in ("fitnessAge", "fitnessAgeValue", "currentFitnessAge",
                           "fitnessAgeRounded", "value", "age"):
                fa = r.get(fa_key)
                if fa is not None:
                    try:
                        fv = int(float(fa))
                        if 10 < fv < 100:  # sanity check for an age value
                            current_fitness_age = fv
                            print(f"  ✓ Fitness age: {fv} yrs ({endpoint}, key='{fa_key}')")
                            break
                    except (TypeError, ValueError):
                        pass
            if not current_fitness_age and top_keys:
                print(f"  [debug] {endpoint} → {top_keys}")
            if current_fitness_age:
                break
        except Exception:
            pass  # 404s expected — skip silently

    if not current_fitness_age:
        print("  ⚠  Fitness age: not found via API (Vivosmart 5 limitation)")

    # ── Wellness (one day at a time; batch-flush every 30 days on large backfills)
    print("\nFetching wellness data…")
    wellness = []
    BATCH_UPSERT = 30
    for i in range(SYNC_DAYS + 1):
        d  = start + timedelta(days=i)
        ds = d.isoformat()
        print(f"  {ds}…", end=" ", flush=True)
        rec = _fetch_wellness(api, ds)
        day_weight = weight_by_date.get(ds) or fallback_weight_kg
        if day_weight:
            rec["weight_kg"] = day_weight
        day_bc = body_comp_by_date.get(ds)
        if day_bc:
            rec.update(day_bc)
        if current_fitness_age and "fitness_age" not in rec:
            rec["fitness_age"] = current_fitness_age
        wellness.append(rec)
        fields = [k for k in rec if k != "date"]
        print(f"({', '.join(fields) or 'no data'})")
        if SYNC_DAYS > 7:
            time.sleep(0.3)
        if len(wellness) >= BATCH_UPSERT and SYNC_DAYS > 30:
            r = requests.post(f"{APP_URL}/api/insert", headers=HEADERS,
                              json={"activities": [], "wellness": wellness}, timeout=60)
            if r.ok:
                print(f"  → flushed {len(wellness)} wellness records")
            wellness = []

    # ── Backfill VO2max: use most recent per-day value, fall back to biometric profile
    latest_vo2max = (
        next((r["vo2max"] for r in reversed(wellness) if r.get("vo2max")), None)
        or _profile_vo2max
    )
    if latest_vo2max:
        for rec in wellness:
            if "vo2max" not in rec:
                rec["vo2max"] = latest_vo2max
        print(f"  ✓ VO2max {latest_vo2max} backfilled to all days in window")

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
    acts_synced = result.get('insertedActivities', 0)
    well_synced = result.get('insertedWellness', 0)
    print(f"  ✓ {acts_synced} activities, {well_synced} wellness records upserted")

    duration = int(time.time() - _start)
    _post_sync_log("success", SYNC_DAYS, acts_synced, well_synced, duration)
    print(f"\nSync complete in {duration}s.")


if __name__ == "__main__":
    _t0 = time.time()
    try:
        main()
    except Exception as exc:
        duration = int(time.time() - _t0)
        _post_sync_log("error", SYNC_DAYS, 0, 0, duration, str(exc))
        raise
