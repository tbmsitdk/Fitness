import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { buildMaxHrLookup } from '@/lib/hr-zones';
import { computeHRZoneDistribution, HR_ZONES } from '@/lib/training-load';
import { Activity, HRZoneData } from '@/types';

export const dynamic = 'force-dynamic';

const YEAR_MS = 365 * 86400 * 1000;

// Time-in-HR-zone. Activities WITH per-second HR samples get true sample-based
// classification (each sample ≈ 10 s) against the rolling measured max HR at
// that activity's date; activities without samples fall back to the avg-HR
// approximation from computeHRZoneDistribution.
export async function GET(req: NextRequest) {
  const client = createClient();
  try {
    const { searchParams } = new URL(req.url);
    const cutoff = searchParams.get('cutoff') ?? new Date(0).toISOString();
    const fallback = Number(searchParams.get('fallback') ?? '190');
    const sport = searchParams.get('sport'); // optional filter, e.g. 'walking'

    await client.connect();

    // Max-HR readings need to reach back a year before the cutoff so the
    // rolling window is populated for the oldest activity in range.
    const hrCutoff = new Date(Math.max(0, new Date(cutoff).getTime() - YEAR_MS)).toISOString();

    const sportFilter = sport ? `AND a.activity_type = $2` : '';
    const baseParams: unknown[] = sport ? [cutoff, sport] : [cutoff];

    const [readingsRes, sampledActsRes, approxActsRes] = await Promise.all([
      client.query(
        `SELECT date, max_hr FROM activities WHERE max_hr IS NOT NULL AND date >= $1`,
        [hrCutoff]
      ),
      // Activities in range that have HR samples
      client.query(
        `SELECT a.id, a.date
         FROM activities a
         WHERE a.date >= $1 ${sportFilter}
           AND EXISTS (SELECT 1 FROM activity_samples s WHERE s.activity_id = a.id AND s.hr IS NOT NULL AND s.hr > 0)`,
        baseParams
      ),
      // Activities in range with avg HR but no samples — approximation fallback
      client.query(
        `SELECT a.date, a.avg_hr, a.duration_seconds
         FROM activities a
         WHERE a.date >= $1 ${sportFilter}
           AND a.avg_hr IS NOT NULL AND a.duration_seconds > 0
           AND NOT EXISTS (SELECT 1 FROM activity_samples s WHERE s.activity_id = a.id AND s.hr IS NOT NULL AND s.hr > 0)`,
        baseParams
      ),
    ]);

    const maxHrFor = buildMaxHrLookup(
      readingsRes.rows.map(r => ({ date: (r.date as Date).toISOString(), max_hr: Number(r.max_hr) })),
      fallback
    );

    // Sample-based: one aggregate pass, joining each activity to its rolling max HR
    const seconds = new Array(5).fill(0);
    let sampledSeconds = 0;
    if (sampledActsRes.rows.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [];
      sampledActsRes.rows.forEach((a, i) => {
        values.push(`($${i * 2 + 1}::int, $${i * 2 + 2}::float)`);
        params.push(Number(a.id), maxHrFor((a.date as Date).toISOString()));
      });

      const { rows } = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE s.hr::float / m.mhr < 0.60)::int AS z1,
           COUNT(*) FILTER (WHERE s.hr::float / m.mhr >= 0.60 AND s.hr::float / m.mhr < 0.70)::int AS z2,
           COUNT(*) FILTER (WHERE s.hr::float / m.mhr >= 0.70 AND s.hr::float / m.mhr < 0.80)::int AS z3,
           COUNT(*) FILTER (WHERE s.hr::float / m.mhr >= 0.80 AND s.hr::float / m.mhr < 0.90)::int AS z4,
           COUNT(*) FILTER (WHERE s.hr::float / m.mhr >= 0.90)::int AS z5
         FROM activity_samples s
         JOIN (VALUES ${values.join(',')}) AS m(id, mhr) ON m.id = s.activity_id
         WHERE s.hr IS NOT NULL AND s.hr > 0`,
        params
      );
      const r = rows[0];
      [r.z1, r.z2, r.z3, r.z4, r.z5].forEach((c: number, i: number) => { seconds[i] += c * 10; });
      sampledSeconds = seconds.reduce((s, v) => s + v, 0);
    }

    // Approximation fallback for sample-less activities
    let approxSeconds = 0;
    if (approxActsRes.rows.length > 0) {
      const pseudo = approxActsRes.rows.map(r => ({
        date: (r.date as Date).toISOString(),
        avg_hr: Number(r.avg_hr),
        duration_seconds: Number(r.duration_seconds),
        activity_type: 'x',
      })) as unknown as Activity[];
      approxSeconds = pseudo.reduce((s, a) => s + a.duration_seconds, 0);
      const approx = computeHRZoneDistribution(pseudo, maxHrFor);
      approx.forEach((z, i) => { seconds[i] += z.minutes * 60; });
    }

    const total = seconds.reduce((s, v) => s + v, 0) || 1;
    const zones: HRZoneData[] = HR_ZONES.map((z, i) => ({
      zone: z.zone,
      minutes: Math.round(seconds[i] / 60),
      percentage: Math.round((seconds[i] / total) * 100),
    }));

    return NextResponse.json({
      zones,
      sampledHours: Math.round(sampledSeconds / 360) / 10,
      approxHours: Math.round(approxSeconds / 360) / 10,
    });
  } catch (e) {
    console.error('GET /api/hr-zones:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}
