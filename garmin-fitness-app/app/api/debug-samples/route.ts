import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

// Temporary read-only diagnostic: shows what's actually in activity_samples
// so we can confirm whether the DB write is landing or silently failing.
// Safe to delete once the cycling-activity sample issue is resolved.
export async function GET() {
  try {
    const { rows: totals } = await sql`
      SELECT activity_id, COUNT(*) AS n
      FROM activity_samples
      GROUP BY activity_id
      ORDER BY n DESC
      LIMIT 20
    `;
    // Also check specific problem activities
    const { rows: specific } = await sql`
      SELECT a.id, a.garmin_id, a.title, a.activity_type, a.date::text,
             COUNT(s.elapsed_seconds) AS sample_count
      FROM activities a
      LEFT JOIN activity_samples s ON s.activity_id = a.id
      WHERE a.date >= NOW() - INTERVAL '20 days'
        AND a.activity_type IN ('cycling', 'running', 'walking')
      GROUP BY a.id, a.garmin_id, a.title, a.activity_type, a.date
      ORDER BY a.date DESC
      LIMIT 40
    `;
    return NextResponse.json({ totals, specific });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
