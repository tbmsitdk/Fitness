import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { sql } from '@vercel/postgres';
import { generateWeeklySummary } from '@/lib/ai';
import { coerceActivity, coerceWellness } from '@/lib/db';
import { coerceExerciseLog } from '@/lib/exercises';
import { AISummary } from '@/types';
import type { UserSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_KEY = 'ai-weekly-summary';
const CACHE_TTL = 60 * 60 * 24; // 24 hours

async function buildSummary(userSettings?: UserSettings) {
  // 90 days of activities + wellness — enough for meaningful analysis without timeout risk
  const actCutoff  = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
  const wellCutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();

  const [actResult, wellResult, ftpResult, exerciseResult] = await Promise.all([
    sql`SELECT * FROM activities WHERE date >= ${actCutoff} ORDER BY date`,
    sql`SELECT * FROM wellness WHERE date >= ${wellCutoff} ORDER BY date`,
    sql`SELECT ftp_watts FROM ftp_entries ORDER BY date DESC LIMIT 1`,
    sql`SELECT id, date::text, exercise_key, sets, reps, duration_seconds, load_kg,
               vital_capacity_l, inspiratory_strength, expiratory_strength, notes
        FROM exercise_logs WHERE date >= ${actCutoff.slice(0, 10)} ORDER BY date`,
  ]);

  const activities = actResult.rows.map(coerceActivity);
  const wellness   = wellResult.rows.map(coerceWellness);
  const manualFtpWatts: number | null = ftpResult.rows[0]?.ftp_watts ? Number(ftpResult.rows[0].ftp_watts) : null;
  const exerciseLogs = exerciseResult.rows.map(coerceExerciseLog);

  if (activities.length === 0) {
    throw Object.assign(new Error('No activity data found. Please upload your Garmin export first.'), { status: 404 });
  }

  return generateWeeklySummary(activities, wellness, userSettings, manualFtpWatts, exerciseLogs);
}

// POST — called from AICoach with optional settings
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { settings } = body as { settings?: UserSettings };

    // Skip cache when custom settings are provided (personalised analysis)
    if (!settings) {
      let cached: AISummary | null = null;
      try { cached = await kv.get<AISummary>(CACHE_KEY); } catch { /* KV not provisioned */ }
      if (cached) return NextResponse.json({ ...cached, cached: true });
    }

    const summary = await buildSummary(settings);

    if (!settings) {
      try { await kv.set(CACHE_KEY, summary, { ex: CACHE_TTL }); } catch { /* KV not provisioned */ }
    }

    return NextResponse.json({ ...summary, cached: false });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status ?? 500;
    console.error('[ai-summary]', status, msg);
    return NextResponse.json({ error: msg }, { status });
  }
}

// GET — legacy / direct URL access (no settings context)
export async function GET() {
  try {
    let cached: AISummary | null = null;
    try { cached = await kv.get<AISummary>(CACHE_KEY); } catch { /* KV not provisioned */ }
    if (cached) return NextResponse.json({ ...cached, cached: true });

    const summary = await buildSummary();
    try { await kv.set(CACHE_KEY, summary, { ex: CACHE_TTL }); } catch { /* KV not provisioned */ }
    return NextResponse.json({ ...summary, cached: false });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status ?? 500;
    console.error('[ai-summary]', status, msg);
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE() {
  try { await kv.del(CACHE_KEY); } catch { /* KV not provisioned */ }
  return NextResponse.json({ ok: true });
}
