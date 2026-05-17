import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { DEFAULT_SETTINGS, UserSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const ROW_ID = 'default';

export async function GET() {
  try {
    const result = await sql`
      SELECT birth_year, sex, weight_kg, height_cm, max_hr, threshold_hr, daily_steps_goal
      FROM user_settings WHERE id = ${ROW_ID}
    `;
    if (result.rows.length === 0) return NextResponse.json(DEFAULT_SETTINGS);

    const r = result.rows[0];
    const settings: UserSettings = {
      birthYear:      r.birth_year        ?? DEFAULT_SETTINGS.birthYear,
      sex:            (r.sex as UserSettings['sex']) ?? DEFAULT_SETTINGS.sex,
      weightKg:       r.weight_kg         != null ? Number(r.weight_kg)   : null,
      heightCm:       r.height_cm         != null ? Number(r.height_cm)   : null,
      maxHR:          r.max_hr            != null ? Number(r.max_hr)       : null,
      thresholdHR:    r.threshold_hr      != null ? Number(r.threshold_hr) : null,
      dailyStepsGoal: r.daily_steps_goal  ?? DEFAULT_SETTINGS.dailyStepsGoal,
    };
    return NextResponse.json(settings);
  } catch (error) {
    // Table not yet created — return defaults silently
    console.error('GET /api/settings:', error);
    return NextResponse.json(DEFAULT_SETTINGS);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const s: UserSettings = await request.json();
    await sql`
      INSERT INTO user_settings (id, birth_year, sex, weight_kg, height_cm, max_hr, threshold_hr, daily_steps_goal, updated_at)
      VALUES (
        ${ROW_ID},
        ${s.birthYear},
        ${s.sex},
        ${s.weightKg ?? null},
        ${s.heightCm ?? null},
        ${s.maxHR ?? null},
        ${s.thresholdHR ?? null},
        ${s.dailyStepsGoal},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        birth_year        = EXCLUDED.birth_year,
        sex               = EXCLUDED.sex,
        weight_kg         = EXCLUDED.weight_kg,
        height_cm         = EXCLUDED.height_cm,
        max_hr            = EXCLUDED.max_hr,
        threshold_hr      = EXCLUDED.threshold_hr,
        daily_steps_goal  = EXCLUDED.daily_steps_goal,
        updated_at        = NOW()
    `;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('PUT /api/settings:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
