import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coerce(row: any) {
  return {
    ...row,
    id:          Number(row.id),
    steps:       row.steps       != null ? Number(row.steps)       : null,
    resting_hr:  row.resting_hr  != null ? Number(row.resting_hr)  : null,
    hrv_rmssd:   row.hrv_rmssd   != null ? Number(row.hrv_rmssd)   : null,
    sleep_hours: row.sleep_hours != null ? Number(row.sleep_hours) : null,
    sleep_score: row.sleep_score != null ? Number(row.sleep_score) : null,
    stress_score:row.stress_score!= null ? Number(row.stress_score): null,
    body_battery:row.body_battery!= null ? Number(row.body_battery): null,
    weight_kg:      row.weight_kg      != null ? Number(row.weight_kg)      : null,
    vo2max:         row.vo2max         != null ? Number(row.vo2max)         : null,
    fitness_age:    row.fitness_age    != null ? Number(row.fitness_age)    : null,
    body_fat_pct:   row.body_fat_pct   != null ? Number(row.body_fat_pct)   : null,
    muscle_mass_kg: row.muscle_mass_kg != null ? Number(row.muscle_mass_kg) : null,
    bone_mass_kg:   row.bone_mass_kg   != null ? Number(row.bone_mass_kg)   : null,
    body_water_pct: row.body_water_pct != null ? Number(row.body_water_pct) : null,
    visceral_fat:   row.visceral_fat   != null ? Number(row.visceral_fat)   : null,
    metabolic_age:  row.metabolic_age  != null ? Number(row.metabolic_age)  : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '3650'), 1), 3650);

    const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();

    const result = await sql`
      SELECT * FROM wellness
      WHERE date >= ${cutoff}
      ORDER BY date ASC
      LIMIT 5000
    `;

    return NextResponse.json(result.rows.map(coerce));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
