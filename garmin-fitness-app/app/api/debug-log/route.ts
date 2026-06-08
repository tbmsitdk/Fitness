import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Temporary diagnostic sink: lets the browser report what it found while
// scanning the uploaded export ZIP, so we can inspect it via Vercel runtime
// logs without needing the user to open dev tools. Safe to delete once the
// .fit-file-discovery issue is resolved.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    console.log('[debug-log]', JSON.stringify(body));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
