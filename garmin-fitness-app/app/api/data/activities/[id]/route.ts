import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

// DELETE: remove activity + optionally tombstone it so re-uploads skip it
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const { tombstone } = await req.json().catch(() => ({ tombstone: false })) as { tombstone?: boolean };

    // Get garmin_id before deleting
    const row = await sql`SELECT garmin_id FROM activities WHERE id = ${id}`;
    if (row.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const garminId = row.rows[0].garmin_id as string;
    await sql`DELETE FROM activities WHERE id = ${id}`;

    if (tombstone && garminId) {
      await sql`INSERT INTO activity_tombstones (garmin_id) VALUES (${garminId}) ON CONFLICT DO NOTHING`;
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/data/activities/[id]:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}
