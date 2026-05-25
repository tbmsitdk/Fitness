import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { initializeDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

function bearerOk(req: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return true;
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!bearerOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await initializeDatabase();
  try {
    const { rows } = await sql`SELECT token_data FROM garmin_tokens WHERE id = 'default'`;
    if (rows.length === 0) return NextResponse.json({ token_data: null });
    return NextResponse.json({ token_data: rows[0].token_data });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!bearerOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { token_data } = await req.json();
  if (!token_data) return NextResponse.json({ error: 'missing token_data' }, { status: 400 });
  await initializeDatabase();
  await sql`
    INSERT INTO garmin_tokens (id, token_data, updated_at)
    VALUES ('default', ${token_data}, NOW())
    ON CONFLICT (id) DO UPDATE SET token_data = EXCLUDED.token_data, updated_at = NOW()
  `;
  return NextResponse.json({ ok: true });
}
