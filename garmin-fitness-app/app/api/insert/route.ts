import { NextRequest, NextResponse } from 'next/server';
import { upsertActivities, upsertWellness } from '@/lib/db';

function authorized(req: NextRequest): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { activities = [], wellness = [] } = body as {
      activities: Parameters<typeof upsertActivities>[0];
      wellness: Parameters<typeof upsertWellness>[0];
    };

    let insertedActivities = 0;
    let insertedWellness = 0;

    if (activities.length > 0) {
      console.log(`[insert] upserting ${activities.length} activities`);
      insertedActivities = await upsertActivities(activities);
      console.log(`[insert] done activities: ${insertedActivities}`);
    }

    if (wellness.length > 0) {
      console.log(`[insert] upserting ${wellness.length} wellness records`);
      insertedWellness = await upsertWellness(wellness);
      console.log(`[insert] done wellness: ${insertedWellness}`);
    }

    return NextResponse.json({ insertedActivities, insertedWellness });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[insert] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
