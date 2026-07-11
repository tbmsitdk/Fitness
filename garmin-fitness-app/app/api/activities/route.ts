import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { coerceActivity } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '3650'), 1), 3650);
    const sport = searchParams.get('sport');

    const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();

    // Exclude Apple Health duplicate activities (garmin_id like 'ah_%') when a
    // Garmin API activity exists for the same type within ±5 minutes. Apple Health
    // imports create duplicate records alongside Garmin API syncs for the same
    // workouts, but the Garmin records are the ones with per-second sample data.
    let result;
    if (sport) {
      result = await sql`
        SELECT * FROM activities a
        WHERE a.date >= ${cutoff}
          AND a.activity_type = ${sport}
          AND NOT (
            a.garmin_id LIKE 'ah_%'
            AND EXISTS (
              SELECT 1 FROM activities b
              WHERE b.garmin_id NOT LIKE 'ah_%'
                AND b.activity_type = a.activity_type
                AND ABS(EXTRACT(EPOCH FROM (b.date - a.date))) < 300
            )
          )
        ORDER BY a.date ASC
        LIMIT 5000
      `;
    } else {
      result = await sql`
        SELECT * FROM activities a
        WHERE a.date >= ${cutoff}
          AND NOT (
            a.garmin_id LIKE 'ah_%'
            AND EXISTS (
              SELECT 1 FROM activities b
              WHERE b.garmin_id NOT LIKE 'ah_%'
                AND b.activity_type = a.activity_type
                AND ABS(EXTRACT(EPOCH FROM (b.date - a.date))) < 300
            )
          )
        ORDER BY a.date ASC
        LIMIT 5000
      `;
    }

    return NextResponse.json(result.rows.map(coerceActivity));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
