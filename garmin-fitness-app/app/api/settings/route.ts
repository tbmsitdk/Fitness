import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { initializeDatabase } from '@/lib/db';
import { DEFAULT_SETTINGS, UserSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const ROW_ID = 'default';

export async function GET() {
  try {
    await initializeDatabase(); // ensures all columns exist before querying
    const result = await sql`
      SELECT birth_year, birth_date, sex, height_cm, max_hr, threshold_hr, ftp_watts, daily_steps_goal
      FROM user_settings WHERE id = ${ROW_ID}
    `;
    if (result.rows.length === 0) return NextResponse.json(DEFAULT_SETTINGS);

    const r = result.rows[0];
    const settings: UserSettings = {
      birthYear:      r.birth_year        ?? DEFAULT_SETTINGS.birthYear,
      birthDate:      r.birth_date        ?? null,
      sex:            (r.sex as UserSettings['sex']) ?? DEFAULT_SETTINGS.sex,
      heightCm:       r.height_cm         != null ? Number(r.height_cm)   : null,
      maxHR:          r.max_hr            != null ? Number(r.max_hr)       : null,
      thresholdHR:    r.threshold_hr      != null ? Number(r.threshold_hr) : null,
      garminFtp:      r.ftp_watts         != null ? Number(r.ftp_watts)    : null,
      dailyStepsGoal: r.daily_steps_goal  ?? DEFAULT_SETTINGS.dailyStepsGoal,
    };
    return NextResponse.json(settings);
  } catch (error) {
    console.error('GET /api/settings:', error);
    return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const s: UserSettings = await request.json();
    await sql`
      INSERT INTO user_settings (id, birth_year, birth_date, sex, height_cm, max_hr, threshold_hr, ftp_watts, daily_steps_goal, updated_at)
      VALUES (
        ${ROW_ID},
        ${s.birthYear},
        ${s.birthDate ?? null},
        ${s.sex},
        ${s.heightCm ?? null},
        ${s.maxHR ?? null},
        ${s.thresholdHR ?? null},
        ${s.garminFtp ?? null},
        ${s.dailyStepsGoal},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        birth_year        = EXCLUDED.birth_year,
        birth_date        = EXCLUDED.birth_date,
        sex               = EXCLUDED.sex,
        height_cm         = EXCLUDED.height_cm,
        max_hr            = EXCLUDED.max_hr,
        threshold_hr      = EXCLUDED.threshold_hr,
        ftp_watts         = COALESCE(EXCLUDED.ftp_watts, user_settings.ftp_watts),
        daily_steps_goal  = EXCLUDED.daily_steps_goal,
        updated_at        = NOW()
    `;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('PUT /api/settings:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
