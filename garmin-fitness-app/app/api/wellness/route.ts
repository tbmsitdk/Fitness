import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { coerceWellness } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '3650'), 1), 3650);

    const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();

    const result = await sql`
      SELECT * FROM wellness
      WHERE date >= ${cutoff}
      ORDER BY date ASC
      LIMIT 5000
    `;

    return NextResponse.json(result.rows.map(coerceWellness));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
