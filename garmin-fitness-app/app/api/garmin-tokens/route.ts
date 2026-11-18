import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
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

export async function GET(req: NextRequest) {
  if (!bearerOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await initializeDatabase();
  try {
    const { rows } = await sql`SELECT token_data, updated_at, NOW() AS now FROM garmin_tokens WHERE id = 'default'`;
    if (rows.length === 0) return NextResponse.json({ token_data: null });
    // updated_at/now let a caller tell a stale row from a fresh one without seeing the value.
    return NextResponse.json({ token_data: rows[0].token_data, updated_at: rows[0].updated_at, now: rows[0].now });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!bearerOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { token_data } = await req.json();
  if (!token_data) return NextResponse.json({ error: 'missing token_data' }, { status: 400 });
  await initializeDatabase();
  const { rows } = await sql`
    INSERT INTO garmin_tokens (id, token_data, updated_at)
    VALUES ('default', ${token_data}, NOW())
    ON CONFLICT (id) DO UPDATE SET token_data = EXCLUDED.token_data, updated_at = NOW()
    RETURNING length(token_data) AS stored_length, updated_at
  `;
  return NextResponse.json({ ok: true, stored_length: rows[0]?.stored_length ?? null, updated_at: rows[0]?.updated_at ?? null });
}
