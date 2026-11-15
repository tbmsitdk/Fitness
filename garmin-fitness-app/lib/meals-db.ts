// Postgres storage for the meal diary. Every write re-derives the day's
// nutrition row inside the same connection, so the diary and the row the
// analyses read can never be out of step.

import { createClient, type VercelClient } from '@vercel/postgres';
import { initializeDatabase } from '@/lib/db';
import { coerceNutritionLog } from '@/lib/nutrition';
import {
  carryOverMeal, carryOverStatement, deriveDay, isMealType, noAlcoholStatement, scaleMeal, type Meal, type MealType,
} from '@/lib/meals';

let ready: Promise<void> | null = null;
/** Tables and columns are created once per server instance. */
function ensureSchema(): Promise<void> {
  ready ??= initializeDatabase().then(() => undefined, (e) => { ready = null; throw e; });
  return ready;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMeal(r: any): Meal {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: Number(r.id),
    date: String(r.day ?? r.date).slice(0, 10),
    time: r.time == null ? null : String(r.time).slice(0, 5),
    meal_type: isMealType(r.meal_type) ? r.meal_type : null,
    description: String(r.description),
    kcal: num(r.kcal), protein_g: num(r.protein_g), carbs_g: num(r.carbs_g), added_sugar_g: num(r.added_sugar_g),
    fat_g: num(r.fat_g), fibre_g: num(r.fibre_g), veg_fruit_portions: num(r.veg_fruit_portions),
    alcohol_g: Number(r.alcohol_g) || 0,
    candy_portions: Number(r.candy_portions) || 0,
    savoury_snacks: Number(r.savoury_snacks) || 0,
    sugary_drinks: Number(r.sugary_drinks) || 0,
    caffeine: r.caffeine === true, ultra_processed: r.ultra_processed === true,
    drink_only: r.drink_only === true, no_alcohol_statement: r.no_alcohol_statement === true,
    source: r.source === 'photo' ? 'photo' : r.source === 'manual' ? 'manual' : 'text',
  };
}

