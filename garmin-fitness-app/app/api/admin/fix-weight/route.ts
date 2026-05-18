import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

// Temporary one-off endpoint — will be deleted after use
export async function POST() {
  const dbVars = Object.keys(process.env).filter(k =>
    k.includes('POSTGRES') || k.includes('DATABASE') || k.includes('NEON') || k.includes('PG') || k.includes('URL') || k.includes('DSN')
  );
  try {
    const result = await sql`
      UPDATE wellness
      SET weight_kg = NULL
      WHERE date >= '2025-12-01' AND date <= '2025-12-31'
        AND weight_kg = 69.1
      RETURNING date
    `;
    return NextResponse.json({ fixed: result.rowCount, dates: result.rows.map(r => r.date), dbVars });
  } catch (e) {
    return NextResponse.json({ error: String(e), dbVars }, { status: 500 });
  }
}
