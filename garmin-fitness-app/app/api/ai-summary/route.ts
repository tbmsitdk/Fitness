import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { sql } from '@vercel/postgres';
import { generateWeeklySummary } from '@/lib/ai';
import { coerceActivity, coerceWellness } from '@/lib/db';
import { coerceNutritionLog } from '@/lib/nutrition';
import { coerceTravelLog } from '@/lib/travel';
import { coerceExerciseLog } from '@/lib/exercises';
import { AISummary } from '@/types';
import type { UserSettings } from '@/lib/settings';
import { buildRawTablesWithin, rawDataPromptSection } from '@/lib/raw-data';
import { loadMemorySection, recordAdvice } from '@/lib/coach-memory-db';
import { loadExperimentsSection } from '@/lib/experiments-db';
import { listMeals } from '@/lib/meals-db';
import { homeDayAndTime } from '@/lib/raw-data';

export const dynamic = 'force-dynamic';
// The report now reads raw daily rows as well as the aggregates, and Fable 5.2
// always thinks first. Streaming inside generateWeeklySummary keeps the
// connection alive; this is the ceiling for the whole function.
export const maxDuration = 300;

// Ceiling for the raw rows sent with the report (~4 chars per token). The
// history is trimmed by date, oldest first, until it fits.
const RAW_DATA_TOKEN_BUDGET = 200_000;

const CACHE_KEY = 'ai-weekly-summary';
const CACHE_TTL = 60 * 60 * 24; // 24 hours

async function buildSummary(userSettings?: UserSettings) {
  // 90 days of activities + wellness — enough for meaningful analysis without timeout risk
  const actCutoff  = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
  const wellCutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();

  const [actResult, wellResult, ftpResult, exerciseResult, nutritionResult, travelResult,
         allActResult, allWellResult, allExerciseResult, allNutritionResult] = await Promise.all([
    sql`SELECT * FROM activities WHERE date >= ${actCutoff} ORDER BY date`,
    sql`SELECT * FROM wellness WHERE date >= ${wellCutoff} ORDER BY date`,
    sql`SELECT ftp_watts FROM ftp_entries ORDER BY date DESC LIMIT 1`,
    sql`SELECT id, date::text, exercise_key, sets, reps, duration_seconds, load_kg,
               vital_capacity_l, inspiratory_strength, expiratory_strength, notes
        FROM exercise_logs WHERE date >= ${actCutoff.slice(0, 10)} ORDER BY date`,
    sql`SELECT *, date::text AS day FROM nutrition_logs WHERE date >= ${actCutoff.slice(0, 10)} ORDER BY date`,
    // SELECT * deliberately: three hand-written column lists had drifted, and
      // this one still predated multi-stop support — so the coach saw a
      // Delhi-only trip and called the flight home 4.5 zones west instead of 7,
      // never having received the Singapore stop or the zone names.
      // coerceTravelLog decides what is actually read.
      sql`SELECT * FROM travel_logs ORDER BY depart_date`,
    // Full history for the raw-data tables. The 90-day queries above feed the
    // aggregates, which are tuned to that window; these feed the rows the
    // model reads directly.
    sql`SELECT * FROM activities ORDER BY date`,
    sql`SELECT * FROM wellness ORDER BY date`,
    sql`SELECT id, date::text, exercise_key, sets, reps, duration_seconds, load_kg,
               vital_capacity_l, inspiratory_strength, expiratory_strength, notes
        FROM exercise_logs ORDER BY date`,
    sql`SELECT *, date::text AS day FROM nutrition_logs ORDER BY date`,
  ]);

  const activities = actResult.rows.map(coerceActivity);
  const wellness   = wellResult.rows.map(coerceWellness);
  const manualFtpWatts: number | null = ftpResult.rows[0]?.ftp_watts ? Number(ftpResult.rows[0].ftp_watts) : null;
  const exerciseLogs = exerciseResult.rows.map(coerceExerciseLog);
  const nutritionLogs = nutritionResult.rows.map(coerceNutritionLog);
  const travelLogs = travelResult.rows.map(coerceTravelLog);

  if (activities.length === 0) {
    throw Object.assign(new Error('No activity data found. Please upload your Garmin export first.'), { status: 404 });
  }

  const raw = buildRawTablesWithin({
    activities:    allActResult.rows.map(coerceActivity),
    wellness:      allWellResult.rows.map(coerceWellness),
    exerciseLogs:  allExerciseResult.rows.map(coerceExerciseLog),
    nutritionLogs: allNutritionResult.rows.map(coerceNutritionLog),
    meals: await listMeals('1970-01-01').catch(() => []),
    travelLogs,
  }, RAW_DATA_TOKEN_BUDGET);
  const windowNote = raw.windowDays === null
    ? 'These tables hold the complete history.'
    : `These tables hold the last ${raw.windowDays} days only; older rows were left out to fit. Do not read the start of the tables as the start of the history.`;
  const rawDataSection = `${rawDataPromptSection(raw.tables)}\n\n${windowNote}`;
  console.log('[ai-summary] raw data', { windowDays: raw.windowDays, approxTokens: raw.tokens });

  const summary = await generateWeeklySummary(
    activities, wellness, userSettings, manualFtpWatts, exerciseLogs, nutritionLogs, travelLogs,
    rawDataSection,
    [
      await loadMemorySection(),
      await loadExperimentsSection(nutritionLogs, homeDayAndTime(new Date().toISOString()).day),
    ].filter(Boolean).join('\n\n') || undefined,
  );
  // So the next report, and the chat, know what was advised and when.
  await recordAdvice('weekly', summary.summary.split('\n')[0], summary.recommendations);
  return summary;
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
