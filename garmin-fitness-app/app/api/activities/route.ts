import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '365'), 1), 3650);
    const sport = searchParams.get('sport');

    const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();

    let result;
    if (sport) {
      result = await sql`
        SELECT * FROM activities
        WHERE date >= ${cutoff} AND activity_type = ${sport}
        ORDER BY date DESC
        LIMIT 2000
      `;
    } else {
      result = await sql`
        SELECT * FROM activities
        WHERE date >= ${cutoff}
        ORDER BY date DESC
        LIMIT 2000
      `;
    }

    return NextResponse.json(result.rows);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
