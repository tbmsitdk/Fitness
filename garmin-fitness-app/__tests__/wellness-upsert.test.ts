// Runs the REAL upsert SQL against an in-process Postgres (PGlite). The step
// count decides which device is trusted, and a mistake in this statement would
// break the daily Garmin sync, which a type check cannot see.

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PARAMS_PER_ROW, buildWellnessUpsert, type WellnessRow } from '@/lib/wellness-upsert';
import { deriveSteps } from '@/lib/step-sources';

const DDL = `
  CREATE TABLE wellness (
    id SERIAL PRIMARY KEY, date DATE UNIQUE NOT NULL, steps INTEGER, resting_hr INTEGER, hrv_rmssd DECIMAL(8,2),
    sleep_hours DECIMAL(5,2), sleep_score INTEGER, stress_score INTEGER, body_battery INTEGER, weight_kg DECIMAL(5,2),
    vo2max DECIMAL(4,1), fitness_age INTEGER, body_fat_pct DECIMAL(4,1), muscle_mass_kg DECIMAL(4,1),
    bone_mass_kg DECIMAL(4,1), body_water_pct DECIMAL(4,1), visceral_fat INTEGER, metabolic_age INTEGER,
    flights_climbed INTEGER, respiratory_rate DECIMAL(4,1), walking_asymmetry_pct DECIMAL(4,1),
    walking_speed DECIMAL(5,3), walking_double_support_pct DECIMAL(5,2), oxygen_saturation DECIMAL(5,2),
    mindful_minutes INTEGER, kcal_burned INTEGER, active_kcal INTEGER, resting_kcal INTEGER,
    kcal_synced_at TIMESTAMPTZ, steps_garmin INTEGER, steps_apple INTEGER, steps_fill INTEGER, steps_fill_ref INTEGER,
    locked_fields TEXT DEFAULT '[]'
  )`;

const row = (date: string, over: Partial<WellnessRow> = {}): WellnessRow => ({
  date, steps: null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null, stress_score: null,
  body_battery: null, weight_kg: null, vo2max: null, fitness_age: null, body_fat_pct: null, muscle_mass_kg: null,
  bone_mass_kg: null, body_water_pct: null, visceral_fat: null, metabolic_age: null, flights_climbed: null,
  respiratory_rate: null, walking_asymmetry_pct: null, walking_speed: null, walking_double_support_pct: null,
  oxygen_saturation: null, mindful_minutes: null, ...over,
});

const D = '2026-03-10';
let db: PGlite;

