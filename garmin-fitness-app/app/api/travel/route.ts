import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { initializeDatabase } from '@/lib/db';
import { coerceTravelLog } from '@/lib/travel';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };
const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** UTC offsets run -12..+14 and can be fractional (India +5.5, Nepal +5.75). */
function offset(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < -12 || n > 14) return null;
  return Math.round(n * 4) / 4;   // quarter-hour resolution covers every real zone
}

// GET /api/travel — every trip, newest departure first.
export async function GET() {
  const client = createClient();
  try {
    await initializeDatabase();
    await client.connect();
    const { rows } = await client.query(
      `SELECT id, destination, depart_date::text, arrive_date::text, return_date::text,
              home_utc_offset, dest_utc_offset, travel_mode, purpose, notes
       FROM travel_logs
       ORDER BY depart_date DESC`
    );
    return NextResponse.json({ trips: rows.map(coerceTravelLog) }, { headers: NO_STORE });
  } catch (e) {
    console.error('GET /api/travel:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}

/** POST — create a trip, or update one when `id` is supplied. */
export async function POST(req: NextRequest) {
  const client = createClient();
  try {
    await initializeDatabase();
    const b = await req.json();

    const destination = typeof b?.destination === 'string' ? b.destination.trim().slice(0, 120) : '';
    const depart = isDate(b?.depart_date) ? b.depart_date : null;
    const arrive = isDate(b?.arrive_date) ? b.arrive_date : depart;
    const ret = isDate(b?.return_date) ? b.return_date : null;
    const home = offset(b?.home_utc_offset);
    const dest = offset(b?.dest_utc_offset);

    if (!destination || !depart || home == null || dest == null) {
      return NextResponse.json(
        { error: 'destination, depart_date and both UTC offsets are required' }, { status: 400 });
    }
    // Catch transposed dates at the edge rather than storing a trip that ends
    // before it starts, which would silently produce negative-length windows.
    if (arrive && arrive < depart) {
      return NextResponse.json({ error: 'arrive_date cannot precede depart_date' }, { status: 400 });
    }
    if (ret && ret < depart) {
      return NextResponse.json({ error: 'return_date cannot precede depart_date' }, { status: 400 });
    }

    const mode = typeof b?.travel_mode === 'string' && b.travel_mode ? b.travel_mode.slice(0, 20) : null;
    const purpose = typeof b?.purpose === 'string' && b.purpose ? b.purpose.slice(0, 20) : null;
    const notes = typeof b?.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 500) : null;

    await client.connect();
    if (b?.id != null) {
      await client.query(
        `UPDATE travel_logs SET destination=$1, depart_date=$2, arrive_date=$3, return_date=$4,
                home_utc_offset=$5, dest_utc_offset=$6, travel_mode=$7, purpose=$8, notes=$9,
                updated_at=NOW()
         WHERE id=$10`,
        [destination, depart, arrive, ret, home, dest, mode, purpose, notes, Number(b.id)]
      );
    } else {
      await client.query(
        `INSERT INTO travel_logs
           (destination, depart_date, arrive_date, return_date,
            home_utc_offset, dest_utc_offset, travel_mode, purpose, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [destination, depart, arrive, ret, home, dest, mode, purpose, notes]
      );
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    console.error('POST /api/travel:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}

// DELETE /api/travel?id=123
export async function DELETE(req: NextRequest) {
  const client = createClient();
  try {
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 });
    }
    await client.connect();
    await client.query(`DELETE FROM travel_logs WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    console.error('DELETE /api/travel:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}
