import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return true; // not configured — open (dev mode)
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
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
