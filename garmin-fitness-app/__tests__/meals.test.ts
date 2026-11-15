import { describe, it, expect } from 'vitest';
import {
  carryOverMeal, carryOverStatement, cleanMeal, dayMinutes, deriveDay, mealLine, noAlcoholStatement, scaleMeal,
  type Meal,
} from '@/lib/meals';
import type { NutritionLog } from '@/lib/nutrition';

const D = '2026-11-15';

const meal = (over: Partial<Meal> = {}): Meal => ({
  date: D, time: '12:30', description: 'Chicken salad',
  kcal: 500, protein_g: 40, carbs_g: 30, added_sugar_g: 2, fat_g: 20, fibre_g: 8, veg_fruit_portions: 2,
  alcohol_g: 0, candy_portions: 0, savoury_snacks: 0, sugary_drinks: 0,
  caffeine: false, ultra_processed: false, drink_only: false, no_alcohol_statement: false, source: 'text',
  ...over,
});
const wine = (over: Partial<Meal> = {}) => meal({ time: '20:00', description: '2 glasses of red', kcal: 250, protein_g: 0, carbs_g: 8, added_sugar_g: 0, fat_g: 0, fibre_g: 0, veg_fruit_portions: 0, alcohol_g: 30.8, drink_only: true, ...over });
const manual = (over: Partial<NutritionLog> = {}): NutritionLog => ({
  date: D, alcohol_units: null, candy_portions: null, savoury_snacks: null, sugary_drinks: null,
  last_food_time: null, caffeine_after_14: null, notes: null, ...over,
});

describe('deriveDay — what is known on a partial day', () => {
  // Lesson 4. Lunch logged, nothing else: that says nothing about the evening.
  it('does NOT report zero alcohol or sweets just because none are logged yet', () => {
    const d = deriveDay(D, [meal()], false);
    expect(d.alcohol_units).toBeNull();
    expect(d.candy_portions).toBeNull();
    expect(d.savoury_snacks).toBeNull();
    expect(d.sugary_drinks).toBeNull();
    expect(d.caffeine_after_14).toBeNull();
  });

  it('reports no day totals for a partial day — half a day is not a low-calorie day', () => {
    const d = deriveDay(D, [meal()], false);
    for (const k of ['kcal', 'protein_g', 'carbs_g', 'added_sugar_g', 'fat_g', 'fibre_g', 'veg_fruit_portions', 'evening_kcal_pct', 'ultra_processed_pct', 'eating_window_h', 'first_food_time'] as const) {
      expect(d[k], k).toBeNull();
    }
    expect(d.day_complete).toBe(false);
    expect(d.meal_count).toBe(1);
  });

  it('still reports what IS known: drinks and sweets that were logged, and the last food time', () => {
    const d = deriveDay(D, [meal(), wine(), meal({ time: '21:15', description: 'crisps', kcal: 160, savoury_snacks: 1, ultra_processed: true })], false);
    expect(d.alcohol_units).toBe(2.5);
    expect(d.savoury_snacks).toBe(1);
    expect(d.last_food_time).toBe('21:15');
    expect(d.candy_portions).toBeNull(); // none logged, day not complete
  });

  it('takes "no alcohol today" as a known zero even on a partial day', () => {
    const d = deriveDay(D, [meal(), noAlcoholStatement(D)], false);
    expect(d.alcohol_units).toBe(0);
    expect(d.meal_count).toBe(1); // the statement is not a meal
  });

  it('does not let a statement override drinks that were logged', () => {
    expect(deriveDay(D, [wine(), noAlcoholStatement(D)], false).alcohol_units).toBe(2.5);
  });
});

