import { NextRequest, NextResponse } from 'next/server';
import { db } from '@vercel/postgres';
import { initializeDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

function bearerOk(req: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  // FAIL CLOSED. This used to `return true` when SYNC_SECRET was unset, so a
  // missing or mistyped env var in Vercel silently made the route public —
  // and for /api/garmin-tokens that means handing out live Garmin session
  // tokens, which is full takeover of an account holding far more than this
  // app does. An unset secret is a misconfiguration, not permission.
  if (!secret) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

export async function GET() {
  await initializeDatabase();
  const client = await db.connect();
  try {
    const { rows } = await client.query(`
      SELECT id, synced_at, status, sync_days,
             activities_synced, wellness_synced, error_message, duration_seconds
      FROM sync_log
      ORDER BY synced_at DESC
      LIMIT 10
    `);
    return NextResponse.json({ logs: rows });
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest) {
  if (!bearerOk(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  await initializeDatabase();
  const client = await db.connect();
  try {
    await client.query(
      `INSERT INTO sync_log (status, sync_days, activities_synced, wellness_synced, error_message, duration_seconds)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        body.status ?? 'success',
        body.sync_days ?? null,
        body.activities_synced ?? 0,
        body.wellness_synced ?? 0,
        body.error_message ?? null,
        body.duration_seconds ?? null,
      ]
    );
    return NextResponse.json({ ok: true });
  } finally {
    client.release();
  }
}
