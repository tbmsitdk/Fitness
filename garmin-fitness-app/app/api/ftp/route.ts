import { NextRequest, NextResponse } from 'next/server';
import { getFtpEntries, insertFtpEntry, deleteFtpEntry } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const entries = await getFtpEntries();
    return NextResponse.json(entries);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { date, ftp_watts, note } = await req.json();
    if (!date || !ftp_watts || typeof ftp_watts !== 'number') {
      return NextResponse.json({ error: 'date and ftp_watts are required' }, { status: 400 });
    }
    const entry = await insertFtpEntry(date, ftp_watts, note ?? null);
    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await deleteFtpEntry(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
