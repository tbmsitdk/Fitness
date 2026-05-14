import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { sql } from '@vercel/postgres';
import { generateWeeklySummary } from '@/lib/ai';
import { Activity, WellnessRecord, AISummary } from '@/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coerceActivity(row: any): Activity {
  return {
    ...row,
    id:               Number(row.id),
    date:             row.date instanceof Date ? row.date.toISOString() : String(row.date),
    distance_km:      Number(row.distance_km)      || 0,
    duration_seconds: Number(row.duration_seconds) || 0,
    calories:         Number(row.calories)         || 0,
    avg_hr:           row.avg_hr        != null ? Number(row.avg_hr)        : null,
    max_hr:           row.max_hr        != null ? Number(row.max_hr)        : null,
    training_effect:  row.training_effect != null ? Number(row.training_effect) : null,
    avg_cadence:      row.avg_cadence   != null ? Number(row.avg_cadence)   : null,
    avg_speed_kmh:    row.avg_speed_kmh != null ? Number(row.avg_speed_kmh) : null,
    tss:              row.tss           != null ? Number(row.tss)           : null,
    avg_power:        row.avg_power     != null ? Number(row.avg_power)     : null,
    max_power:        row.max_power     != null ? Number(row.max_power)     : null,
    elevation_gain:   row.elevation_gain != null ? Number(row.elevation_gain) : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coerceWellness(row: any): WellnessRecord {
  return {
    ...row,
    id:           Number(row.id),
    date:         row.date instanceof Date ? row.date.toISOString() : String(row.date),
    steps:        row.steps        != null ? Number(row.steps)        : null,
    resting_hr:   row.resting_hr   != null ? Number(row.resting_hr)   : null,
    hrv_rmssd:    row.hrv_rmssd    != null ? Number(row.hrv_rmssd)    : null,
    sleep_hours:  row.sleep_hours  != null ? Number(row.sleep_hours)  : null,
    sleep_score:  row.sleep_score  != null ? Number(row.sleep_score)  : null,
    stress_score: row.stress_score != null ? Number(row.stress_score) : null,
    body_battery: row.body_battery != null ? Number(row.body_battery) : null,
  };
}

const CACHE_KEY = 'ai-weekly-summary';
const CACHE_TTL = 60 * 60 * 24; // 24 hours

export async function GET() {
  try {
    // Try KV cache first
    let cached: AISummary | null = null;
    try {
      cached = await kv.get<AISummary>(CACHE_KEY);
    } catch {
      // KV not provisioned — skip cache
    }

    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }

    const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();

    const [actResult, wellResult] = await Promise.all([
      sql`SELECT * FROM activities WHERE date >= ${cutoff} ORDER BY date`,
      sql`SELECT * FROM wellness WHERE date >= ${cutoff} ORDER BY date`,
    ]);

    const activities = actResult.rows.map(coerceActivity);
    const wellness = wellResult.rows.map(coerceWellness);

    if (activities.length === 0) {
      return NextResponse.json(
        { error: 'No activity data found. Please upload your Garmin export first.' },
        { status: 404 }
      );
    }

    const summary = await generateWeeklySummary(activities, wellness);

    try {
      await kv.set(CACHE_KEY, summary, { ex: CACHE_TTL });
    } catch {
      // KV not provisioned — skip caching
    }

    return NextResponse.json({ ...summary, cached: false });
  } catch (error) {
    console.error('AI summary error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await kv.del(CACHE_KEY);
  } catch {
    // KV not provisioned
  }
  return NextResponse.json({ ok: true });
}
