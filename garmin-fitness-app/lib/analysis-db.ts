// Postgres storage for deep-analysis and monthly-review runs.

import { sql } from '@vercel/postgres';
import type { Fingerprints } from '@/lib/analysis-delta';
import {
  STALE_RUN_MINUTES, WEEKLY_GUARD_DAYS, type AnalysisKind, type AnalysisResult, type AnalysisRun, type AnalysisStatus,
} from '@/lib/analysis';

let ready: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  ready ??= sql`
    CREATE TABLE IF NOT EXISTS analysis_runs (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      question TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      result JSONB,
      reasoning TEXT,
      error TEXT,
      model TEXT
    )
  `.then(() => sql`ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS data_state JSONB`)
   .then(() => sql`ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS built_on INTEGER`)
   .then(() => sql`ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS read_activities JSONB`)
   .then(() => sql`
     CREATE TABLE IF NOT EXISTS activity_notes (
       activity_id INTEGER PRIMARY KEY,
       note TEXT NOT NULL DEFAULT '',
       run_id INTEGER,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`)
   .then(() => undefined, (e) => { ready = null; throw e; });
  return ready;
}

const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRun(r: any, withCharts: boolean): AnalysisRun {
  let result: AnalysisResult | null = r.result ?? null;
  // Runs stored before the cross-check existed have no card_checks.
  if (result && !Array.isArray(result.card_checks)) result = { ...result, card_checks: [] };
  if (result && !Array.isArray(result.activity_notes)) result = { ...result, activity_notes: [] };
  if (result && !withCharts) {
    // Chart bytes are large; the list view only needs to know they exist.
    result = { ...result, charts: (result.charts ?? []).map(c => ({ filename: c.filename, caption: c.caption })) };
  }
  return {
    id: Number(r.id),
    built_on: r.built_on == null ? null : Number(r.built_on),
    kind: (['monthly', 'audit'].includes(r.kind) ? r.kind : 'deep') as AnalysisKind,
    question: r.question ?? null,
    status: r.status as AnalysisStatus,
    requested_at: iso(r.requested_at) ?? '',
    finished_at: iso(r.finished_at),
    result,
    reasoning: r.reasoning ?? null,
    error: r.error ?? null,
    model: r.model ?? null,
  };
}

/** A run stuck in "running" means its runner died. Mark it failed so it stops looking alive. */
async function failStaleRuns(): Promise<void> {
  await sql`
    UPDATE analysis_runs
    SET status = 'failed', finished_at = NOW(),
        error = 'The run did not report back. Check the Coach Analysis workflow log in GitHub Actions.'
    WHERE status = 'running' AND started_at < NOW() - (${STALE_RUN_MINUTES} * INTERVAL '1 minute')
  `;
}

export async function listRuns(limit = 20): Promise<AnalysisRun[]> {
  await ensureTable();
  await failStaleRuns();
  const { rows } = await sql`SELECT * FROM analysis_runs ORDER BY requested_at DESC LIMIT ${limit}`;
  return rows.map(r => toRun(r, false));
}

export async function getRun(id: number): Promise<AnalysisRun | null> {
  await ensureTable();
  const { rows } = await sql`SELECT * FROM analysis_runs WHERE id = ${id}`;
  return rows[0] ? toRun(rows[0], true) : null;
}

export async function countQueued(): Promise<number> {
  await ensureTable();
  const { rows } = await sql`SELECT COUNT(*)::int AS n FROM analysis_runs WHERE status = 'queued'`;
  return Number(rows[0]?.n ?? 0);
}

export async function queueRun(kind: AnalysisKind, question: string | null): Promise<AnalysisRun> {
  await ensureTable();
  const { rows } = await sql`
    INSERT INTO analysis_runs (kind, question) VALUES (${kind}, ${question}) RETURNING *
  `;
  return toRun(rows[0], false);
}

/**
 * Atomically takes the oldest queued run. SKIP LOCKED means two runners
 * started at the same moment can never both claim the same run.
 */
