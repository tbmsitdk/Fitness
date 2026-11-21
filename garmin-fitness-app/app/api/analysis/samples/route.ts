import { NextRequest, NextResponse } from 'next/server';
import { loadSamplesFor } from '@/lib/activity-detail-db';
import { sampleCsvRows } from '@/lib/activity-detail';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

// The runner fetches the raw samples of ONE activity at a time, so no single
// response approaches Vercel's body limit. It carries a full activity's heart rate
// and power, so it FAILS CLOSED like the other runner routes.
function bearerOk(req: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

// GET /api/analysis/samples?id=123  ->  CSV rows (no header) for that activity
export async function GET(req: NextRequest) {
  if (!bearerOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  try {
    const { rows } = await sql`SELECT date, activity_type FROM activities WHERE id = ${id}`;
    if (!rows[0]) return NextResponse.json({ error: 'No such activity' }, { status: 404 });
    const start = rows[0].date instanceof Date ? rows[0].date.toISOString() : String(rows[0].date);
    const csv = sampleCsvRows({ id, start, type: String(rows[0].activity_type) }, await loadSamplesFor(id)).join('\n');
    return new NextResponse(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('[analysis/samples] GET', e);
    return NextResponse.json({ error: 'Could not read the samples' }, { status: 500 });
  }
}
