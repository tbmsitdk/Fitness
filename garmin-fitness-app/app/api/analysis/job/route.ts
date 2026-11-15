import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { buildFullContext } from '@/lib/ai';
import { coerceActivity, coerceWellness } from '@/lib/db';
import { coerceNutritionLog } from '@/lib/nutrition';
import { coerceTravelLog } from '@/lib/travel';
import { coerceExerciseLog } from '@/lib/exercises';
import { buildRawTables } from '@/lib/raw-data';
import { sanitiseIncomingResult, summariseForNextReview } from '@/lib/analysis';
import {
  claimNextRun, completeRun, failRun, lastMonthlyReview, monthlyAlreadyRequested, queueRun,
} from '@/lib/analysis-db';
import { loadMemorySection, recordAdvice } from '@/lib/coach-memory-db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Called only by scripts/run-analysis.ts from GitHub Actions. It hands out the
// user's entire health history, so it FAILS CLOSED: an unset secret is a
// misconfiguration, not permission.
function bearerOk(req: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

/** Everything the runner needs for one run: the raw tables, the aggregates, the memory. */
async function loadBundle() {
  const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
  const [actResult, wellResult, ftpResult, exerciseResult, nutritionResult, travelResult] = await Promise.all([
    sql`SELECT * FROM activities ORDER BY date`,
    sql`SELECT * FROM wellness ORDER BY date`,
    sql`SELECT ftp_watts FROM ftp_entries ORDER BY date DESC LIMIT 1`,
    sql`SELECT id, date::text, exercise_key, sets, reps, duration_seconds, load_kg,
               vital_capacity_l, inspiratory_strength, expiratory_strength, notes
        FROM exercise_logs ORDER BY date`,
    sql`SELECT id, date::text, alcohol_units, candy_portions, savoury_snacks, sugary_drinks,
               to_char(last_food_time, 'HH24:MI') AS last_food_time,
               caffeine_after_14, meal_quality, notes
        FROM nutrition_logs ORDER BY date`,
    // SELECT * deliberately — see tasks/lessons.md 14 (one table, one read path).
    sql`SELECT * FROM travel_logs ORDER BY depart_date`,
  ]);

  const activities = actResult.rows.map(coerceActivity);
  const wellness = wellResult.rows.map(coerceWellness);
  const exerciseLogs = exerciseResult.rows.map(coerceExerciseLog);
  const nutritionLogs = nutritionResult.rows.map(coerceNutritionLog);
  const travelLogs = travelResult.rows.map(coerceTravelLog);
  const manualFtpWatts = ftpResult.rows[0]?.ftp_watts ? Number(ftpResult.rows[0].ftp_watts) : null;

  // The files hold the WHOLE history: they go to the sandbox, not into the
  // prompt, so there is no token budget to fit.
  const tables = buildRawTables({ activities, wellness, exerciseLogs, nutritionLogs, travelLogs });

  // The aggregates are tuned to a 90-day window, same as the weekly report.
  const recent = <T extends { date: string }>(rows: T[]) => rows.filter(r => r.date >= cutoff.slice(0, 10));
  const aggregates = buildFullContext(
    recent(activities), recent(wellness), undefined, manualFtpWatts,
    recent(exerciseLogs), recent(nutritionLogs), travelLogs,
  );

  return { tables, aggregates };
}

// GET /api/analysis/job?schedule=monthly
//   Claims the next queued run and returns it with its data. With
//   schedule=monthly, first queues this month's review if there is none yet.
//   204 when there is nothing to do.
export async function GET(req: NextRequest) {
  if (!bearerOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    if (req.nextUrl.searchParams.get('schedule') === 'monthly' && !(await monthlyAlreadyRequested())) {
      await queueRun('monthly', null);
    }
    const run = await claimNextRun();
    if (!run) return new NextResponse(null, { status: 204 });

    try {
      const [bundle, memory, previous] = await Promise.all([
        loadBundle(),
        loadMemorySection(),
        run.kind === 'monthly' ? lastMonthlyReview(run.id) : Promise.resolve(null),
      ]);
      return NextResponse.json({
        run: { id: run.id, kind: run.kind, question: run.question },
        tables: bundle.tables,
        aggregates: bundle.aggregates,
        memory: memory ?? null,
        previousReview: previous?.result ? summariseForNextReview(previous.result) : null,
        today: new Date().toISOString().slice(0, 10),
      });
    } catch (e) {
      // The run was claimed but its data could not be built: release it as
      // failed rather than leave it "running" with nobody working on it.
      await failRun(run.id, 'Could not load the data for this run.');
      throw e;
    }
  } catch (e) {
    console.error('[analysis/job] GET', e);
    return NextResponse.json({ error: 'Could not prepare the run' }, { status: 500 });
  }
}

// POST /api/analysis/job { id, result, reasoning, model } | { id, error }
export async function POST(req: NextRequest) {
  if (!bearerOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as {
      id?: unknown; result?: unknown; reasoning?: unknown; model?: unknown; error?: unknown;
    };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    if (typeof body.error === 'string') {
      return NextResponse.json({ ok: await failRun(id, body.error) });
    }

    let result;
    try {
      result = sanitiseIncomingResult(body.result);
    } catch (e) {
      await failRun(id, `The runner sent a result that could not be read: ${e instanceof Error ? e.message : String(e)}`);
      return NextResponse.json({ error: 'Unreadable result' }, { status: 400 });
    }

    const ok = await completeRun(
      id, result,
      typeof body.reasoning === 'string' ? body.reasoning.slice(0, 20_000) : null,
      typeof body.model === 'string' ? body.model.slice(0, 80) : null,
    );
    if (ok && result.next_steps.length > 0) {
      const kind = (await lastMonthlyReview())?.id === id ? 'monthly' : 'deep';
      await recordAdvice(kind, result.headline, result.next_steps);
    }
    return NextResponse.json({ ok });
  } catch (e) {
    console.error('[analysis/job] POST', e);
    return NextResponse.json({ error: 'Could not store the result' }, { status: 500 });
  }
}
