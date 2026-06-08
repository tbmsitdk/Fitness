import { NextRequest, NextResponse } from 'next/server';
import { upsertActivities, upsertWellness } from '@/lib/db';

// NOTE: deliberately NOT gated by SYNC_SECRET — this endpoint is called both by the
// automated Garmin sync (which sends the bearer token) AND directly from the browser
// during a manual ZIP upload (Upload.tsx), which cannot safely hold that secret.
// Gating it would lock out the browser upload flow whenever SYNC_SECRET is configured.

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
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
