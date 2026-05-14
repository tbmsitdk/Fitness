import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

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

    let result;
    if (sport) {
      result = await sql`
        SELECT * FROM activities
        WHERE date >= ${cutoff} AND activity_type = ${sport}
        ORDER BY date ASC
        LIMIT 5000
      `;
    } else {
      result = await sql`
        SELECT * FROM activities
        WHERE date >= ${cutoff}
        ORDER BY date ASC
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
