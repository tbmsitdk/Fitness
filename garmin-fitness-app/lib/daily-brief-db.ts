// Postgres storage for the morning brief: one row per day.

import { sql } from '@vercel/postgres';
import type { DailyBrief, StoredBrief } from '@/lib/daily-brief';
import type { EarlyWarning } from '@/lib/early-warning';

let ready: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  ready ??= sql`
    CREATE TABLE IF NOT EXISTS daily_briefs (
      date DATE PRIMARY KEY,
      brief JSONB NOT NULL,
      warning JSONB NOT NULL,
      model TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.then(() => undefined, (e) => { ready = null; throw e; });
  return ready;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toBrief = (r: any): StoredBrief => ({
  date: String(r.date).slice(0, 10),
  brief: r.brief as DailyBrief,
  warning: r.warning as EarlyWarning,
  model: r.model ?? null,
  created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
});

export async function latestBrief(): Promise<StoredBrief | null> {
  await ensureTable();
  const { rows } = await sql`SELECT date::text, brief, warning, model, created_at FROM daily_briefs ORDER BY date DESC LIMIT 1`;
  return rows[0] ? toBrief(rows[0]) : null;
}

export async function briefFor(date: string): Promise<StoredBrief | null> {
  await ensureTable();
  const { rows } = await sql`SELECT date::text, brief, warning, model, created_at FROM daily_briefs WHERE date = ${date}`;
  return rows[0] ? toBrief(rows[0]) : null;
}

export async function saveBrief(date: string, brief: DailyBrief, warning: EarlyWarning, model: string | null): Promise<void> {
  await ensureTable();
  await sql`
    INSERT INTO daily_briefs (date, brief, warning, model, created_at)
    VALUES (${date}, ${JSON.stringify(brief)}::jsonb, ${JSON.stringify(warning)}::jsonb, ${model}, NOW())
    ON CONFLICT (date) DO UPDATE SET brief = EXCLUDED.brief, warning = EXCLUDED.warning,
      model = EXCLUDED.model, created_at = NOW()
  `;
}