describe('deriveDay — a complete day', () => {
  const day = [
    meal({ time: '07:30', description: 'Porridge', kcal: 400, protein_g: 15, carbs_g: 60, added_sugar_g: 5, fat_g: 10, fibre_g: 6, veg_fruit_portions: 1 }),
    meal(),
    meal({ time: '19:30', description: 'Pizza', kcal: 900, protein_g: 35, carbs_g: 100, added_sugar_g: 8, fat_g: 38, fibre_g: 6, veg_fruit_portions: 1, ultra_processed: true }),
    wine({ kcal: 200 }),
  ];

  it('turns absences into real zeros', () => {
    const d = deriveDay(D, day, true);
    expect(d.candy_portions).toBe(0);
    expect(d.savoury_snacks).toBe(0);
    expect(d.sugary_drinks).toBe(0);
    expect(d.caffeine_after_14).toBe(false);
    expect(deriveDay(D, [meal()], true).alcohol_units).toBe(0);
  });

  it('adds up the totals', () => {
    const d = deriveDay(D, day, true);
    expect(d.kcal).toBe(2000);
    expect(d.protein_g).toBe(90);
    expect(d.fibre_g).toBe(20);
    expect(d.added_sugar_g).toBe(15);
    expect(d.veg_fruit_portions).toBe(4);
  });

  it('computes the evening and ultra-processed shares of calories', () => {
    const d = deriveDay(D, day, true);
    expect(d.evening_kcal_pct).toBe(55);      // pizza 900 + wine 200 of 2000
    expect(d.ultra_processed_pct).toBe(45);   // pizza 900 of 2000
  });

  it('computes the eating window from first to last FOOD', () => {
    const d = deriveDay(D, day, true);
    expect(d.first_food_time).toBe('07:30');
    expect(d.last_food_time).toBe('20:00');   // wine has calories, so it counts
    expect(d.eating_window_h).toBe(12.5);
  });

  it('withholds a total when any meal has no estimate, instead of treating it as zero', () => {
    const d = deriveDay(D, [...day, meal({ description: 'Logged by hand earlier', kcal: null, protein_g: null })], true);
    expect(d.kcal).toBeNull();
    expect(d.protein_g).toBeNull();
    expect(d.fibre_g).toBe(28); // that field is known for every meal
    expect(d.evening_kcal_pct).toBeNull();
  });

  it('withholds the evening share when a meal with calories has no time', () => {
    const d = deriveDay(D, [meal(), meal({ time: null })], true);
    expect(d.kcal).toBe(1000);
    expect(d.evening_kcal_pct).toBeNull();
  });

  it('has no totals on a complete day with nothing eaten logged', () => {
    const d = deriveDay(D, [noAlcoholStatement(D)], true);
    expect(d.kcal).toBeNull();
    expect(d.meal_count).toBe(0);
  });
});

describe('times', () => {
  // Lesson 5 territory: 00:30 is late, not early.
  it('sorts after-midnight eating as the end of the day', () => {
    expect(dayMinutes('00:30')).toBeGreaterThan(dayMinutes('23:30'));
    const d = deriveDay(D, [meal({ time: '19:00' }), meal({ time: '00:30', description: 'kebab' })], true);
    expect(d.last_food_time).toBe('00:30');
    expect(d.first_food_time).toBe('19:00');
    expect(d.eating_window_h).toBe(5.5);
    expect(d.evening_kcal_pct).toBe(100);
  });

  it('does not count a calorie-free drink as food', () => {
    const coffee = meal({ time: '22:00', description: 'black coffee', kcal: 0, protein_g: 0, carbs_g: 0, added_sugar_g: 0, fat_g: 0, fibre_g: 0, veg_fruit_portions: 0, caffeine: true, drink_only: true });
    const d = deriveDay(D, [meal({ time: '18:00' }), coffee], true);
    expect(d.last_food_time).toBe('18:00');
    expect(d.caffeine_after_14).toBe(true);
  });

  it('flags caffeine after 14:00 from a timed coffee, even on a partial day', () => {
    const coffee = (time: string | null) => meal({ time, description: 'espresso', kcal: 5, caffeine: true, drink_only: true });
    expect(deriveDay(D, [coffee('15:30')], false).caffeine_after_14).toBe(true);
    expect(deriveDay(D, [coffee('08:00')], false).caffeine_after_14).toBeNull(); // partial: a later one may be missing
    expect(deriveDay(D, [coffee('08:00')], true).caffeine_after_14).toBe(false);
    expect(deriveDay(D, [coffee(null)], true).caffeine_after_14).toBeNull();     // when it was drunk is unknown
  });
});

