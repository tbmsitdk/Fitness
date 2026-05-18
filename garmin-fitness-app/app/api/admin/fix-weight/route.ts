import { NextResponse } from 'next/server';
import { db } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

// Temporary one-off endpoint — will be deleted after use
export async function POST() {
  const client = await db.connect();
  try {
    const result = await client.query(
      `UPDATE wellness
       SET weight_kg = NULL
       WHERE date >= '2025-12-01' AND date <= '2025-12-31'
         AND weight_kg = 69.1
       RETURNING date`
    );
    return NextResponse.json({ fixed: result.rowCount, dates: result.rows.map(r => r.date) });
  } finally {
    client.release();
  }
}
