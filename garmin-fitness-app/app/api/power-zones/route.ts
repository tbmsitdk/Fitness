import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

// Coggan 6-zone boundaries as fraction of FTP (upper bounds; Z6 unbounded)
const BOUNDS = [0.55, 0.75, 0.90, 1.05, 1.20];

// Time-in-zone for cycling. Rides WITH per-second samples get true
// sample-based classification (each sample ≈ 10 s); rides without samples
// fall back to dropping their full duration into the zone of their avg power.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ftp = Number(searchParams.get('ftp'));
    const cutoff = searchParams.get('cutoff') ?? new Date(0).toISOString();
    const minPower = Number(searchParams.get('minPower') ?? '0');

    if (!isFinite(ftp) || ftp <= 0) {
      return NextResponse.json({ error: 'Valid ftp param required' }, { status: 400 });
    }

    const [sampleResult, fallbackResult] = await Promise.all([
      // One aggregate pass over all samples of qualifying rides
      sql`
        SELECT
          COUNT(*) FILTER (WHERE s.power::float / ${ftp} <  ${BOUNDS[0]})                                        ::int AS z1,
          COUNT(*) FILTER (WHERE s.power::float / ${ftp} >= ${BOUNDS[0]} AND s.power::float / ${ftp} < ${BOUNDS[1]})::int AS z2,
          COUNT(*) FILTER (WHERE s.power::float / ${ftp} >= ${BOUNDS[1]} AND s.power::float / ${ftp} < ${BOUNDS[2]})::int AS z3,
          COUNT(*) FILTER (WHERE s.power::float / ${ftp} >= ${BOUNDS[2]} AND s.power::float / ${ftp} < ${BOUNDS[3]})::int AS z4,
          COUNT(*) FILTER (WHERE s.power::float / ${ftp} >= ${BOUNDS[3]} AND s.power::float / ${ftp} < ${BOUNDS[4]})::int AS z5,
          COUNT(*) FILTER (WHERE s.power::float / ${ftp} >= ${BOUNDS[4]})                                        ::int AS z6
        FROM activity_samples s
        JOIN activities a ON a.id = s.activity_id
        WHERE a.activity_type = 'cycling'
          AND a.date >= ${cutoff}
          AND (a.avg_power IS NULL OR a.avg_power >= ${minPower})
          AND s.power IS NOT NULL AND s.power > 0
      `,
      // Rides in range that have power but no samples — classify by avg power
      sql`
        SELECT a.avg_power, a.duration_seconds
        FROM activities a
        WHERE a.activity_type = 'cycling'
          AND a.date >= ${cutoff}
          AND a.avg_power > 0 AND a.avg_power >= ${minPower}
          AND a.duration_seconds > 0
          AND NOT EXISTS (
            SELECT 1 FROM activity_samples s
            WHERE s.activity_id = a.id AND s.power IS NOT NULL AND s.power > 0
          )
      `,
    ]);

    const s = sampleResult.rows[0];
    // Samples are stored at ~10 s resolution
    const seconds = [s.z1, s.z2, s.z3, s.z4, s.z5, s.z6].map((c: number) => c * 10);
    const sampledSeconds = seconds.reduce((a, b) => a + b, 0);

    let approxSeconds = 0;
    for (const row of fallbackResult.rows) {
      const pct = Number(row.avg_power) / ftp;
      let zone = BOUNDS.findIndex(b => pct < b);
      if (zone === -1) zone = 5;
      const dur = Number(row.duration_seconds);
      seconds[zone] += dur;
      approxSeconds += dur;
    }

    return NextResponse.json({
      seconds,
      sampledHours: Math.round(sampledSeconds / 360) / 10,
      approxHours: Math.round(approxSeconds / 360) / 10,
    });
  } catch (e) {
    console.error('GET /api/power-zones:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}
