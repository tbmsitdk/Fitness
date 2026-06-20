import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { initializeDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await initializeDatabase();
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
    const limit = 100;
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      sql`
        SELECT id, date::text, steps, resting_hr, sleep_hours, sleep_score,
               stress_score, body_battery, weight_kg, vo2max, body_fat_pct,
               muscle_mass_kg, bone_mass_kg, body_water_pct, hrv_rmssd,
               COALESCE(locked_fields, '[]') as locked_fields
        FROM wellness
        ORDER BY date DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(*)::int as total FROM wellness`,
    ]);

    return NextResponse.json({
      records: dataResult.rows,
      total: countResult.rows[0].total,
      page,
      pages: Math.ceil(countResult.rows[0].total / limit),
    });
  } catch (e) {
    console.error('GET /api/data/wellness:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}
