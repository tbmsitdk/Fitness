import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase, upsertWellness } from '@/lib/db';

/**
 * POST /api/apple-health-sync
 *
 * Called daily by an iOS Shortcut to push one day's Apple Health data.
 * Accepts a flat JSON object (not an array) — easier to build in Shortcuts.
 * Uses COALESCE upsert, so existing Garmin data is never overwritten by null.
 *
 * Body (all fields except `date` are optional):
 * {
 *   "date":        "YYYY-MM-DD",   // required
 *   "steps":       8234,
 *   "resting_hr":  52,
 *   "hrv_rmssd":   42.5,
 *   "sleep_hours": 7.25,
 *   "weight_kg":   74.5,
 *   "vo2max":      48.2
 * }
 *
 * Auth: Authorization: Bearer <SYNC_SECRET>
 * If SYNC_SECRET is not set, the endpoint is open (dev mode).
 */

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const date = String(body.date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'Missing or invalid `date` field (expected YYYY-MM-DD)' },
      { status: 400 }
    );
  }

  // Sleep: Shortcuts returns minutes (duration type), we store hours.
  // Accept either sleep_hours (already converted) or sleep_minutes (raw).
  let sleepHours: number | null = num(body.sleep_hours);
  if (sleepHours === null) {
    const sleepMin = num(body.sleep_minutes);
    if (sleepMin !== null && sleepMin > 0) {
      sleepHours = Math.round((sleepMin / 60) * 100) / 100;
    }
  }
  // Sanity-check: reject implausible values (Shortcuts can return seconds on some iOS versions)
  if (sleepHours !== null && sleepHours > 24) {
    sleepHours = Math.round((sleepHours / 3600) * 100) / 100; // was seconds
  }
  if (sleepHours !== null && (sleepHours <= 0 || sleepHours > 18)) {
    sleepHours = null; // discard garbage
  }

  // Weight: Apple Health returns kg on metric iPhones, lbs on imperial.
  // Accept weight_kg (already in kg) or weight_lb (converted here).
  let weightKg: number | null = num(body.weight_kg);
  if (weightKg === null) {
    const weightLb = num(body.weight_lb);
    if (weightLb !== null && weightLb > 0) {
      weightKg = Math.round(weightLb * 0.453592 * 10) / 10;
    }
  }

  const record = {
    date,
    steps:        num(body.steps) !== null ? Math.round(num(body.steps)!) : null,
    resting_hr:   num(body.resting_hr) !== null ? Math.round(num(body.resting_hr)!) : null,
    hrv_rmssd:    num(body.hrv_rmssd),
    sleep_hours:  sleepHours,
    sleep_score:  num(body.sleep_score) !== null ? Math.round(num(body.sleep_score)!) : null,
    stress_score: num(body.stress_score),
    body_battery: num(body.body_battery),
    weight_kg:    weightKg,
    vo2max:       num(body.vo2max),
    fitness_age:  num(body.fitness_age) !== null ? Math.round(num(body.fitness_age)!) : null,
  };

  // At least one metric must be present (otherwise nothing to sync)
  const hasData = Object.entries(record)
    .filter(([k]) => k !== 'date')
    .some(([, v]) => v !== null);

  if (!hasData) {
    return NextResponse.json(
      { error: 'No health metrics provided — send at least one field' },
      { status: 400 }
    );
  }

  try {
    await initializeDatabase();
    await upsertWellness([record]);
    return NextResponse.json({ ok: true, date, synced: record });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[apple-health-sync] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
