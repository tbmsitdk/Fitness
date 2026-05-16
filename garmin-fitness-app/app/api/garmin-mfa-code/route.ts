import { NextRequest, NextResponse } from 'next/server';
import { db } from '@vercel/postgres';
import { initializeDatabase } from '@/lib/db';

/**
 * POST /api/garmin-mfa-code     { code: "123456" }
 *   Stores the 6-digit SMS MFA code so the GitHub Actions token-regen
 *   workflow can pick it up. Public — no auth — because the user can't
 *   easily attach a secret from their phone. Race is acceptable: the
 *   workflow only consumes the code when it has just asked Garmin to
 *   send the SMS, and the code only works for that login attempt.
 *
 * GET /api/garmin-mfa-code      Authorization: Bearer <SYNC_SECRET>
 *   Returns the most recently submitted code if it's < 10 minutes old.
 *   Used by the workflow only — auth-gated to prevent code-harvesting.
 *
 * DELETE /api/garmin-mfa-code   Authorization: Bearer <SYNC_SECRET>
 *   Clears any pending code (workflow calls this on completion).
 */

export const dynamic = 'force-dynamic';

function bearerOk(req: NextRequest): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return true;
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  let body: { code?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const code = String(body.code ?? '').trim();
  if (!/^\d{4,8}$/.test(code)) {
    return NextResponse.json(
      { error: 'Code must be 4–8 digits' }, { status: 400 }
    );
  }

  await initializeDatabase();
  const client = await db.connect();
  try {
    await client.query(
      `INSERT INTO mfa_pending (id, code, created_at)
       VALUES ('default', $1, NOW())
       ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, created_at = NOW()`,
      [code]
    );
  } finally {
    client.release();
  }
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  if (!bearerOk(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await initializeDatabase();
  const client = await db.connect();
  try {
    const { rows } = await client.query<{ code: string; age_seconds: number }>(
      `SELECT code, EXTRACT(EPOCH FROM (NOW() - created_at))::INT AS age_seconds
       FROM mfa_pending WHERE id = 'default'`
    );
    if (rows.length === 0 || rows[0].age_seconds > 600) {
      return NextResponse.json({ code: null }, { status: 404 });
    }
    return NextResponse.json({ code: rows[0].code, age_seconds: rows[0].age_seconds });
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest) {
  if (!bearerOk(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const client = await db.connect();
  try {
    await client.query(`DELETE FROM mfa_pending WHERE id = 'default'`);
  } finally {
    client.release();
  }
  return NextResponse.json({ ok: true });
}
