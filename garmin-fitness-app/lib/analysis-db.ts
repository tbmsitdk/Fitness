// Postgres storage for deep-analysis and monthly-review runs.

import { sql } from '@vercel/postgres';
import {
  STALE_RUN_MINUTES, type AnalysisKind, type AnalysisResult, type AnalysisRun, type AnalysisStatus,
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
  `.then(() => undefined, (e) => { ready = null; throw e; });
  return ready;
}

const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRun(r: any, withCharts: boolean): AnalysisRun {
  let result: AnalysisResult | null = r.result ?? null;
  // Runs stored before the cross-check existed have no card_checks.
  if (result && !Array.isArray(result.card_checks)) result = { ...result, card_checks: [] };
  if (result && !withCharts) {
    // Chart bytes are large; the list view only needs to know they exist.
    result = { ...result, charts: (result.charts ?? []).map(c => ({ filename: c.filename, caption: c.caption })) };
  }
  return {
    id: Number(r.id),
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
