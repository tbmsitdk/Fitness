import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

// Postgres returns DECIMAL columns as strings — coerce to numbers here
// so all downstream chart/computation code can safely do arithmetic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coerce(row: any) {
  return {
    ...row,
    id:               Number(row.id),
    distance_km:      Number(row.distance_km)      || 0,
    duration_seconds: Number(row.duration_seconds) || 0,
    calories:         Number(row.calories)         || 0,
    avg_hr:           row.avg_hr       != null ? Number(row.avg_hr)       : null,
    max_hr:           row.max_hr       != null ? Number(row.max_hr)       : null,
    training_effect:  row.training_effect != null ? Number(row.training_effect) : null,
    avg_cadence:      row.avg_cadence  != null ? Number(row.avg_cadence)  : null,
    avg_speed_kmh:    row.avg_speed_kmh!= null ? Number(row.avg_speed_kmh): null,
    tss:              row.tss          != null ? Number(row.tss)          : null,
    avg_power:        row.avg_power    != null ? Number(row.avg_power)    : null,
    max_power:        row.max_power    != null ? Number(row.max_power)    : null,
    elevation_gain:   row.elevation_gain != null ? Number(row.elevation_gain) : null,
  };
}

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

    return NextResponse.json(result.rows.map(coerce));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
