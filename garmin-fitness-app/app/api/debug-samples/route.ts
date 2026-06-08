import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { rows: totals } = await sql`
      SELECT activity_id, COUNT(*) AS n
      FROM activity_samples
      GROUP BY activity_id
      ORDER BY n DESC
      LIMIT 30
    `;
    const { rows: specific } = await sql`
      SELECT a.id, a.garmin_id, a.title, a.activity_type, a.date::text,
             COUNT(s.elapsed_seconds) AS sample_count
      FROM activities a
      LEFT JOIN activity_samples s ON s.activity_id = a.id
      WHERE a.date >= NOW() - INTERVAL '30 days'
        AND a.activity_type IN ('cycling', 'running', 'walking')
      GROUP BY a.id, a.garmin_id, a.title, a.activity_type, a.date
      ORDER BY a.date DESC
      LIMIT 50
    `;
    // Check specific activities in question
    const { rows: targeted } = await sql`
      SELECT a.id, a.garmin_id, a.title, a.activity_type, a.date::text,
             COUNT(s.elapsed_seconds) AS sample_count,
             MIN(s.elapsed_seconds) AS min_e, MAX(s.elapsed_seconds) AS max_e
      FROM activities a
      LEFT JOIN activity_samples s ON s.activity_id = a.id
      WHERE a.id IN (6407, 6261, 6304, 6466, 6467, 6468)
      GROUP BY a.id, a.garmin_id, a.title, a.activity_type, a.date
      ORDER BY a.date DESC
    `;
    return NextResponse.json({ totals, specific, targeted });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
