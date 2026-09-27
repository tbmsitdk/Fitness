import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { initializeDatabase } from '@/lib/db';
import { coerceNutritionLog } from '@/lib/nutrition';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

/** Null unless a real number was sent — "" and undefined must not become 0. */
function num(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

function timeOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{1,2}:\d{2}$/.test(v)) return null;
  const [h, m] = v.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// GET /api/nutrition?days=365
export async function GET(req: NextRequest) {
  const client = createClient();
  try {
    await initializeDatabase();
    const { searchParams } = new URL(req.url);
    const days = Math.min(Math.max(Number(searchParams.get('days') ?? '3650'), 1), 3650);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

    await client.connect();
    const { rows } = await client.query(
      `SELECT id, date::text, alcohol_units, candy_portions, savoury_snacks, sugary_drinks,
              to_char(last_food_time, 'HH24:MI') AS last_food_time,
              caffeine_after_14, meal_quality, notes
       FROM nutrition_logs
       WHERE date >= $1
       ORDER BY date DESC`,
      [cutoff]
    );
    return NextResponse.json({ logs: rows.map(coerceNutritionLog) }, { headers: NO_STORE });
  } catch (e) {
    console.error('GET /api/nutrition:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * POST /api/nutrition — upsert one day.
 *
 * COALESCE is deliberately NOT used here: clearing a field must actually clear
 * it. The whole day is replaced by what the form sent, so correcting "2 units"
 * back to blank works. The form always sends every field.
 */
export async function POST(req: NextRequest) {
  const client = createClient();
  try {
    await initializeDatabase();
    const body = await req.json();
    const date = typeof body?.date === 'string' ? body.date.slice(0, 10) : null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Valid date required' }, { status: 400 });
    }

    const row = {
      alcohol_units:  num(body.alcohol_units, 0, 60),
      candy_portions: num(body.candy_portions, 0, 40),
      savoury_snacks: num(body.savoury_snacks, 0, 40),
      sugary_drinks:  num(body.sugary_drinks, 0, 40),
      last_food_time: timeOrNull(body.last_food_time),
      caffeine_after_14: body.caffeine_after_14 == null ? null : Boolean(body.caffeine_after_14),
      meal_quality: num(body.meal_quality, 1, 5),
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 500) : null,
    };

    await client.connect();
    await client.query(
      `INSERT INTO nutrition_logs
         (date, alcohol_units, candy_portions, savoury_snacks, sugary_drinks,
          last_food_time, caffeine_after_14, meal_quality, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (date) DO UPDATE SET
         alcohol_units     = EXCLUDED.alcohol_units,
         candy_portions    = EXCLUDED.candy_portions,
         savoury_snacks    = EXCLUDED.savoury_snacks,
         sugary_drinks     = EXCLUDED.sugary_drinks,
         last_food_time    = EXCLUDED.last_food_time,
         caffeine_after_14 = EXCLUDED.caffeine_after_14,
         meal_quality      = EXCLUDED.meal_quality,
         notes             = EXCLUDED.notes,
         updated_at        = NOW()`,
      [date, row.alcohol_units, row.candy_portions, row.savoury_snacks, row.sugary_drinks,
       row.last_food_time, row.caffeine_after_14, row.meal_quality, row.notes]
    );

    return NextResponse.json({ ok: true, date }, { headers: NO_STORE });
  } catch (e) {
    console.error('POST /api/nutrition:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}

// DELETE /api/nutrition?date=YYYY-MM-DD — remove a day entirely (not zero it).
export async function DELETE(req: NextRequest) {
  const client = createClient();
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Valid date required' }, { status: 400 });
    }
    await client.connect();
    await client.query(`DELETE FROM nutrition_logs WHERE date = $1`, [date]);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    console.error('DELETE /api/nutrition:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}