beforeAll(async () => { db = new PGlite(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec('DROP TABLE IF EXISTS wellness'); await db.exec(DDL); });

async function upsert(...rows: WellnessRow[]) {
  const { text, values } = buildWellnessUpsert(rows);
  await db.query(text, values);
}
async function get(date = D) {
  const { rows } = await db.query<Record<string, number | null>>(
    'SELECT steps, steps_garmin, steps_apple, steps_fill, steps_fill_ref, resting_hr, sleep_hours::float8 AS sleep_hours FROM wellness WHERE date = $1', [date]);
  return rows[0];
}
const garmin = (steps: number | null, over: Partial<WellnessRow> = {}) => row(D, { steps, ...over });
const apple = (steps: number | null, fill: number | null = null, ref: number | null = null) =>
  row(D, { steps, steps_source: 'apple', steps_fill: fill, steps_fill_ref: ref });

describe('the statement itself', () => {
  it('has one placeholder for every column', async () => {
    const { text, values } = buildWellnessUpsert([row(D), row('2026-03-11'), row('2026-03-12')]);
    expect(values).toHaveLength(PARAMS_PER_ROW * 3);
    await db.query(text, values);                                   // all three rows in one statement
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM wellness');
    expect(rows[0]).toEqual({ n: 3 });
  });
});

describe('Garmin is the master', () => {
  it('stores the Garmin sync\'s count', async () => {
    await upsert(garmin(8_000));
    expect(await get()).toMatchObject({ steps: 8_000, steps_garmin: 8_000, steps_apple: null });
  });

  // The defect: the Apple import used to overwrite whatever was there.
  it('keeps Garmin\'s count when an Apple Health import arrives after it', async () => {
    await upsert(garmin(8_000));
    await upsert(apple(12_000));
    expect(await get()).toMatchObject({ steps: 8_000, steps_garmin: 8_000, steps_apple: 12_000 });
  });

  it('gives the same answer when the Apple import arrives first', async () => {
    await upsert(apple(12_000));
    expect(await get()).toMatchObject({ steps: 12_000 });          // nothing from Garmin yet
    await upsert(garmin(8_000));
    expect(await get()).toMatchObject({ steps: 8_000, steps_garmin: 8_000, steps_apple: 12_000 });
  });

  it('uses the Apple import only on a day Garmin has no count', async () => {
    await upsert(apple(7_000));
    expect(await get()).toMatchObject({ steps: 7_000, steps_garmin: null });
  });

  it('does not lose Garmin\'s count when a later sync has none for the day', async () => {
    await upsert(garmin(8_000, { resting_hr: 50 }));
    await upsert(garmin(null, { resting_hr: 52, sleep_hours: 7 }));
    expect(await get()).toMatchObject({ steps: 8_000, steps_garmin: 8_000, resting_hr: 52, sleep_hours: 7 });
  });

  it('refuses a zero or an impossible count rather than storing it', async () => {
    await upsert(garmin(0));
    expect((await get()).steps).toBeNull();
    await upsert(garmin(250_000));
    expect((await get()).steps).toBeNull();
  });
});

describe('the iPhone fills Garmin\'s gaps', () => {
  it('adds the phone\'s steps when the export\'s account of Garmin\'s day agrees with Garmin\'s own', async () => {
    await upsert(garmin(6_000));
    await upsert(apple(6_900, 900, 6_100));
    expect(await get()).toMatchObject({ steps: 6_900, steps_fill: 900, steps_fill_ref: 6_100 });
  });

  it('is the same whichever arrives first', async () => {
    await upsert(apple(6_900, 900, 6_100));
    await upsert(garmin(6_000));
    expect((await get()).steps).toBe(6_900);
  });

  it('drops the fill when the export saw a very different Garmin day', async () => {
    await upsert(garmin(6_000));
    await upsert(apple(12_000, 4_000, 2_000));
    expect(await get()).toMatchObject({ steps: 6_000, steps_fill: 4_000, steps_fill_ref: 2_000 });
  });

  it('keeps an earlier fill when a later import has none', async () => {
    await upsert(garmin(6_000));
    await upsert(apple(6_900, 900, 6_100));
    await upsert(apple(5_000, null, null));
    expect((await get()).steps).toBe(6_900);
  });
});

describe('rows stored before the per-source columns', () => {
  const legacy = async (steps: number) => { await db.query(`INSERT INTO wellness (date, steps) VALUES ($1, $2)`, [D, steps]); };

  it('are replaced by Garmin\'s count', async () => {
    await legacy(12_000);
    await upsert(garmin(8_000));
    expect(await get()).toMatchObject({ steps: 8_000, steps_garmin: 8_000 });
  });

  it('are replaced by a corrected Apple import (the inflated total is what needs fixing)', async () => {
    await legacy(12_000);
    await upsert(apple(7_000));
    expect((await get()).steps).toBe(7_000);
  });

  it('are left alone by a sync that has no count for the day', async () => {
    await legacy(12_000);
    await upsert(garmin(null, { resting_hr: 50 }));
    expect(await get()).toMatchObject({ steps: 12_000, resting_hr: 50 });
  });
});

describe('a locked steps value', () => {
  it('is never overwritten, by either source', async () => {
    await upsert(garmin(8_000));
    await db.query(`UPDATE wellness SET steps = 9_500, locked_fields = '["steps"]' WHERE date = $1`, [D]);
    await upsert(garmin(8_200));
    await upsert(apple(12_000));
    expect((await get()).steps).toBe(9_500);
  });
});

describe('the SQL and deriveSteps() agree', () => {
  // A fresh row takes deriveSteps() in TypeScript; the same values applied again take the SQL.
  const cases: [string, WellnessRow[]][] = [
    ['garmin only', [garmin(8_000)]],
    ['apple only', [apple(7_000)]],
    ['apple then garmin', [apple(12_000), garmin(8_000)]],
    ['garmin with a consistent fill', [garmin(6_000), apple(6_900, 900, 6_100)]],
    ['garmin with an inconsistent fill', [garmin(6_000), apple(12_000, 4_000, 2_000)]],
    ['fill exactly at the tolerance', [garmin(5_000), apple(5_100, 100, 4_000)]],
    ['fill just outside it', [garmin(5_000), apple(5_100, 100, 3_999)]],
  ];

  for (const [name, rows] of cases) {
    it(name, async () => {
      for (const r of rows) await upsert(r);
      const first = await get();
      for (const r of rows) await upsert(r);                         // the conflict path, again
      const second = await get();
      expect(second.steps).toBe(first.steps);
      expect(first.steps).toBe(deriveSteps({
        garmin: first.steps_garmin, apple: first.steps_apple, fill: first.steps_fill, fillRef: first.steps_fill_ref,
      }));
    });
  }
});
