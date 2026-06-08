import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const activityId = Number(id);
    if (!Number.isFinite(activityId)) {
      return NextResponse.json({ error: 'Invalid activity id' }, { status: 400 });
    }

    console.log(`[samples] fetching activityId=${activityId} (type=${typeof activityId})`);
    const result = await sql`
      SELECT elapsed_seconds, hr, power, cadence, lat, lon
      FROM activity_samples
      WHERE activity_id = ${activityId}
      ORDER BY elapsed_seconds ASC
    `;
    console.log(`[samples] activityId=${activityId} raw rows=${result.rows.length}`);
    const samples = result.rows.map(r => ({
      elapsed_seconds: Number(r.elapsed_seconds),
      hr: r.hr != null ? Number(r.hr) : null,
      power: r.power != null ? Number(r.power) : null,
      cadence: r.cadence != null ? Number(r.cadence) : null,
      lat: r.lat != null ? Number(r.lat) : null,
      lon: r.lon != null ? Number(r.lon) : null,
    }));
    return NextResponse.json({ samples });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[samples] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
