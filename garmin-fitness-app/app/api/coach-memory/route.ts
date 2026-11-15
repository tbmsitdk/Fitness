import { NextRequest, NextResponse } from 'next/server';
import { normaliseMemoryPath, MEMORY_ROOT } from '@/lib/coach-memory';
import { postgresMemoryStore } from '@/lib/coach-memory-db';

export const dynamic = 'force-dynamic';

// What the coach has written down. Shown in the app so nothing it remembers is
// hidden from the person it is about, and so any note can be removed.

export async function GET() {
  try {
    return NextResponse.json({ files: await postgresMemoryStore.list() });
  } catch (e) {
    console.error('[coach-memory] GET', e);
    return NextResponse.json({ error: 'Could not load the memory' }, { status: 500 });
  }
}

// DELETE /api/coach-memory?path=/memories/notes.md
export async function DELETE(req: NextRequest) {
  try {
    const path = normaliseMemoryPath(req.nextUrl.searchParams.get('path'));
    if (!path || path === MEMORY_ROOT) return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    return NextResponse.json({ ok: await postgresMemoryStore.remove(path) });
  } catch (e) {
    console.error('[coach-memory] DELETE', e);
    return NextResponse.json({ error: 'Could not delete the note' }, { status: 500 });
  }
}
