import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { initializeDatabase } from '@/lib/db';
import { EXERCISE_KEYS, EXERCISE_NUMERIC_FIELDS } from '@/lib/exercises';

export const dynamic = 'force-dynamic';

// GET /api/exercises?days=365 — logged entries, newest first.
export async function GET(req: NextRequest) {
  const client = createClient();
  try {
    await initializeDatabase();
    const { searchParams } = new URL(req.url);
    const days = Math.min(Math.max(Number(searchParams.get('days') ?? '3650'), 1), 3650);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

    await client.connect();
    const { rows } = await client.query(
      `SELECT id, date::text, exercise_key, sets, reps, duration_seconds, load_kg,
              vital_capacity_l, inspiratory_strength, expiratory_strength, notes
       FROM exercise_logs
       WHERE date >= $1
       ORDER BY date DESC, exercise_key ASC`,
      [cutoff]
    );

    // Postgres DECIMAL columns arrive as strings — coerce to real numbers
    const logs = rows.map(row => {
      const out = { ...row };
      for (const f of EXERCISE_NUMERIC_FIELDS) out[f] = row[f] != null ? Number(row[f]) : null;
      return out;
    });

    return NextResponse.json(
      { logs },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  } catch (e) {
    console.error('GET /api/exercises:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}

interface EntryPayload {
  exercise_key: string;
  notes?: string | null;
  [field: string]: unknown;
}

// POST /api/exercises — upsert one day's entries.
// Body: { date: 'YYYY-MM-DD', entries: [{ exercise_key, reps?, sets?, ... }] }
// An entry whose values are all blank deletes that exercise's row for the day,
// so unchecking something in the form actually removes it.
export async function POST(req: NextRequest) {
  const client = createClient();
  try {
    const body = await req.json() as { date?: string; entries?: EntryPayload[] };
    const date = body.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Valid date (YYYY-MM-DD) required' }, { status: 400 });
    }
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (entries.length === 0) {
      return NextResponse.json({ error: 'At least one entry is required' }, { status: 400 });
    }

    await client.connect();
    let saved = 0;
    let removed = 0;

    for (const entry of entries) {
      if (!EXERCISE_KEYS.has(entry.exercise_key)) continue;

      // Collect the numeric values actually supplied for this exercise
      const fields: string[] = [];
      const values: (number | string | null)[] = [];
      for (const f of EXERCISE_NUMERIC_FIELDS) {
        const raw = entry[f];
        if (raw == null || raw === '') continue;
        const n = Number(raw);
        if (!isFinite(n)) continue;
        fields.push(f);
        values.push(n);
      }
      const notes = typeof entry.notes === 'string' && entry.notes.trim() !== ''
        ? entry.notes.trim()
        : null;

      // Nothing logged for this exercise — clear any existing row for the day
      if (fields.length === 0 && notes == null) {
        const del = await client.query(
          `DELETE FROM exercise_logs WHERE date = $1 AND exercise_key = $2`,
          [date, entry.exercise_key]
        );
        removed += del.rowCount ?? 0;
        continue;
      }

      if (notes != null) { fields.push('notes'); values.push(notes); }

      const cols = ['date', 'exercise_key', ...fields];
      const params = [date, entry.exercise_key, ...values];
      const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
      // Only the supplied columns are overwritten; others keep their value
      const updates = fields.map(f => `${f} = EXCLUDED.${f}`).join(', ');

      await client.query(
        `INSERT INTO exercise_logs (${cols.join(', ')})
         VALUES (${placeholders})
         ON CONFLICT (date, exercise_key) DO UPDATE SET ${updates}`,
        params
      );
      saved++;
    }

    return NextResponse.json({ ok: true, saved, removed });
  } catch (e) {
    console.error('POST /api/exercises:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}

// DELETE /api/exercises?date=YYYY-MM-DD — remove an entire day's log.
export async function DELETE(req: NextRequest) {
  const client = createClient();
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Valid date (YYYY-MM-DD) required' }, { status: 400 });
    }
    await client.connect();
    const res = await client.query(`DELETE FROM exercise_logs WHERE date = $1`, [date]);
    return NextResponse.json({ ok: true, removed: res.rowCount ?? 0 });
  } catch (e) {
    console.error('DELETE /api/exercises:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}
