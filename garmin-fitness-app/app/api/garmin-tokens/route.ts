import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { initializeDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

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

/**
 * Run one statement on a connection opened just for this request.
 *
 * A write was confirmed (stored_length and a fresh updated_at), yet the next read
 * returned the previous run's tokens with a database clock a minute behind: the
 * shared pooled connection was serving an old snapshot. A token that cannot be read
 * back is a token the daily sync would also read stale, so never share a connection here.
 */
async function withFreshClient<T>(run: (c: ReturnType<typeof createClient>) => Promise<T>): Promise<T> {
  const client = createClient({ connectionString: process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function GET(req: NextRequest) {
  if (!bearerOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await initializeDatabase();
  try {
    const { rows } = await withFreshClient(c =>
      c.query(`SELECT token_data, updated_at, clock_timestamp() AS now FROM garmin_tokens WHERE id = 'default'`));
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
  try {
    const { rows } = await withFreshClient(c => c.query(
      `INSERT INTO garmin_tokens (id, token_data, updated_at)
       VALUES ('default', $1, NOW())
       ON CONFLICT (id) DO UPDATE SET token_data = EXCLUDED.token_data, updated_at = NOW()
       RETURNING length(token_data) AS stored_length, updated_at`, [token_data]));
    return NextResponse.json({ ok: true, stored_length: rows[0]?.stored_length ?? null, updated_at: rows[0]?.updated_at ?? null });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
