import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

// Temporary diagnostic sink: lets the browser report what it found while
// scanning the uploaded export ZIP. Stored in Postgres (not just console.log)
// because the runtime-log viewer truncates long messages — this lets us pull
// the full payload back out via GET. Safe to delete (incl. the table) once the
// .fit-file-discovery issue is resolved.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    await sql`CREATE TABLE IF NOT EXISTS debug_logs (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT now(),
      payload JSONB
    )`;
    await sql`INSERT INTO debug_logs (payload) VALUES (${JSON.stringify(body)}::jsonb)`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[debug-log] error:', msg);
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  try {
    const { rows } = await sql`SELECT id, created_at, payload FROM debug_logs ORDER BY id DESC LIMIT 10`;
    return NextResponse.json({ rows });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
