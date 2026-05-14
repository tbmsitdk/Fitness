import { sql, db } from '@vercel/postgres';

export async function initializeDatabase() {
  await sql`
    CREATE TABLE IF NOT EXISTS activities (
      id SERIAL PRIMARY KEY,
      garmin_id VARCHAR(255) UNIQUE,
      activity_type VARCHAR(100) NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      title VARCHAR(255),
      distance_km DECIMAL(10,4) DEFAULT 0,
      duration_seconds INTEGER DEFAULT 0,
      calories INTEGER DEFAULT 0,
      avg_hr INTEGER,
      max_hr INTEGER,
      training_effect DECIMAL(4,2),
      avg_cadence INTEGER,
      avg_speed_kmh DECIMAL(10,4),
      tss DECIMAL(10,2),
      avg_power INTEGER,
      max_power INTEGER,
      elevation_gain DECIMAL(10,2),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS wellness (
      id SERIAL PRIMARY KEY,
      date DATE UNIQUE NOT NULL,
      steps INTEGER,
      resting_hr INTEGER,
      hrv_rmssd DECIMAL(8,2),
      sleep_hours DECIMAL(5,2),
      sleep_score INTEGER,
      stress_score INTEGER,
      body_battery INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(activity_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wellness_date ON wellness(date)`;
}

type ActivityRow = {
  garmin_id: string;
  activity_type: string;
  date: string;
  title: string;
  distance_km: number;
  duration_seconds: number;
  calories: number;
  avg_hr: number | null;
  max_hr: number | null;
  training_effect: number | null;
  avg_cadence: number | null;
  avg_speed_kmh: number | null;
  tss: number | null;
  avg_power: number | null;
  max_power: number | null;
  elevation_gain: number | null;
};

type WellnessRow = {
  date: string;
  steps: number | null;
  resting_hr: number | null;
  hrv_rmssd: number | null;
  sleep_hours: number | null;
  sleep_score: number | null;
  stress_score: number | null;
  body_battery: number | null;
};

const BATCH = 50; // rows per INSERT statement

export async function upsertActivities(activities: ActivityRow[]): Promise<number> {
  if (activities.length === 0) return 0;
  const client = await db.connect();
  try {
    let inserted = 0;
    for (let i = 0; i < activities.length; i += BATCH) {
      const batch = activities.slice(i, i + BATCH);
      const values: unknown[] = [];
      const rows: string[] = [];

      batch.forEach((a, j) => {
        const b = j * 16;
        rows.push(
          `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16})`
        );
        values.push(
          a.garmin_id, a.activity_type, a.date, a.title,
          a.distance_km, a.duration_seconds, a.calories,
          a.avg_hr, a.max_hr, a.training_effect, a.avg_cadence,
          a.avg_speed_kmh, a.tss, a.avg_power, a.max_power, a.elevation_gain
        );
      });

      await client.query(
        `INSERT INTO activities
           (garmin_id,activity_type,date,title,distance_km,duration_seconds,calories,
            avg_hr,max_hr,training_effect,avg_cadence,avg_speed_kmh,tss,avg_power,max_power,elevation_gain)
         VALUES ${rows.join(',')}
         ON CONFLICT (garmin_id) DO UPDATE SET
           activity_type=EXCLUDED.activity_type, title=EXCLUDED.title,
           distance_km=EXCLUDED.distance_km, duration_seconds=EXCLUDED.duration_seconds,
           calories=EXCLUDED.calories, avg_hr=EXCLUDED.avg_hr, max_hr=EXCLUDED.max_hr,
           training_effect=EXCLUDED.training_effect, avg_cadence=EXCLUDED.avg_cadence,
           avg_speed_kmh=EXCLUDED.avg_speed_kmh, tss=EXCLUDED.tss,
           avg_power=EXCLUDED.avg_power, max_power=EXCLUDED.max_power,
           elevation_gain=EXCLUDED.elevation_gain`,
        values
      );
      inserted += batch.length;
    }
    return inserted;
  } finally {
    client.release();
  }
}

export async function upsertWellness(records: WellnessRow[]): Promise<number> {
  if (records.length === 0) return 0;
  const client = await db.connect();
  try {
    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const values: unknown[] = [];
      const rows: string[] = [];

      batch.forEach((r, j) => {
        const b = j * 8;
        rows.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`);
        values.push(r.date, r.steps, r.resting_hr, r.hrv_rmssd, r.sleep_hours, r.sleep_score, r.stress_score, r.body_battery);
      });

      await client.query(
        `INSERT INTO wellness (date,steps,resting_hr,hrv_rmssd,sleep_hours,sleep_score,stress_score,body_battery)
         VALUES ${rows.join(',')}
         ON CONFLICT (date) DO UPDATE SET
           steps=COALESCE(EXCLUDED.steps,wellness.steps),
           resting_hr=COALESCE(EXCLUDED.resting_hr,wellness.resting_hr),
           hrv_rmssd=COALESCE(EXCLUDED.hrv_rmssd,wellness.hrv_rmssd),
           sleep_hours=COALESCE(EXCLUDED.sleep_hours,wellness.sleep_hours),
           sleep_score=COALESCE(EXCLUDED.sleep_score,wellness.sleep_score),
           stress_score=COALESCE(EXCLUDED.stress_score,wellness.stress_score),
           body_battery=COALESCE(EXCLUDED.body_battery,wellness.body_battery)`,
        values
      );
      inserted += batch.length;
    }
    return inserted;
  } finally {
    client.release();
  }
}

export { sql };

// Postgres returns DECIMAL as strings and DATE/TIMESTAMPTZ as Date objects.
// These helpers normalise raw rows before passing to any computation code.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function coerceActivity(row: any) {
  return {
    ...row,
    id:               Number(row.id),
    date:             row.date instanceof Date ? row.date.toISOString() : String(row.date),
    distance_km:      Number(row.distance_km)      || 0,
    duration_seconds: Number(row.duration_seconds) || 0,
    calories:         Number(row.calories)         || 0,
    avg_hr:           row.avg_hr           != null ? Number(row.avg_hr)           : null,
    max_hr:           row.max_hr           != null ? Number(row.max_hr)           : null,
    training_effect:  row.training_effect  != null ? Number(row.training_effect)  : null,
    avg_cadence:      row.avg_cadence      != null ? Number(row.avg_cadence)      : null,
    avg_speed_kmh:    row.avg_speed_kmh    != null ? Number(row.avg_speed_kmh)    : null,
    tss:              row.tss              != null ? Number(row.tss)              : null,
    avg_power:        row.avg_power        != null ? Number(row.avg_power)        : null,
    max_power:        row.max_power        != null ? Number(row.max_power)        : null,
    elevation_gain:   row.elevation_gain   != null ? Number(row.elevation_gain)   : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function coerceWellness(row: any) {
  return {
    ...row,
    id:           Number(row.id),
    date:         row.date instanceof Date ? row.date.toISOString() : String(row.date),
    steps:        row.steps        != null ? Number(row.steps)        : null,
    resting_hr:   row.resting_hr   != null ? Number(row.resting_hr)   : null,
    hrv_rmssd:    row.hrv_rmssd    != null ? Number(row.hrv_rmssd)    : null,
    sleep_hours:  row.sleep_hours  != null ? Number(row.sleep_hours)  : null,
    sleep_score:  row.sleep_score  != null ? Number(row.sleep_score)  : null,
    stress_score: row.stress_score != null ? Number(row.stress_score) : null,
    body_battery: row.body_battery != null ? Number(row.body_battery) : null,
  };
}
