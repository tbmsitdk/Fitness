// The one place the coach features read the full history from (tasks/lessons.md
// 14: one table, one read path). Server-only.

import { sql } from '@vercel/postgres';
import { coerceActivity, coerceWellness } from '@/lib/db';
import { coerceNutritionLog, type NutritionLog } from '@/lib/nutrition';
import { coerceTravelLog, type TravelLog } from '@/lib/travel';
import { coerceExerciseLog, type ExerciseLog } from '@/lib/exercises';
import { DEFAULT_HOME_TIMEZONE, homeDayAndTime } from '@/lib/raw-data';
import type { Activity, WellnessRecord } from '@/types';

export interface CoachData {
  activities: Activity[];
  wellness: WellnessRecord[];
  exerciseLogs: ExerciseLog[];
  nutritionLogs: NutritionLog[];
  travelLogs: TravelLog[];
  manualFtpWatts: number | null;
  homeTimezone: string;
  /** Today's date in the home timezone — the server itself runs in UTC. */
  today: string;
}

async function homeTimezone(): Promise<string> {
  try {
    const { rows } = await sql`SELECT home_timezone FROM user_settings WHERE id = 'default'`;
    const tz = rows[0]?.home_timezone;
    if (typeof tz === 'string' && tz) {
      // Throws on a zone name the runtime does not know.
      new Intl.DateTimeFormat('en-CA', { timeZone: tz });
      return tz;
    }
  } catch { /* table missing or zone invalid: fall through to the default */ }
  return DEFAULT_HOME_TIMEZONE;
}

export async function loadCoachData(): Promise<CoachData> {
  const [actResult, wellResult, ftpResult, exerciseResult, nutritionResult, travelResult, tz] = await Promise.all([
    sql`SELECT * FROM activities ORDER BY date`,
    sql`SELECT * FROM wellness ORDER BY date`,
    sql`SELECT ftp_watts FROM ftp_entries ORDER BY date DESC LIMIT 1`,
    sql`SELECT id, date::text, exercise_key, sets, reps, duration_seconds, load_kg,
               vital_capacity_l, inspiratory_strength, expiratory_strength, notes
        FROM exercise_logs ORDER BY date`,
    sql`SELECT id, date::text, alcohol_units, candy_portions, savoury_snacks, sugary_drinks,
               to_char(last_food_time, 'HH24:MI') AS last_food_time,
               caffeine_after_14, meal_quality, notes
        FROM nutrition_logs ORDER BY date`,
    // SELECT * deliberately: coerceTravelLog decides what is read.
    sql`SELECT * FROM travel_logs ORDER BY depart_date`,
    homeTimezone(),
  ]);

  return {
    activities: actResult.rows.map(coerceActivity),
    wellness: wellResult.rows.map(coerceWellness),
    exerciseLogs: exerciseResult.rows.map(coerceExerciseLog),
    nutritionLogs: nutritionResult.rows.map(coerceNutritionLog),
    travelLogs: travelResult.rows.map(coerceTravelLog),
    manualFtpWatts: ftpResult.rows[0]?.ftp_watts ? Number(ftpResult.rows[0].ftp_watts) : null,
    homeTimezone: tz,
    today: homeDayAndTime(new Date().toISOString(), tz).day,
  };
}

/** The date `days` days before `today`, YYYY-MM-DD. */
export function daysAgo(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Rows from the last `days` days. Works for bare dates and ISO timestamps alike. */
export function lastDays<T extends { date: string }>(rows: T[], days: number, today: string): T[] {
  const cutoff = daysAgo(today, days);
  return rows.filter(r => String(r.date).slice(0, 10) >= cutoff);
}