async function withClient<T>(fn: (c: VercelClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  // A direct connection, not the pool: these read their own writes.
  const client = createClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

const mealsOn = async (c: VercelClient, date: string): Promise<Meal[]> =>
  (await c.query(`SELECT *, date::text AS day FROM meals WHERE date = $1 ORDER BY time NULLS LAST, id`, [date])).rows.map(toMeal);

async function insertMeal(c: VercelClient, m: Meal): Promise<void> {
  await c.query(
    `INSERT INTO meals (date, time, description, kcal, protein_g, carbs_g, added_sugar_g, fat_g, fibre_g,
                        veg_fruit_portions, alcohol_g, candy_portions, savoury_snacks, sugary_drinks,
                        caffeine, ultra_processed, drink_only, no_alcohol_statement, source, meal_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [m.date, m.time, m.description, m.kcal, m.protein_g, m.carbs_g, m.added_sugar_g, m.fat_g, m.fibre_g,
     m.veg_fruit_portions, m.alcohol_g, m.candy_portions, m.savoury_snacks, m.sugary_drinks,
     m.caffeine, m.ultra_processed, m.drink_only, m.no_alcohol_statement, m.source, m.meal_type],
  );
}

/**
 * Recomputes the day's nutrition row from its meals. With no meals left, a
 * derived row is cleared (and removed if nothing but emptiness remains) — the
 * day goes back to "not logged", never to a row of zeros.
 */
async function rederive(c: VercelClient, date: string, complete?: boolean): Promise<void> {
  const meals = await mealsOn(c, date);
  const prev = (await c.query(`SELECT from_meals, day_complete, notes FROM nutrition_logs WHERE date = $1`, [date])).rows[0];
  const isComplete = complete ?? (prev?.day_complete === true);

  if (meals.length === 0 && !isComplete) {
    if (prev?.from_meals === true) {
      if (prev.notes) {
        await c.query(
          `UPDATE nutrition_logs SET from_meals = FALSE, day_complete = FALSE, meal_count = NULL,
             alcohol_units = NULL, candy_portions = NULL, savoury_snacks = NULL, sugary_drinks = NULL,
             last_food_time = NULL, caffeine_after_14 = NULL, kcal = NULL, protein_g = NULL, carbs_g = NULL,
             added_sugar_g = NULL, fat_g = NULL, fibre_g = NULL, veg_fruit_portions = NULL,
             evening_kcal_pct = NULL, ultra_processed_pct = NULL, in_between_kcal_pct = NULL, first_food_time = NULL,
             eating_window_h = NULL, updated_at = NOW()
           WHERE date = $1`, [date]);
      } else {
        await c.query(`DELETE FROM nutrition_logs WHERE date = $1`, [date]);
      }
    }
    return;
  }

  const d = deriveDay(date, meals, isComplete);
  await c.query(
    `INSERT INTO nutrition_logs
       (date, alcohol_units, candy_portions, savoury_snacks, sugary_drinks, last_food_time, caffeine_after_14,
        from_meals, day_complete, meal_count, kcal, protein_g, carbs_g, added_sugar_g, fat_g, fibre_g,
        veg_fruit_portions, evening_kcal_pct, ultra_processed_pct, first_food_time, eating_window_h,
        in_between_kcal_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (date) DO UPDATE SET
       alcohol_units = EXCLUDED.alcohol_units, candy_portions = EXCLUDED.candy_portions,
       savoury_snacks = EXCLUDED.savoury_snacks, sugary_drinks = EXCLUDED.sugary_drinks,
       last_food_time = EXCLUDED.last_food_time, caffeine_after_14 = EXCLUDED.caffeine_after_14,
       from_meals = TRUE, day_complete = EXCLUDED.day_complete, meal_count = EXCLUDED.meal_count,
       kcal = EXCLUDED.kcal, protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g,
       added_sugar_g = EXCLUDED.added_sugar_g, fat_g = EXCLUDED.fat_g, fibre_g = EXCLUDED.fibre_g,
       veg_fruit_portions = EXCLUDED.veg_fruit_portions, evening_kcal_pct = EXCLUDED.evening_kcal_pct,
       ultra_processed_pct = EXCLUDED.ultra_processed_pct, first_food_time = EXCLUDED.first_food_time,
       eating_window_h = EXCLUDED.eating_window_h, in_between_kcal_pct = EXCLUDED.in_between_kcal_pct,
       updated_at = NOW()`,
    [date, d.alcohol_units, d.candy_portions, d.savoury_snacks, d.sugary_drinks, d.last_food_time, d.caffeine_after_14,
     d.day_complete, d.meal_count, d.kcal, d.protein_g, d.carbs_g, d.added_sugar_g, d.fat_g, d.fibre_g,
     d.veg_fruit_portions, d.evening_kcal_pct, d.ultra_processed_pct, d.first_food_time, d.eating_window_h,
     d.in_between_kcal_pct],
  );
}

/**
 * Before the first meal lands on a hand-logged day, what was typed becomes a
 * diary entry, so it is neither lost nor counted twice.
 */
async function carryOver(c: VercelClient, date: string): Promise<void> {
  const { rows } = await c.query(`SELECT *, date::text AS day FROM nutrition_logs WHERE date = $1`, [date]);
  if (!rows[0] || rows[0].from_meals === true) return;
  const row = coerceNutritionLog(rows[0]);
  for (const m of [carryOverMeal(row), carryOverStatement(row)]) if (m) await insertMeal(c, m);
}

export interface DayDiary {
  date: string;
  meals: Meal[];
  complete: boolean;
}

export function getDay(date: string): Promise<DayDiary> {
  return withClient(async c => {
    const row = (await c.query(`SELECT day_complete FROM nutrition_logs WHERE date = $1`, [date])).rows[0];
    return { date, meals: await mealsOn(c, date), complete: row?.day_complete === true };
  });
}

export function listMeals(from: string): Promise<Meal[]> {
  return withClient(async c =>
    (await c.query(`SELECT *, date::text AS day FROM meals WHERE date >= $1 ORDER BY date, time NULLS LAST, id`, [from])).rows.map(toMeal));
}

/** Adds meals (and optionally the statements about the day) and re-derives the day. */
export function addToDay(date: string, meals: Meal[], opts: { noAlcohol?: boolean; complete?: boolean } = {}): Promise<DayDiary> {
  return withClient(async c => {
    await carryOver(c, date);
    for (const m of meals) await insertMeal(c, { ...m, date });
    if (opts.noAlcohol) {
      const has = (await mealsOn(c, date)).some(m => m.no_alcohol_statement);
      if (!has) await insertMeal(c, noAlcoholStatement(date));
    }
    await rederive(c, date, opts.complete);
    const row = (await c.query(`SELECT day_complete FROM nutrition_logs WHERE date = $1`, [date])).rows[0];
    return { date, meals: await mealsOn(c, date), complete: row?.day_complete === true };
  });
}

/** Marks the day complete or not. Carries hand-typed amounts over first, like adding a meal does. */
export function setDayComplete(date: string, complete: boolean): Promise<DayDiary> {
  return withClient(async c => {
    await carryOver(c, date);
    await rederive(c, date, complete);
    return { date, meals: await mealsOn(c, date), complete };
  });
}

export function deleteMeal(id: number): Promise<boolean> {
  return withClient(async c => {
    const { rows } = await c.query(`DELETE FROM meals WHERE id = $1 RETURNING date::text AS day`, [id]);
    if (!rows[0]) return false;
    await rederive(c, String(rows[0].day));
    return true;
  });
}

/** Rescales one meal's portion. */
export function rescaleMeal(id: number, factor: number): Promise<boolean> {
  return withClient(async c => {
    const { rows } = await c.query(`SELECT *, date::text AS day FROM meals WHERE id = $1`, [id]);
    if (!rows[0]) return false;
    const m = scaleMeal(toMeal(rows[0]), factor);
    await c.query(
      `UPDATE meals SET kcal=$2, protein_g=$3, carbs_g=$4, added_sugar_g=$5, fat_g=$6, fibre_g=$7,
              veg_fruit_portions=$8, alcohol_g=$9, candy_portions=$10, savoury_snacks=$11, sugary_drinks=$12
       WHERE id=$1`,
      [id, m.kcal, m.protein_g, m.carbs_g, m.added_sugar_g, m.fat_g, m.fibre_g,
       m.veg_fruit_portions, m.alcohol_g, m.candy_portions, m.savoury_snacks, m.sugary_drinks],
    );
    await rederive(c, m.date);
    return true;
  });
}

/** Moves one entry to another kind of meal (or to "not sorted" with null). */
export function setMealType(id: number, mealType: MealType | null): Promise<boolean> {
  return withClient(async c => {
    const { rows } = await c.query(`UPDATE meals SET meal_type = $2 WHERE id = $1 RETURNING date::text AS day`, [id, mealType]);
    if (!rows[0]) return false;
    await rederive(c, String(rows[0].day));
    return true;
  });
}
