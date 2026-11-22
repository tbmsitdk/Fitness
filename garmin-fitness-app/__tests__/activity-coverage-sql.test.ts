// Runs the SQL shapes the backfill uses against an in-process Postgres (PGlite):
// picking older activities that no run has read, and keeping an earlier note.

import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgIntArray } from '@/lib/activity-detail';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE activities (id INTEGER PRIMARY KEY, date TIMESTAMPTZ, activity_type TEXT, title TEXT);
    CREATE TABLE activity_samples (activity_id INTEGER, elapsed_seconds INTEGER, PRIMARY KEY (activity_id, elapsed_seconds));
    CREATE TABLE activity_notes (activity_id INTEGER PRIMARY KEY, note TEXT NOT NULL DEFAULT '', run_id INTEGER);
  `);
  for (let id = 1; id <= 6; id++) {
    await db.query(`INSERT INTO activities VALUES ($1, $2, 'cycling', $3)`, [id, `2026-0${id}-10T08:00:00Z`, `Ride ${id}`]);
    if (id !== 5) await db.query(`INSERT INTO activity_samples VALUES ($1, 0), ($1, 10)`, [id]); // 5 has no samples
  }
});

const backfill = (skip: number[], limit: number) => db.query<{ id: number }>(`
  SELECT a.id FROM activities a JOIN activity_samples s ON s.activity_id = a.id
  WHERE a.activity_type IN ('running', 'cycling', 'walking') AND NOT (a.id = ANY($1::int[]))
  GROUP BY a.id, a.date ORDER BY a.date DESC LIMIT $2`, [pgIntArray(skip), limit]);

describe('backfill selection', () => {
  it('takes the newest activities with samples that were not read, skipping those without samples', async () => {
    expect((await backfill([], 3)).rows.map(r => r.id)).toEqual([6, 4, 3]);
  });
  it('skips activities already covered or chosen as new', async () => {
    expect((await backfill([6, 4], 3)).rows.map(r => r.id)).toEqual([3, 2, 1]);
  });
  it('works with nothing to skip, and ignores anything that is not a whole number', async () => {
    expect(pgIntArray([])).toBe('{}');
    expect(pgIntArray([1, 2.5, NaN, 3])).toBe('{1,3}');
    expect((await backfill([], 1)).rows).toHaveLength(1);
  });
});

describe('recording what a run read', () => {
  const upsert = (id: number, note: string, run: number) => db.query(`
    INSERT INTO activity_notes (activity_id, note, run_id) VALUES ($1, $2, $3)
    ON CONFLICT (activity_id) DO UPDATE SET note = CASE WHEN EXCLUDED.note <> '' THEN EXCLUDED.note ELSE activity_notes.note END,
                                            run_id = EXCLUDED.run_id`, [id, note, run]);
  const get = async (id: number) => (await db.query<{ note: string; run_id: number }>(`SELECT note, run_id FROM activity_notes WHERE activity_id = $1`, [id])).rows[0];

  it('marks an activity covered even when the model wrote no note', async () => {
    await upsert(6, '', 1);
    expect(await get(6)).toEqual({ note: '', run_id: 1 });
  });
  it('keeps an earlier note when a later run reads it again without one', async () => {
    await upsert(4, 'Three hard blocks.', 1);
    await upsert(4, '', 2);
    expect(await get(4)).toEqual({ note: 'Three hard blocks.', run_id: 2 });
  });
  it('replaces a note with a newer one', async () => {
    await upsert(3, 'old', 1); await upsert(3, 'new', 2);
    expect((await get(3)).note).toBe('new');
  });
  it('excludes covered activities from the next backfill', async () => {
    const covered = (await db.query<{ activity_id: number }>(`SELECT activity_id FROM activity_notes`)).rows.map(r => r.activity_id);
    expect((await backfill(covered, 3)).rows.map(r => r.id)).toEqual([2, 1]);
  });
});
