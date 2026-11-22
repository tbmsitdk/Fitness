import { NextRequest, NextResponse } from 'next/server';
import { buildFullContext } from '@/lib/ai';
import { computeDelta, describeDelta, fingerprintTables, MIN_CHANGED_ROWS } from '@/lib/analysis-delta';
import { listBackfillActivities, listSampleActivities, loadActivityDetail } from '@/lib/activity-detail-db';
import { loadCoachData, lastDays } from '@/lib/coach-data';
import { buildRawTables } from '@/lib/raw-data';
import { chooseSampleActivities } from '@/lib/activity-detail';
import { BACKFILL_PER_RUN, reuseUnchanged, sanitiseIncomingResult, summariseForNextReview, summariseForUpdate } from '@/lib/analysis';
import {
  claimNextRun, completeRun, failRun, getRun, lastMonthlyReview, monthlyAlreadyRequested, queueRun, saveDataState, lastBaselineRun, saveReadActivities, recordRead, coveredActivityIds, priorNotesText,
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

/** Everything the runner needs for one run: the raw tables, the aggregates, the claims. */
async function loadBundle(kind: string) {
  const data = await loadCoachData();

  // The files hold the WHOLE history: they go to the sandbox, not into the
  // prompt, so there is no token budget to fit.
  const activityDetail = await loadActivityDetail(data.activities, data.today, data.manualFtpWatts);
  const tables = buildRawTables({ ...data, activityDetail });

  // The aggregates are tuned to a 90-day window, same as the weekly report.
  const aggregates = buildFullContext(
    lastDays(data.activities, 90, data.today), lastDays(data.wellness, 90, data.today), undefined,
    data.manualFtpWatts, lastDays(data.exerciseLogs, 90, data.today),
    lastDays(data.nutritionLogs, 90, data.today), data.travelLogs,
  );

  // For the cross-check: the app's habit and travel claims over the FULL
  // history, which is the widest window the dashboard cards can show.
  let claims: string | null = null;
  if (kind === 'audit') {
    const full = buildFullContext(
      data.activities, data.wellness, undefined, data.manualFtpWatts,
      data.exerciseLogs, data.nutritionLogs, data.travelLogs,
    );
    claims = JSON.stringify({ nutrition: full.nutrition, travel: full.travel }, null, 2);
  }

  return { tables, aggregates, claims, today: data.today };
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
    let run = await claimNextRun();
    if (!run) return new NextResponse(null, { status: 204 });

    try {
      const [bundle, memory, previous] = await Promise.all([
        loadBundle(run.kind),
        loadMemorySection(),
        run.kind === 'monthly' ? lastMonthlyReview(run.id) : Promise.resolve(null),
      ]);

      // A general deep analysis builds on the last one: it is shown only the rows
      // that are new or changed, plus what the last run found.
      let update: Record<string, unknown> | null = null;
      let changeTables: Record<string, string> = {};
      let sampleSince: string | null = null;
      if (run.kind === 'deep') {
        const state = fingerprintTables(bundle.tables);
        const baseline = run.question ? null : await lastBaselineRun(run.id);
        const baselineResult = baseline?.run.result;
        await saveDataState(run.id, state, baseline && baselineResult ? baseline.run.id : null);

        if (baseline && baselineResult) {
          const delta = computeDelta(bundle.tables, baseline.state);
          const previousDate = (baseline.run.finished_at ?? baseline.run.requested_at).slice(0, 10);
          sampleSince = previousDate;
          if (delta.total < MIN_CHANGED_ROWS) {
            // Too little has changed for a new run to say anything new: carry the last one forward.
            await completeRun(run.id, reuseUnchanged(baselineResult, previousDate, delta.total), null, baseline.run.model);
            return NextResponse.json({ skipped: true, reason: 'unchanged', id: run.id });
          }
          changeTables = Object.fromEntries(Object.entries(delta.tables).map(([n, csv]) => [`changes_${n}`, csv]));
          update = {
            previousDate, previousRunId: baseline.run.id,
            previous: summariseForUpdate(baselineResult),
            changes: describeDelta(delta),
            changeFiles: Object.keys(changeTables),
          };
        }
      }

      // Raw 10-second samples: only for activities new since the last analysis, or the newest
      // few when it is a first run or a question. The runner fetches them one activity at a time.
      // A general run (no question) also reads a few older activities no run has read yet, and
      // keeps what it learns; a question run just gets the newest ones and records nothing.
      let sampleActivities: ReturnType<typeof chooseSampleActivities> = [];
      let priorNotes = '';
      if (run.kind === 'deep') {
        const fresh = await listSampleActivities(sampleSince, bundle.today);
        if (run.question) {
          sampleActivities = chooseSampleActivities(fresh, [], undefined, 0);
        } else {
          const covered = await coveredActivityIds();
          const older = await listBackfillActivities(covered, fresh.map(a => a.id), BACKFILL_PER_RUN);
          // New activities are only "new" once; skip any a past run already covered.
          const coveredSet = new Set(covered);
          sampleActivities = chooseSampleActivities(fresh.filter(a => !coveredSet.has(a.id)), older, undefined, BACKFILL_PER_RUN);
          await saveReadActivities(run.id, sampleActivities.map(a => a.id));
          priorNotes = await priorNotesText();
        }
      }

      return NextResponse.json({
        run: { id: run.id, kind: run.kind, question: run.question },
        sampleActivities,
        priorNotes,
        sampleFile: update ? 'changes_activity_samples.csv' : 'activity_samples.csv',
        tables: { ...bundle.tables, ...changeTables },
        update,
        aggregates: bundle.aggregates,
        memory: memory ?? null,
        previousReview: previous?.result ? summariseForNextReview(previous.result) : null,
        claims: bundle.claims,
        today: bundle.today,
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
    if (ok) await recordRead(id, result.activity_notes);
    // The cross-check is about the app's numbers, not advice to the person.
    const stored = ok ? await getRun(id) : null;
    if (stored && stored.kind !== 'audit' && result.next_steps.length > 0) {
      await recordAdvice(stored.kind === 'monthly' ? 'monthly' : 'deep', result.headline, result.next_steps);
    }
    return NextResponse.json({ ok });
  } catch (e) {
    console.error('[analysis/job] POST', e);
    return NextResponse.json({ error: 'Could not store the result' }, { status: 500 });
  }
}
