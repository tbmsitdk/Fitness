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
               stress_score, body_battery, weight_kg, vo2max, body_fat_pct,
               muscle_mass_kg, bone_mass_kg, body_water_pct, hrv_rmssd,
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
      'weight_kg', 'vo2max', 'body_fat_pct', 'muscle_mass_kg', 'bone_mass_kg', 'body_water_pct', 'hrv_rmssd',
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
