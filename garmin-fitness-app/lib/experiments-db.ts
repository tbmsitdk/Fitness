// Postgres storage for personal experiments.

import { sql } from '@vercel/postgres';
import {
  adherence, cleanRule, experimentsPromptSection, type Experiment, type ExperimentRule, type ExperimentStatus,
} from '@/lib/experiments';
import type { NutritionLog } from '@/lib/nutrition';

let ready: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  ready ??= sql`
    CREATE TABLE IF NOT EXISTS experiments (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      hypothesis TEXT NOT NULL DEFAULT '',
      rule JSONB NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      checkins JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.then(() => undefined, (e) => { ready = null; throw e; });
  return ready;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toExperiment(r: any): Experiment | null {
  const rule = cleanRule(r.rule);
  if (!rule) return null; // a row whose rule cannot be read is not shown as an experiment
  const checkins: Record<string, boolean> = {};
  for (const [day, done] of Object.entries(r.checkins ?? {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof done === 'boolean') checkins[day] = done;
  }
  return {
    id: Number(r.id),
    title: String(r.title),
    hypothesis: String(r.hypothesis ?? ''),
    rule,
    start_date: String(r.start_date).slice(0, 10),
    end_date: String(r.end_date).slice(0, 10),
    status: (['active', 'completed', 'abandoned'].includes(r.status) ? r.status : 'abandoned') as ExperimentStatus,
    checkins,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}


/**
 * All experiments, newest first. An active experiment whose end date has
 * passed is marked completed here, so nothing stays "active" forever.
 */
export async function listExperiments(today: string): Promise<Experiment[]> {
  await ensureTable();
  await sql`UPDATE experiments SET status = 'completed' WHERE status = 'active' AND end_date < ${today}`;
  const { rows } = await sql`
    SELECT id, title, hypothesis, rule, start_date::text, end_date::text, status, checkins, created_at
    FROM experiments ORDER BY start_date DESC, id DESC LIMIT 50
  `;
  return rows.map(toExperiment).filter((e): e is Experiment => e !== null);
}

export async function hasActiveExperiment(today: string): Promise<boolean> {
  return (await listExperiments(today)).some(e => e.status === 'active');
}

export async function createExperiment(e: {
  title: string; hypothesis: string; rule: ExperimentRule; start_date: string; end_date: string;
}): Promise<number> {
  await ensureTable();
  const { rows } = await sql`
    INSERT INTO experiments (title, hypothesis, rule, start_date, end_date)
    VALUES (${e.title}, ${e.hypothesis}, ${JSON.stringify(e.rule)}::jsonb, ${e.start_date}, ${e.end_date})
    RETURNING id
  `;
  return Number(rows[0].id);
}

/** Records a manual yes/no for one day. The date is validated by the caller. */
export async function setCheckin(id: number, day: string, done: boolean): Promise<boolean> {
  await ensureTable();
  const { rowCount } = await sql`
    UPDATE experiments
    SET checkins = checkins || ${JSON.stringify({ [day]: done })}::jsonb
    WHERE id = ${id} AND ${day} BETWEEN start_date AND end_date
  `;
  return (rowCount ?? 0) > 0;
}

/** Ends an active experiment early. Ending today keeps the days done so far for the comparison. */
export async function endExperiment(id: number, status: 'completed' | 'abandoned', today: string): Promise<boolean> {
  await ensureTable();
  const { rowCount } = await sql`
    UPDATE experiments
    SET status = ${status}, end_date = LEAST(end_date, GREATEST(start_date, ${today}::date))
    WHERE id = ${id} AND status = 'active'
  `;
  return (rowCount ?? 0) > 0;
}

export async function deleteExperiment(id: number): Promise<boolean> {
  await ensureTable();
  const { rowCount } = await sql`DELETE FROM experiments WHERE id = ${id}`;
  return (rowCount ?? 0) > 0;
}

/** Experiments as a prompt section for the coach. Never throws; empty when there are none. */
export async function loadExperimentsSection(nutritionLogs: NutritionLog[], today: string): Promise<string> {
  try {
    const list = await listExperiments(today);
    return experimentsPromptSection(list.map(exp => ({ exp, adherence: adherence(exp, nutritionLogs, today) })), today);
  } catch (e) {
    console.error('[experiments] could not load', e);
    return '';
  }
}
