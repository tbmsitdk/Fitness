import { NextRequest, NextResponse } from 'next/server';
import { sql, createClient } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

// PATCH: edit a field value, optionally lock/unlock it
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const { field, value, lock } = await req.json() as {
      field: string;
      value: number | null;
      lock?: boolean; // true = protect on re-upload, false = remove protection, undefined = no change
    };

    // Whitelist editable fields to prevent SQL injection
    const EDITABLE_FIELDS = new Set([
      'steps', 'resting_hr', 'hrv_rmssd', 'sleep_hours', 'sleep_score',
      'stress_score', 'body_battery', 'weight_kg', 'vo2max', 'fitness_age',
      'body_fat_pct', 'muscle_mass_kg', 'bone_mass_kg', 'body_water_pct',
      'visceral_fat', 'metabolic_age',
    ]);
    if (!EDITABLE_FIELDS.has(field)) {
      return NextResponse.json({ error: 'Field not editable' }, { status: 400 });
    }

    // createClient() = direct connection to the primary. The pooled sql`` template
    // can read from a lagged replica, which made edits appear to vanish.
    const client = createClient();
    await client.connect();
    try {
      const result = await client.query(
        `UPDATE wellness SET ${field} = $1 WHERE id = $2`,
        [value, id]
      );
      if (result.rowCount === 0) {
        return NextResponse.json({ error: 'Record not found' }, { status: 404 });
      }

      if (lock === true) {
        // Remove-then-append keeps the JSON array duplicate-free
        await client.query(
          `UPDATE wellness SET locked_fields = ((COALESCE(locked_fields,'[]')::jsonb - $1) || to_jsonb(ARRAY[$1]::text[]))::text WHERE id = $2`,
          [field, id]
        );
      } else if (lock === false) {
        await client.query(
          `UPDATE wellness SET locked_fields = (COALESCE(locked_fields,'[]')::jsonb - $1)::text WHERE id = $2`,
          [field, id]
        );
      }
    } finally {
      await client.end();
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('PATCH /api/data/wellness/[id]:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}

// DELETE: remove the entire wellness row
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    await sql`DELETE FROM wellness WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/data/wellness/[id]:', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}
