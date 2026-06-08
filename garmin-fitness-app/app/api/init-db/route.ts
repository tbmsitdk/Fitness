import { NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

// NOTE: deliberately NOT gated by SYNC_SECRET — see app/api/insert/route.ts for why:
// this endpoint is called both by the automated sync and directly from the browser
// upload flow (Upload.tsx), which cannot safely hold the secret.

export async function POST() {
  try {
    console.log('[init-db] creating tables if not exist…');
    await initializeDatabase();
    console.log('[init-db] done');
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[init-db] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
