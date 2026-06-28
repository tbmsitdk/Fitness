import { NextRequest, NextResponse } from 'next/server';
import { sql, db, createClient } from '@vercel/postgres';

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

    // Use createClient() — correct pattern for Vercel serverless (avoids pool state issues)
    const client = createClient();
    await client.connect();
    try {
      // Query 1: update the field value
      const r1 = await client.query(
        `UPDATE wellness SET ${field} = $1 WHERE id = $2`,
        [value, id]
      );
      console.log(`[wellness PATCH] field=${field} value=${value} id=${id} rowCount=${r1.rowCount}`);

      // Query 2: update locked_fields if requested
      if (lock === true) {
        const r2 = await client.query(
          `UPDATE wellness SET locked_fields = ((COALESCE(locked_fields,'[]')::jsonb - $1) || to_jsonb(ARRAY[$1]::text[]))::text WHERE id = $2`,
          [field, id]
        );
        console.log(`[wellness PATCH] lock=true rowCount=${r2.rowCount}`);
      } else if (lock === false) {
        const r2 = await client.query(
          `UPDATE wellness SET locked_fields = (COALESCE(locked_fields,'[]')::jsonb - $1)::text WHERE id = $2`,
          [field, id]
        );
        console.log(`[wellness PATCH] lock=false rowCount=${r2.rowCount}`);
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
