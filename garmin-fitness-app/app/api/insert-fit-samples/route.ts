import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { parseFitSamples } from '@/lib/fit-parser';
import { insertActivitySamples } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Accepts a single raw .fit file (binary body) plus an `X-Garmin-Id` header,
// parses it server-side (where Buffer/Node APIs are available), and stores the
// down-sampled per-second series for the matching activity.
//
// This is the same-origin alternative to the old "upload whole ZIP to Blob
// storage, then process server-side" flow — it sidesteps any browser ↔ Blob
// storage connectivity issues (CORS/extensions/VPNs) by routing everything
// through our own API, file-by-file, entirely within Vercel's request size limits
// (individual .fit files are typically well under a megabyte).
export async function POST(request: NextRequest) {
  try {
    const garminId = request.headers.get('x-garmin-id');
    if (!garminId) {
      return NextResponse.json({ error: 'Missing X-Garmin-Id header' }, { status: 400 });
    }

    const arrayBuffer = await request.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'Empty file body' }, { status: 400 });
    }

    const { rows } = await sql`SELECT id FROM activities WHERE garmin_id = ${garminId} LIMIT 1`;
    const activityId = rows[0]?.id;
    if (activityId == null) {
      return NextResponse.json({ error: `No activity found for garmin_id ${garminId}` }, { status: 404 });
    }

    const samples = await parseFitSamples(Buffer.from(arrayBuffer));
    const inserted = await insertActivitySamples(Number(activityId), samples);
    return NextResponse.json({ inserted, samples: samples.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[insert-fit-samples] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
