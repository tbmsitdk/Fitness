import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { initializeDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await initializeDatabase();
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
    const limit = 100;
    const offset = (page - 1) * limit;

    // Use createClient() (non-pooling direct connection) to bypass PgBouncer replica
    // routing — the pooled sql`` template can read from a lagged replica, making
    // edits appear to vanish immediately after a PATCH.
    const client = createClient();
    await client.connect();
    const [dataResult, countResult] = await Promise.all([
      client.query(`
        SELECT id, date::text, steps, resting_hr, sleep_hours, sleep_score,
               stress_score, body_battery, weight_kg, vo2max, fitness_age, body_fat_pct,
               muscle_mass_kg, bone_mass_kg, body_water_pct, visceral_fat, metabolic_age,
               hrv_rmssd, flights_climbed, respiratory_rate, walking_asymmetry_pct,
               walking_speed, walking_double_support_pct, oxygen_saturation, mindful_minutes,
               COALESCE(locked_fields, '[]') as locked_fields
        FROM wellness
        ORDER BY date DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]),
      client.query(`SELECT COUNT(*)::int as total FROM wellness`),
    ]);
    await client.end();

    // Postgres DECIMAL columns arrive as strings — convert so the client gets real numbers
    const NUMERIC_FIELDS = [
      'steps', 'resting_hr', 'sleep_hours', 'sleep_score', 'stress_score', 'body_battery',
      'weight_kg', 'vo2max', 'fitness_age', 'body_fat_pct', 'muscle_mass_kg', 'bone_mass_kg',
      'body_water_pct', 'visceral_fat', 'metabolic_age', 'hrv_rmssd', 'flights_climbed',
      'respiratory_rate', 'walking_asymmetry_pct', 'walking_speed', 'walking_double_support_pct',
      'oxygen_saturation', 'mindful_minutes',
    ] as const;
    const records = dataResult.rows.map(row => {
      const out = { ...row };
      for (const f of NUMERIC_FIELDS) out[f] = row[f] != null ? Number(row[f]) : null;
      return out;
    });

    return NextResponse.json(
      {
        records,
        total: countResult.rows[0].total,
        page,
        pages: Math.ceil(countResult.rows[0].total / limit),
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  } catch (e) {
    console.error('GET /api/data/wellness:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}

// POST: create or update a wellness record for a given date, entered manually.
// Only the fields provided are touched — existing values for other fields on
// that date are left alone. Every field the caller sets is locked, same as an
// inline edit, so a later Garmin sync can't silently overwrite a manual entry.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { date: string; fields: Record<string, unknown> };
    const date = body.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Valid date (YYYY-MM-DD) required' }, { status: 400 });
    }

    // Whitelist to prevent SQL injection via field names — every numeric wellness column
    const ALLOWED_FIELDS = new Set([
      'steps', 'resting_hr', 'hrv_rmssd', 'sleep_hours', 'sleep_score',
      'stress_score', 'body_battery', 'weight_kg', 'vo2max', 'fitness_age',
      'body_fat_pct', 'muscle_mass_kg', 'bone_mass_kg', 'body_water_pct',
      'visceral_fat', 'metabolic_age', 'flights_climbed', 'respiratory_rate',
      'walking_asymmetry_pct', 'walking_speed', 'walking_double_support_pct',
      'oxygen_saturation', 'mindful_minutes',
    ]);

    const entries = Object.entries(body.fields ?? {}).filter(
      (e): e is [string, number] =>
        ALLOWED_FIELDS.has(e[0]) && e[1] != null && isFinite(Number(e[1]))
    );
    if (entries.length === 0) {
      return NextResponse.json({ error: 'At least one valid field value is required' }, { status: 400 });
    }

    const client = createClient();
    await client.connect();
    try {
      // Ensure a row exists for this date without clobbering an existing one
      await client.query(`INSERT INTO wellness (date) VALUES ($1) ON CONFLICT (date) DO NOTHING`, [date]);

      const setClauses = entries.map(([field], i) => `${field} = $${i + 1}`);
      const values: (string | number)[] = entries.map(([, v]) => Number(v));
      values.push(date);
      await client.query(
        `UPDATE wellness SET ${setClauses.join(', ')} WHERE date = $${entries.length + 1}`,
        values
      );

      // Lock every field just entered — remove-then-append keeps the array duplicate-free
      const fieldNames = entries.map(([f]) => f);
      await client.query(
        `UPDATE wellness SET locked_fields = (
           (COALESCE(locked_fields,'[]')::jsonb - $1::text[]) || to_jsonb($1::text[])
         )::text WHERE date = $2`,
        [fieldNames, date]
      );

      const { rows } = await client.query(`SELECT id FROM wellness WHERE date = $1`, [date]);
      return NextResponse.json({ ok: true, id: rows[0]?.id ?? null });
    } finally {
      await client.end();
    }
  } catch (e) {
    console.error('POST /api/data/wellness:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}
