import { NextResponse } from 'next/server';
import { getRouteCandidates } from '@/lib/db';
import { clusterRoutes } from '@/lib/route-clustering';

export const dynamic = 'force-dynamic';

// Groups historical activities into recurring "routes" by start-location + distance
// fingerprint, then ranks each route's efforts by time — a personal leaderboard.
export async function GET() {
  try {
    const candidates = await getRouteCandidates();
    const clusters = clusterRoutes(candidates);
    return NextResponse.json({ routes: clusters, scanned: candidates.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[routes] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