export async function claimNextRun(): Promise<AnalysisRun | null> {
  await ensureTable();
  await failStaleRuns();
  const { rows } = await sql`
    UPDATE analysis_runs SET status = 'running', started_at = NOW()
    WHERE id = (
      SELECT id FROM analysis_runs WHERE status = 'queued'
      ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows[0] ? toRun(rows[0], false) : null;
}

/** Only a run that is actually running can be finished — a late or replayed report changes nothing. */
export async function completeRun(id: number, result: AnalysisResult, reasoning: string | null, model: string | null): Promise<boolean> {
  await ensureTable();
  const { rowCount } = await sql`
    UPDATE analysis_runs
    SET status = 'done', finished_at = NOW(), result = ${JSON.stringify(result)}::jsonb,
        reasoning = ${reasoning}, model = ${model}, error = NULL
    WHERE id = ${id} AND status = 'running'
  `;
  return (rowCount ?? 0) > 0;
}

export async function failRun(id: number, error: string): Promise<boolean> {
  await ensureTable();
  const { rowCount } = await sql`
    UPDATE analysis_runs SET status = 'failed', finished_at = NOW(), error = ${error.slice(0, 1000)}
    WHERE id = ${id} AND status = 'running'
  `;
  return (rowCount ?? 0) > 0;
}

export async function deleteRun(id: number): Promise<boolean> {
  await ensureTable();
  const { rowCount } = await sql`DELETE FROM analysis_runs WHERE id = ${id}`;
  return (rowCount ?? 0) > 0;
}

/** The most recent finished monthly review other than `exceptId`. */
export async function lastMonthlyReview(exceptId?: number): Promise<AnalysisRun | null> {
  await ensureTable();
  const { rows } = await sql`
    SELECT * FROM analysis_runs
    WHERE kind = 'monthly' AND status = 'done' AND id <> ${exceptId ?? -1}
    ORDER BY finished_at DESC LIMIT 1
  `;
  return rows[0] ? toRun(rows[0], false) : null;
}

/** True when a monthly review was already requested this calendar month (UTC). */
export async function monthlyAlreadyRequested(): Promise<boolean> {
  await ensureTable();
  const { rows } = await sql`
    SELECT 1 FROM analysis_runs
    WHERE kind = 'monthly' AND status <> 'failed'
      AND date_trunc('month', requested_at) = date_trunc('month', NOW())
    LIMIT 1
  `;
  return rows.length > 0;
}

/** Records which rows a run saw, and which earlier run it was built on. */
export async function saveDataState(id: number, state: Fingerprints, builtOn: number | null): Promise<void> {
  await ensureTable();
  await sql`UPDATE analysis_runs SET data_state = ${JSON.stringify(state)}::jsonb, built_on = ${builtOn} WHERE id = ${id}`;
}

/**
 * The latest finished general deep analysis (no custom question) that recorded what data it saw.
 * Question runs are not baselines: they answered one thing, not the broad picture.
 */
export async function lastBaselineRun(exceptId: number): Promise<{ run: AnalysisRun; state: Fingerprints } | null> {
  await ensureTable();
  const { rows } = await sql`
    SELECT * FROM analysis_runs
    WHERE kind = 'deep' AND status = 'done' AND question IS NULL AND data_state IS NOT NULL AND id <> ${exceptId}
    ORDER BY finished_at DESC LIMIT 1
  `;
  return rows[0] ? { run: toRun(rows[0], false), state: rows[0].data_state as Fingerprints } : null;
}

/** Remembers which activities a run is reading, so completion can mark them covered. */
export async function saveReadActivities(id: number, ids: number[]): Promise<void> {
  await ensureTable();
  await sql`UPDATE analysis_runs SET read_activities = ${JSON.stringify(ids)}::jsonb WHERE id = ${id}`;
}

/**
 * On a finished run: every activity it read is now covered, with the model's note when it wrote one.
 * Called only after a successful completion, so a failed run leaves its activities to be read again.
 */
export async function recordRead(id: number, notes: { activity_id: number; note: string }[]): Promise<number> {
  await ensureTable();
  const { rows } = await sql`SELECT read_activities FROM analysis_runs WHERE id = ${id}`;
  const ids: number[] = Array.isArray(rows[0]?.read_activities) ? rows[0].read_activities.map(Number) : [];
  const byId = new Map(notes.map(n => [n.activity_id, n.note]));
  for (const activityId of ids) {
    await sql`
      INSERT INTO activity_notes (activity_id, note, run_id) VALUES (${activityId}, ${byId.get(activityId) ?? ''}, ${id})
      ON CONFLICT (activity_id) DO UPDATE SET note = CASE WHEN EXCLUDED.note <> '' THEN EXCLUDED.note ELSE activity_notes.note END,
                                              run_id = EXCLUDED.run_id`;
  }
  return ids.length;
}

export async function coveredActivityIds(): Promise<number[]> {
  await ensureTable();
  const { rows } = await sql`SELECT activity_id FROM activity_notes`;
  return rows.map(r => Number(r.activity_id));
}

/** Notes from earlier runs, newest activity first, capped so the prompt stays small. */
export async function priorNotesText(maxChars = 6000): Promise<string> {
  await ensureTable();
  const { rows } = await sql`
    SELECT n.note, a.date, a.activity_type FROM activity_notes n
    JOIN activities a ON a.id = n.activity_id WHERE n.note <> '' ORDER BY a.date DESC LIMIT 200`;
  const lines: string[] = [];
  let used = 0;
  for (const r of rows) {
    const d = r.date instanceof Date ? r.date.toISOString() : String(r.date);
    const line = `- ${d.slice(0, 10)} ${r.activity_type}: ${r.note}`;
    if (used + line.length > maxChars) break;
    lines.push(line); used += line.length;
  }
  return lines.join('\n');
}

/** How much of the sampled history the analysis has read. */
export async function sampleCoverage(): Promise<{ read: number; total: number }> {
  await ensureTable();
  const { rows } = await sql`
    SELECT (SELECT COUNT(*) FROM activity_notes)::int AS read,
           (SELECT COUNT(DISTINCT activity_id) FROM activity_samples)::int AS total`;
  return { read: Number(rows[0]?.read ?? 0), total: Number(rows[0]?.total ?? 0) };
}

/**
 * True when this weekly kind was already requested in the last few days. Typed-question runs
 * do not count: they answer one thing and must not replace the week's general analysis.
 */
export async function weeklyAlreadyRequested(kind: AnalysisKind): Promise<boolean> {
  await ensureTable();
  const { rows } = await sql`
    SELECT 1 FROM analysis_runs
    WHERE kind = ${kind} AND question IS NULL AND status <> 'failed'
      AND requested_at > NOW() - (${WEEKLY_GUARD_DAYS} * INTERVAL '1 day')
    LIMIT 1
  `;
  return rows.length > 0;
}
