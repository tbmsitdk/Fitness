import { NextRequest, NextResponse } from 'next/server';
import { buildShortcutPlist } from '@/lib/build-health-shortcut';

/**
 * GET /api/apple-health-shortcut
 *   Generates a personalised "Sync Apple Health" iOS Shortcut file
 *   (.shortcut, binary plist) embedding this deployment's URL and the
 *   SYNC_SECRET so the user can AirDrop it to their iPhone and run it
 *   daily without ever touching a terminal.
 *
 * Auth: requires Bearer <SYNC_SECRET> OR ?token=<SYNC_SECRET>.
 *   The page at /apple-health-setup adds the token automatically when
 *   the user supplies the secret. Open access would leak SYNC_SECRET
 *   (it's embedded in the file) to anyone who guesses the URL.
 */

export const dynamic = 'force-dynamic';

function authed(req: NextRequest, secret: string): boolean {
  if (!secret) return true; // dev mode — no secret configured
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const token  = req.nextUrl.searchParams.get('token') ?? '';
  return bearer === secret || token === secret;
}

export async function GET(request: NextRequest) {
  const secret = process.env.SYNC_SECRET ?? '';
  if (!authed(request, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Derive the app's public URL from the request itself (works for any
  // Vercel deployment URL or a custom domain — no env var needed).
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const host  = request.headers.get('host') ?? request.nextUrl.host;
  const appUrl = `${proto}://${host}`;

  const buf = buildShortcutPlist(appUrl, secret);

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="apple_health_sync.shortcut"',
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    },
  });
}
