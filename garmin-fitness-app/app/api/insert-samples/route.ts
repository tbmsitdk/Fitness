import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { insertActivitySamples, type ActivitySampleRow } from '@/lib/db';

function authorized(req: NextRequest): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

export const dynamic = 'force-dynamic';

// Daily sync posts: { garmin_id: string, samples: [{ elapsed_seconds, hr, power, cadence }] }
// Looks up the internal activity id by garmin_id and stores the per-second series.
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { garmin_id, samples = [] } = body as { garmin_id: string; samples: ActivitySampleRow[] };

    if (!garmin_id) {
      return NextResponse.json({ error: 'garmin_id is required' }, { status: 400 });
    }
    if (!Array.isArray(samples) || samples.length === 0) {
      return NextResponse.json({ inserted: 0, skipped: 'no samples' });
    }

    const { rows } = await sql`SELECT id FROM activities WHERE garmin_id = ${garmin_id} LIMIT 1`;
    const activityId = rows[0]?.id;
    if (activityId == null) {
      console.log(`[insert-samples] no activity for garmin_id=${garmin_id}`);
      return NextResponse.json({ error: `No activity found for garmin_id ${garmin_id}` }, { status: 404 });
    }

    const activityIdNum = Number(activityId);
    console.log(`[insert-samples] garmin_id=${garmin_id} activityId=${activityIdNum} samples=${samples.length}`);
    const inserted = await insertActivitySamples(activityIdNum, samples);
    // Verify write landed by reading back the count
    const { rows: countRows } = await sql`SELECT COUNT(*)::int AS n FROM activity_samples WHERE activity_id = ${activityIdNum}`;
    const storedCount = countRows[0]?.n ?? -1;
    console.log(`[insert-samples] garmin_id=${garmin_id} inserted=${inserted} storedCount=${storedCount}`);
    return NextResponse.json({ inserted, storedCount });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[insert-samples] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
