import { NextResponse } from 'next/server';
import { db } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

export async function GET() { return handler(); }
export async function POST() { return handler(); }

async function handler() {
  const client = await db.connect();
  try {
    // Find Apple Health activities (ah_ prefix) that have a matching Garmin
    // activity of the same type within ±30 minutes. Garmin data wins.
    const { rows: dupes } = await client.query<{ garmin_id: string; date: string; activity_type: string }>(`
      SELECT ah.garmin_id, ah.date, ah.activity_type
      FROM activities ah
      JOIN activities g
        ON  g.garmin_id NOT LIKE 'ah_%'
        AND g.activity_type = ah.activity_type
        AND ABS(EXTRACT(EPOCH FROM (ah.date::timestamptz - g.date::timestamptz))) <= 1800
      WHERE ah.garmin_id LIKE 'ah_%'
    `);

    if (dupes.length === 0) {
      return NextResponse.json({ deleted: 0, message: 'No duplicates found.' });
    }

    const ids = dupes.map(d => d.garmin_id);
    await client.query(
      `DELETE FROM activities WHERE garmin_id = ANY($1)`,
      [ids]
    );

    return NextResponse.json({
      deleted: dupes.length,
      message: `Deleted ${dupes.length} Apple Health duplicate(s).`,
      examples: dupes.slice(0, 5).map(d => `${d.date.substring(0, 10)} ${d.activity_type}`),
    });
  } finally {
    client.release();
  }
}