describe('carry-over from a hand-logged day', () => {
  it('turns typed amounts into one diary entry with unknown calories', () => {
    const m = carryOverMeal(manual({ alcohol_units: 2, candy_portions: 1, last_food_time: '21:30' }))!;
    expect(m.alcohol_g).toBe(24);
    expect(m.candy_portions).toBe(1);
    expect(m.time).toBe('21:30');
    expect(m.kcal).toBeNull();
    expect(m.source).toBe('manual');
    // Round trip: the derived day shows exactly what was typed. No loss, no doubling.
    const d = deriveDay(D, [m], false);
    expect(d.alcohol_units).toBe(2);
    expect(d.candy_portions).toBe(1);
    expect(d.last_food_time).toBe('21:30');
  });

  it('keeps a typed "0 alcohol" as a statement', () => {
    const row = manual({ alcohol_units: 0 });
    expect(carryOverMeal(row)).toBeNull();
    const s = carryOverStatement(row)!;
    expect(deriveDay(D, [meal(), s], false).alcohol_units).toBe(0);
    expect(carryOverStatement(manual({ alcohol_units: 2 }))).toBeNull();
  });

  it('keeps "caffeine after 14:00" true through the carry-over', () => {
    const m = carryOverMeal(manual({ caffeine_after_14: true }))!;
    expect(deriveDay(D, [m], false).caffeine_after_14).toBe(true);
  });

  it('carries nothing from an empty row or from a row that already came from meals', () => {
    expect(carryOverMeal(manual({ notes: 'travel day' }))).toBeNull();
    expect(carryOverMeal({ ...manual({ alcohol_units: 2 }), from_meals: true })).toBeNull();
    expect(carryOverStatement({ ...manual({ alcohol_units: 0 }), from_meals: true })).toBeNull();
  });
});

describe('scaleMeal / cleanMeal / mealLine', () => {
  it('rescales every amount together and clamps the factor', () => {
    const half = scaleMeal(wine(), 0.5);
    expect(half.kcal).toBe(125);
    expect(half.alcohol_g).toBe(15.4);
    expect(scaleMeal(meal(), 100).kcal).toBe(2500);
    expect(scaleMeal(meal({ kcal: null }), 2).kcal).toBeNull();
  });

  it('cleans a meal from the client: clamps, defaults, and keeps unknowns unknown', () => {
    const m = cleanMeal({ description: '  Pasta \n bolognese ', time: '19:30', kcal: 650.4, protein_g: -3, alcohol_g: 'lots', caffeine: 'yes', source: 'photo' }, D)!;
    expect(m.description).toBe('Pasta bolognese');
    expect(m.kcal).toBe(650);
    expect(m.protein_g).toBeNull();   // invalid → unknown, not 0
    expect(m.alcohol_g).toBe(0);
    expect(m.caffeine).toBe(false);
    expect(m.source).toBe('photo');
    expect(cleanMeal({ description: 'x', time: '7pm' }, D)!.time).toBeNull();
    expect(cleanMeal({ description: '' }, D)).toBeNull();
    expect(cleanMeal(null, D)).toBeNull();
    expect(cleanMeal({ description: 'x', kcal: 999999 }, D)!.kcal).toBe(6000);
  });

  it('describes a meal in one line', () => {
    expect(mealLine(meal())).toBe('12:30 Chicken salad — ~500 kcal, 40 g protein, 2 g added sugar, 8 g fibre');
    expect(mealLine(wine())).toBe('20:00 2 glasses of red — ~250 kcal, 2.5 alcohol units');
    expect(mealLine(noAlcoholStatement(D))).toBe('No alcohol today');
  });
});
