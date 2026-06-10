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

  // Additive migrations — safe to run repeatedly
  await sql`ALTER TABLE activities ADD COLUMN IF NOT EXISTS normalized_power INTEGER`;
  await sql`ALTER TABLE activities ADD COLUMN IF NOT EXISTS ftp INTEGER`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS weight_kg DECIMAL(5,2)`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS vo2max DECIMAL(5,2)`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS fitness_age INTEGER`;
  // Accurate birth date (more precise than birth_year alone)
  await sql`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS birth_date VARCHAR(10)`;
  // Manual FTP override — prevents Zone 2 rides from collapsing the p20-derived estimate
  await sql`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS ftp_watts INTEGER`;
  // Body composition from Garmin smart scale
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS body_fat_pct DECIMAL(5,2)`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS muscle_mass_kg DECIMAL(5,2)`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS bone_mass_kg DECIMAL(5,3)`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS body_water_pct DECIMAL(5,2)`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS visceral_fat INTEGER`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS metabolic_age INTEGER`;
  // Apple Health mobility & gait metrics
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS flights_climbed INTEGER`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS respiratory_rate DECIMAL(5,2)`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS walking_asymmetry_pct DECIMAL(5,2)`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS walking_speed DECIMAL(5,3)`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS walking_double_support_pct DECIMAL(5,2)`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS oxygen_saturation DECIMAL(5,2)`;
  await sql`ALTER TABLE wellness ADD COLUMN IF NOT EXISTS mindful_minutes INTEGER`;

  // User settings table — single row keyed by 'default', persists across deployments & devices
  await sql`
    CREATE TABLE IF NOT EXISTS user_settings (
      id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
      birth_year INTEGER,
      sex VARCHAR(10),
      weight_kg DECIMAL(5,2),
      height_cm DECIMAL(5,1),
      max_hr INTEGER,
      threshold_hr INTEGER,
      daily_steps_goal INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(activity_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wellness_date ON wellness(date)`;

  // ── Short-lived MFA code drop-box used by the Garmin token regen flow.
  // The GitHub Actions workflow initiates a Garmin login (which triggers an
  // SMS), then polls this table for the user-submitted code. Codes auto-expire
  // after 10 min so a stale code can never be reused by a later run.
  await sql`
    CREATE TABLE IF NOT EXISTS mfa_pending (
      id          VARCHAR(20) PRIMARY KEY DEFAULT 'default',
      code        VARCHAR(20),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS garmin_tokens (
      id VARCHAR(20) PRIMARY KEY DEFAULT 'default',
      token_data TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS weekly_report (
      id SERIAL PRIMARY KEY,
      week_start DATE NOT NULL,
      report_json TEXT NOT NULL,
      generated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Manual Zwift FTP history — each row is a user-entered test result
  await sql`
    CREATE TABLE IF NOT EXISTS ftp_entries (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      ftp_watts INTEGER NOT NULL,
      note VARCHAR(500),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_ftp_entries_date ON ftp_entries(date)`;

  // Per-second (sampled every 10s) HR/power/cadence/GPS series for individual activities
  await sql`
    CREATE TABLE IF NOT EXISTS activity_samples (
      activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      elapsed_seconds INTEGER NOT NULL,
      hr SMALLINT,
      power SMALLINT,
      cadence SMALLINT,
      lat DECIMAL(9,6),
      lon DECIMAL(9,6),
      PRIMARY KEY (activity_id, elapsed_seconds)
    )
  `;
  // Migration safety: add GPS columns to a table created before this feature existed
  await sql`ALTER TABLE activity_samples ADD COLUMN IF NOT EXISTS lat DECIMAL(9,6)`;
  await sql`ALTER TABLE activity_samples ADD COLUMN IF NOT EXISTS lon DECIMAL(9,6)`;
}

// Map garmin_id -> internal activity id + whether samples already exist
export async function getActivityIdMap(): Promise<Map<string, number>> {
  const result = await sql`SELECT id, garmin_id FROM activities WHERE garmin_id IS NOT NULL`;
  const map = new Map<string, number>();
  for (const row of result.rows) {
    map.set(String(row.garmin_id), Number(row.id));
  }
  return map;
}

export async function getActivityIdsWithSamples(): Promise<Set<number>> {
  const result = await sql`SELECT DISTINCT activity_id FROM activity_samples`;
  return new Set(result.rows.map(r => Number(r.activity_id)));
}

export async function getActivitySamples(activityId: number) {
  const result = await sql`
    SELECT elapsed_seconds, hr, power, cadence, lat, lon
    FROM activity_samples
    WHERE activity_id = ${activityId}
    ORDER BY elapsed_seconds ASC
  `;
  return result.rows.map(r => ({
    elapsed_seconds: Number(r.elapsed_seconds),
    hr: r.hr != null ? Number(r.hr) : null,
    power: r.power != null ? Number(r.power) : null,
    cadence: r.cadence != null ? Number(r.cadence) : null,
    lat: r.lat != null ? Number(r.lat) : null,
    lon: r.lon != null ? Number(r.lon) : null,
  }));
}

export type ActivitySampleRow = {
  elapsed_seconds: number;
  hr: number | null;
  power: number | null;
  cadence: number | null;
  lat?: number | null;
  lon?: number | null;
};

const SAMPLE_BATCH = 150; // rows per INSERT statement (7 cols each ~ 1050 placeholders, under PG's 65535 limit)

export async function insertActivitySamples(activityId: number, samples: ActivitySampleRow[]): Promise<number> {
  if (samples.length === 0) return 0;
  const client = await db.connect();
  try {
    // Replace any existing samples for this activity (re-processing safety)
    await client.query(`DELETE FROM activity_samples WHERE activity_id = $1`, [activityId]);

    let inserted = 0;
    for (let i = 0; i < samples.length; i += SAMPLE_BATCH) {
      const batch = samples.slice(i, i + SAMPLE_BATCH);
      const values: unknown[] = [];
      const rows: string[] = [];
      batch.forEach((s, j) => {
        const b = j * 7;
        rows.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`);
        values.push(activityId, s.elapsed_seconds, s.hr, s.power, s.cadence, s.lat ?? null, s.lon ?? null);
      });
      await client.query(
        `INSERT INTO activity_samples (activity_id, elapsed_seconds, hr, power, cadence, lat, lon)
         VALUES ${rows.join(',')}
         ON CONFLICT (activity_id, elapsed_seconds) DO NOTHING`,
        values
      );
      inserted += batch.length;
    }
    return inserted;
  } finally {
    client.release();
  }
}

export async function getFtpEntries() {
  const result = await sql`
    SELECT id, date::text, ftp_watts, note, created_at::text
    FROM ftp_entries
    ORDER BY date ASC
  `;
  return result.rows;
}

export async function insertFtpEntry(date: string, ftp_watts: number, note: string | null) {
  const result = await sql`
    INSERT INTO ftp_entries (date, ftp_watts, note)
    VALUES (${date}, ${ftp_watts}, ${note})
    RETURNING id, date::text, ftp_watts, note, created_at::text
  `;
  return result.rows[0];
}

export async function deleteFtpEntry(id: number) {
  await sql`DELETE FROM ftp_entries WHERE id = ${id}`;
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
  normalized_power: number | null;
  ftp: number | null;
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
  weight_kg: number | null;
  vo2max: number | null;
  fitness_age: number | null;
  body_fat_pct: number | null;
  muscle_mass_kg: number | null;
  bone_mass_kg: number | null;
  body_water_pct: number | null;
  visceral_fat: number | null;
  metabolic_age: number | null;
  // Apple Health mobility & gait
  flights_climbed: number | null;
  respiratory_rate: number | null;
  walking_asymmetry_pct: number | null;
  walking_speed: number | null;
  walking_double_support_pct: number | null;
  oxygen_saturation: number | null;
  mindful_minutes: number | null;
};

const BATCH = 50; // rows per INSERT statement

export async function upsertActivities(activities: ActivityRow[]): Promise<number> {
  if (activities.length === 0) return 0;

  // ── 1. Deduplicate within the incoming list (same garmin_id) ──────────────
  // Postgres "ON CONFLICT DO UPDATE command cannot affect row a second time"
  // if the same key appears twice in one batch.
  const seen = new Map<string, ActivityRow>();
  for (const a of activities) seen.set(a.garmin_id, a);
  activities = Array.from(seen.values());

  // ── 2. Cross-source deduplication (Garmin vs Apple Health) ───────────────
  // Apple Health activities use the "ah_" prefix. If the DB already has a
  // Garmin activity (no "ah_" prefix) of the same type within ±30 minutes,
  // the Apple Health record is a duplicate — skip it so Garmin data wins.
  const ahActivities = activities.filter(a => a.garmin_id.startsWith('ah_'));
  if (ahActivities.length > 0) {
    const client0 = await db.connect();
    try {
      const dates = ahActivities.map(a => new Date(a.date));
      const minDate = new Date(Math.min(...dates.map(d => d.getTime())) - 30 * 60_000);
      const maxDate = new Date(Math.max(...dates.map(d => d.getTime())) + 30 * 60_000);

      const { rows: existing } = await client0.query<{ activity_type: string; date: string }>(
        `SELECT activity_type, date FROM activities
         WHERE garmin_id NOT LIKE 'ah_%'
           AND date >= $1 AND date <= $2`,
        [minDate.toISOString(), maxDate.toISOString()]
      );

      if (existing.length > 0) {
        const clashes = new Set<string>();
        for (const ah of ahActivities) {
          const ahMs = new Date(ah.date).getTime();
          for (const ex of existing) {
            if (
              ah.activity_type === ex.activity_type &&
              Math.abs(new Date(ex.date).getTime() - ahMs) <= 30 * 60_000
            ) {
              clashes.add(ah.garmin_id);
              break;
            }
          }
        }
        if (clashes.size > 0) {
          activities = activities.filter(a => !clashes.has(a.garmin_id));
          console.log(`[upsertActivities] skipped ${clashes.size} Apple Health duplicates (Garmin copy exists)`);
        }
      }
    } finally {
      client0.release();
    }
  }

  if (activities.length === 0) return 0;
  const client = await db.connect();
  try {
    let inserted = 0;
    for (let i = 0; i < activities.length; i += BATCH) {
      const batch = activities.slice(i, i + BATCH);
      const values: unknown[] = [];
      const rows: string[] = [];

      batch.forEach((a, j) => {
        const b = j * 18;
        rows.push(
          `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17},$${b+18})`
        );
        values.push(
          a.garmin_id, a.activity_type, a.date, a.title,
          a.distance_km, a.duration_seconds, a.calories,
          a.avg_hr, a.max_hr, a.training_effect, a.avg_cadence,
          a.avg_speed_kmh, a.tss, a.avg_power, a.max_power, a.elevation_gain,
          a.normalized_power, a.ftp
        );
      });

      await client.query(
        `INSERT INTO activities
           (garmin_id,activity_type,date,title,distance_km,duration_seconds,calories,
            avg_hr,max_hr,training_effect,avg_cadence,avg_speed_kmh,tss,avg_power,max_power,
            elevation_gain,normalized_power,ftp)
         VALUES ${rows.join(',')}
         ON CONFLICT (garmin_id) DO UPDATE SET
           activity_type=EXCLUDED.activity_type, title=EXCLUDED.title,
           distance_km=EXCLUDED.distance_km, duration_seconds=EXCLUDED.duration_seconds,
           calories=EXCLUDED.calories, avg_hr=EXCLUDED.avg_hr, max_hr=EXCLUDED.max_hr,
           training_effect=EXCLUDED.training_effect, avg_cadence=EXCLUDED.avg_cadence,
           avg_speed_kmh=EXCLUDED.avg_speed_kmh, tss=EXCLUDED.tss,
           avg_power=EXCLUDED.avg_power, max_power=EXCLUDED.max_power,
           elevation_gain=EXCLUDED.elevation_gain,
           normalized_power=COALESCE(EXCLUDED.normalized_power,activities.normalized_power),
           ftp=COALESCE(EXCLUDED.ftp,activities.ftp)`,
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
        const b = j * 24;
        rows.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17},$${b+18},$${b+19},$${b+20},$${b+21},$${b+22},$${b+23},$${b+24})`);
        values.push(
          r.date, r.steps, r.resting_hr, r.hrv_rmssd, r.sleep_hours, r.sleep_score,
          r.stress_score, r.body_battery, r.weight_kg ?? null, r.vo2max ?? null, r.fitness_age ?? null,
          r.body_fat_pct ?? null, r.muscle_mass_kg ?? null, r.bone_mass_kg ?? null,
          r.body_water_pct ?? null, r.visceral_fat ?? null, r.metabolic_age ?? null,
          r.flights_climbed ?? null, r.respiratory_rate ?? null, r.walking_asymmetry_pct ?? null,
          r.walking_speed ?? null, r.walking_double_support_pct ?? null,
          r.oxygen_saturation ?? null, r.mindful_minutes ?? null,
        );
      });

      await client.query(
        `INSERT INTO wellness (date,steps,resting_hr,hrv_rmssd,sleep_hours,sleep_score,stress_score,body_battery,
           weight_kg,vo2max,fitness_age,body_fat_pct,muscle_mass_kg,bone_mass_kg,body_water_pct,visceral_fat,metabolic_age,
           flights_climbed,respiratory_rate,walking_asymmetry_pct,walking_speed,walking_double_support_pct,
           oxygen_saturation,mindful_minutes)
         VALUES ${rows.join(',')}
         ON CONFLICT (date) DO UPDATE SET
           steps=COALESCE(EXCLUDED.steps,wellness.steps),
           resting_hr=COALESCE(EXCLUDED.resting_hr,wellness.resting_hr),
           hrv_rmssd=COALESCE(EXCLUDED.hrv_rmssd,wellness.hrv_rmssd),
           sleep_hours=COALESCE(EXCLUDED.sleep_hours,wellness.sleep_hours),
           sleep_score=COALESCE(EXCLUDED.sleep_score,wellness.sleep_score),
           stress_score=COALESCE(EXCLUDED.stress_score,wellness.stress_score),
           body_battery=COALESCE(EXCLUDED.body_battery,wellness.body_battery),
           weight_kg=COALESCE(EXCLUDED.weight_kg,wellness.weight_kg),
           vo2max=COALESCE(EXCLUDED.vo2max,wellness.vo2max),
           fitness_age=COALESCE(EXCLUDED.fitness_age,wellness.fitness_age),
           body_fat_pct=COALESCE(EXCLUDED.body_fat_pct,wellness.body_fat_pct),
           muscle_mass_kg=COALESCE(EXCLUDED.muscle_mass_kg,wellness.muscle_mass_kg),
           bone_mass_kg=COALESCE(EXCLUDED.bone_mass_kg,wellness.bone_mass_kg),
           body_water_pct=COALESCE(EXCLUDED.body_water_pct,wellness.body_water_pct),
           visceral_fat=COALESCE(EXCLUDED.visceral_fat,wellness.visceral_fat),
           metabolic_age=COALESCE(EXCLUDED.metabolic_age,wellness.metabolic_age),
           flights_climbed=COALESCE(EXCLUDED.flights_climbed,wellness.flights_climbed),
           respiratory_rate=COALESCE(EXCLUDED.respiratory_rate,wellness.respiratory_rate),
           walking_asymmetry_pct=COALESCE(EXCLUDED.walking_asymmetry_pct,wellness.walking_asymmetry_pct),
           walking_speed=COALESCE(EXCLUDED.walking_speed,wellness.walking_speed),
           walking_double_support_pct=COALESCE(EXCLUDED.walking_double_support_pct,wellness.walking_double_support_pct),
           oxygen_saturation=COALESCE(EXCLUDED.oxygen_saturation,wellness.oxygen_saturation),
           mindful_minutes=COALESCE(EXCLUDED.mindful_minutes,wellness.mindful_minutes)`,
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
    normalized_power: row.normalized_power != null ? Number(row.normalized_power) : null,
    ftp:              row.ftp              != null ? Number(row.ftp)              : null,
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
    weight_kg:      row.weight_kg      != null ? Number(row.weight_kg)      : null,
    vo2max:         row.vo2max         != null ? Number(row.vo2max)         : null,
    fitness_age:    row.fitness_age    != null ? Number(row.fitness_age)    : null,
    body_fat_pct:   row.body_fat_pct   != null ? Number(row.body_fat_pct)   : null,
    muscle_mass_kg: row.muscle_mass_kg != null ? Number(row.muscle_mass_kg) : null,
    bone_mass_kg:   row.bone_mass_kg   != null ? Number(row.bone_mass_kg)   : null,
    body_water_pct: row.body_water_pct != null ? Number(row.body_water_pct) : null,
    visceral_fat:   row.visceral_fat   != null ? Number(row.visceral_fat)   : null,
    metabolic_age:  row.metabolic_age  != null ? Number(row.metabolic_age)  : null,
    flights_climbed:             row.flights_climbed             != null ? Number(row.flights_climbed)             : null,
    respiratory_rate:            row.respiratory_rate            != null ? Number(row.respiratory_rate)            : null,
    walking_asymmetry_pct:       row.walking_asymmetry_pct       != null ? Number(row.walking_asymmetry_pct)       : null,
    walking_speed:               row.walking_speed               != null ? Number(row.walking_speed)               : null,
    walking_double_support_pct:  row.walking_double_support_pct  != null ? Number(row.walking_double_support_pct)  : null,
    oxygen_saturation:           row.oxygen_saturation           != null ? Number(row.oxygen_saturation)           : null,
    mindful_minutes:             row.mindful_minutes             != null ? Number(row.mindful_minutes)             : null,
  };
}
