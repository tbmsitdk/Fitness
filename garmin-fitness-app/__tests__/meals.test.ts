import { describe, it, expect } from 'vitest';
import {
  carryOverMeal, carryOverStatement, cleanMeal, dayMinutes, deriveDay, descriptionOverlap, editMeal, kcalByMealType,
  likelyDuplicate,
  mealLine, mealTypeFromDescription, mealTypeFromTime, reduceCarryOver,
  noAlcoholStatement, scaleMeal, type Meal,
} from '@/lib/meals';
import type { NutritionLog } from '@/lib/nutrition';

const D = '2026-11-15';

const meal = (over: Partial<Meal> = {}): Meal => ({
  date: D, time: '12:30', meal_type: 'lunch', description: 'Chicken salad',
  kcal: 500, protein_g: 40, carbs_g: 30, added_sugar_g: 2, fat_g: 20, fibre_g: 8, veg_fruit_portions: 2,
  alcohol_g: 0, candy_portions: 0, savoury_snacks: 0, sugary_drinks: 0,
  caffeine: false, ultra_processed: false, drink_only: false, no_alcohol_statement: false, source: 'text',
  ...over,
});
const wine = (over: Partial<Meal> = {}) => meal({ time: '20:00', meal_type: 'in_between', description: '2 glasses of red', kcal: 250, protein_g: 0, carbs_g: 8, added_sugar_g: 0, fat_g: 0, fibre_g: 0, veg_fruit_portions: 0, alcohol_g: 30.8, drink_only: true, ...over });
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
    expect(mealLine(meal())).toBe('Lunch 12:30 Chicken salad — ~500 kcal, 40 g protein, 2 g added sugar, 8 g fibre');
    expect(mealLine(wine())).toBe('In between 20:00 2 glasses of red — ~250 kcal, 2.5 alcohol units');
    expect(mealLine(meal({ time: null, meal_type: 'dinner' }))).toMatch(/^Dinner: Chicken salad/);
    expect(mealLine(meal({ meal_type: null }))).toMatch(/^12:30 Chicken salad/);
    expect(mealLine(noAlcoholStatement(D))).toBe('No alcohol today');
  });
});

describe('breakfast, lunch, dinner and in between', () => {
  it('keeps the type the person gave, whatever the clock says', () => {
    expect(cleanMeal({ description: 'Late breakfast', time: '11:45', meal_type: 'breakfast' }, D)!.meal_type).toBe('breakfast');
    expect(cleanMeal({ description: 'Early dinner', time: '16:30', meal_type: 'dinner' }, D)!.meal_type).toBe('dinner');
  });

  it('falls back to the time of day when no valid type is given', () => {
    expect(cleanMeal({ description: 'x', time: '07:30' }, D)!.meal_type).toBe('breakfast');
    expect(cleanMeal({ description: 'x', time: '12:30', meal_type: 'brunch' }, D)!.meal_type).toBe('lunch');
    expect(mealTypeFromTime('19:00')).toBe('dinner');
    expect(mealTypeFromTime('15:30')).toBe('in_between');
    expect(mealTypeFromTime('22:30')).toBe('in_between');
    expect(mealTypeFromTime('00:30')).toBe('in_between');
  });

  it('leaves the type unknown with neither a type nor a time, rather than guessing', () => {
    expect(cleanMeal({ description: 'x' }, D)!.meal_type).toBeNull();
    expect(carryOverMeal({ date: D, alcohol_units: 2, candy_portions: null, savoury_snacks: null, sugary_drinks: null, last_food_time: null, caffeine_after_14: null, notes: null })!.meal_type).toBeNull();
  });

  const day = [
    meal({ time: '07:30', meal_type: 'breakfast', kcal: 400 }),
    meal({ kcal: 600 }),
    meal({ time: '15:30', meal_type: 'in_between', description: 'Cake', kcal: 300 }),
    meal({ time: '19:00', meal_type: 'dinner', kcal: 500 }),
    wine({ kcal: 200 }),
  ];

  it('computes the share of calories eaten in between meals, on a complete day only', () => {
    expect(deriveDay(D, day, true).in_between_kcal_pct).toBe(25); // cake 300 + wine 200 of 2000
    expect(deriveDay(D, day, false).in_between_kcal_pct).toBeNull();
  });

  it('withholds that share when an entry with calories has no type', () => {
    expect(deriveDay(D, [...day, meal({ meal_type: null, kcal: 100 })], true).in_between_kcal_pct).toBeNull();
  });

  it('groups a day by meal with a calorie subtotal each', () => {
    const groups = kcalByMealType([...day, noAlcoholStatement(D)]);
    expect(groups.map(g => [g.label, g.meals.length, g.kcal])).toEqual([
      ['Breakfast', 1, 400], ['Lunch', 1, 600], ['Dinner', 1, 500], ['In between', 2, 500],
    ]);
  });

  it('shows no subtotal for a group holding an entry without an estimate, and collects untyped entries', () => {
    const groups = kcalByMealType([meal({ kcal: null }), meal({ meal_type: null, description: 'Logged by hand earlier' })]);
    expect(groups.map(g => [g.label, g.kcal])).toEqual([['Lunch', null], ['Not sorted', 500]]);
  });
});

describe('likelyDuplicate — the same food entered twice', () => {
  const lunch = meal({ id: 1, description: 'Chicken salad with a bread roll' });

  it('catches the same meal entered again, however it is worded', () => {
    expect(likelyDuplicate(meal({ description: 'chicken salad and a roll' }), [lunch])).toBe(lunch);
    expect(likelyDuplicate(meal({ description: 'Chicken salad', time: '12:45' }), [lunch])).toBe(lunch);
    expect(likelyDuplicate(meal({ description: 'Kyllingesalat' }), [meal({ id: 2, description: 'kyllingesalat med brød' })])).not.toBeNull();
  });

  it('catches it when the second entry has no time, if it is the same kind of meal', () => {
    expect(likelyDuplicate(meal({ description: 'Chicken salad', time: null }), [lunch])).toBe(lunch);
  });

  // The guard must not eat real second helpings.
  it('does NOT flag the same dish at a different meal', () => {
    expect(likelyDuplicate(meal({ description: 'Chicken salad', time: '19:00', meal_type: 'dinner' }), [lunch])).toBeNull();
  });

  it('does NOT flag a second coffee hours later', () => {
    const coffee = (time: string) => meal({ description: 'Coffee with milk', time, meal_type: 'in_between', kcal: 30 });
    expect(likelyDuplicate(coffee('15:30'), [coffee('10:00')])).toBeNull();
    expect(likelyDuplicate(coffee('10:20'), [coffee('10:00')])).not.toBeNull();
  });

  it('does not flag different food at the same meal, or the same food on another day', () => {
    expect(likelyDuplicate(meal({ description: 'Tomato soup' }), [lunch])).toBeNull();
    expect(likelyDuplicate(meal({ description: 'Chicken salad', date: '2026-11-14' }), [lunch])).toBeNull();
  });

  it('ignores the "no alcohol" statement and empty descriptions', () => {
    expect(likelyDuplicate(meal({ description: 'No alcohol today' }), [noAlcoholStatement(D)])).toBeNull();
    expect(descriptionOverlap('', 'chicken')).toBe(0);
    expect(descriptionOverlap('a', 'the')).toBe(0);
  });
});

describe('typed amounts and diary meals for the same day', () => {
  const typed = () => carryOverMeal({ date: D, alcohol_units: 5.5, candy_portions: 2, savoury_snacks: 1, sugary_drinks: null, last_food_time: '21:30', caffeine_after_14: null, notes: null })!;
  const dinner = meal({ time: null, meal_type: 'dinner', description: 'Aftensmad: ris med kødsovs, vin, chips, lakrids', kcal: 1900, alcohol_g: 66, candy_portions: 2, savoury_snacks: 1 });

  // The real case: 5.5 units typed, then the same evening described in Quick log → the app showed 11.
  it('does not count the wine twice when the day is described after being typed', () => {
    expect(reduceCarryOver(typed(), [dinner])).toBeNull();
    expect(deriveDay(D, [dinner], true).alcohol_units).toBe(5.5);
  });

  it('keeps typed amounts that the logged meals do not explain', () => {
    const lunchOnly = meal({ description: 'Frokost: kaffe og chokoladebar', candy_portions: 2 });
    const rest = reduceCarryOver(typed(), [lunchOnly])!;
    expect(rest.alcohol_g).toBe(66);        // the evening's wine is still there
    expect(rest.candy_portions).toBe(0);    // the chocolate is now in the lunch entry
    expect(rest.savoury_snacks).toBe(1);
    expect(rest.description).toBe('Logged by hand earlier, not covered by the meals above: 5.5 alcohol units, 1 savoury snacks');
    // The day's totals are unchanged by adding the lunch: still 5.5 units and 2 candy.
    const d = deriveDay(D, [rest, lunchOnly], false);
    expect(d.alcohol_units).toBe(5.5);
    expect(d.candy_portions).toBe(2);
  });

  it('keeps only the part of a typed amount the meals fall short of, and never goes negative', () => {
    const oneGlass = meal({ description: '1 glass of wine', alcohol_g: 15.4, candy_portions: 5 });
    const rest = reduceCarryOver(typed(), [oneGlass])!;
    expect(rest.alcohol_g).toBe(50.6);
    expect(rest.candy_portions).toBe(0);
    expect(deriveDay(D, [rest, oneGlass], false).alcohol_units).toBe(5.5);
  });

  it('lets a logged coffee explain a typed "caffeine after 14:00"', () => {
    const carry = carryOverMeal({ date: D, alcohol_units: null, candy_portions: null, savoury_snacks: null, sugary_drinks: null, last_food_time: null, caffeine_after_14: true, notes: null })!;
    expect(reduceCarryOver(carry, [meal({ description: 'Espresso', time: '15:30', caffeine: true })])).toBeNull();
    expect(reduceCarryOver(carry, [meal()])!.caffeine).toBe(true);
  });
});

describe('meal named in its own description', () => {
  it('sorts Danish and English labels', () => {
    expect(mealTypeFromDescription('Morgenmad: 2 stk. knækbrød')).toBe('breakfast');
    expect(mealTypeFromDescription('Frokost: 1 kop sort kaffe')).toBe('lunch');
    expect(mealTypeFromDescription('Aftensmad: 2 portioner ris')).toBe('dinner');
    expect(mealTypeFromDescription('Dinner - pasta')).toBe('dinner');
    expect(mealTypeFromDescription('Mellemmåltid: æble')).toBe('in_between');
  });

  it('does not sort on a word in the middle, or a lookalike', () => {
    expect(mealTypeFromDescription('Leftovers from lunch')).toBeNull();
    expect(mealTypeFromDescription('Lunchbox snack bar')).toBeNull();
    expect(mealTypeFromDescription('Chicken salad')).toBeNull();
  });

  it('is used when no type is given, ahead of the time of day', () => {
    expect(cleanMeal({ description: 'Frokost: kaffe', time: '15:30' }, D)!.meal_type).toBe('lunch');
    expect(cleanMeal({ description: 'Frokost: kaffe', meal_type: 'in_between' }, D)!.meal_type).toBe('in_between');
  });
});

describe('eating window', () => {
  it('is not reported from a single timed meal', () => {
    expect(deriveDay(D, [meal({ time: '21:30' }), meal({ time: null })], true).eating_window_h).toBeNull();
    expect(deriveDay(D, [meal({ time: '08:00' }), meal({ time: '20:00' })], true).eating_window_h).toBe(12);
  });
});

describe('editMeal — correcting an entry by hand', () => {
  const dinner = meal({ id: 7, time: null, meal_type: 'dinner', description: 'Aftensmad: ris med kødsovs og vin', kcal: 1900, alcohol_g: 132, source: 'photo' });

  // The real correction: the entry said 11 units, it was half a bottle plus two glasses.
  it('takes alcohol in units and stores grams', () => {
    const m = editMeal(dinner, { description: dinner.description, alcohol_units: 5.5, kcal: 1500 })!;
    expect(m.alcohol_g).toBe(66);
    expect(m.kcal).toBe(1500);
    expect(deriveDay(D, [m], true).alcohol_units).toBe(5.5);
  });

  it('keeps the id, the day and where the entry came from', () => {
    const m = editMeal(dinner, { description: 'Ris med kødsovs', date: '2020-01-01', source: 'manual', id: 99 })!;
    expect(m).toMatchObject({ id: 7, date: D, source: 'photo', description: 'Ris med kødsovs' });
  });

  it('leaves alcohol alone when the edit does not mention it', () => {
    expect(editMeal(dinner, { description: 'x' })!.alcohol_g).toBe(132);
    expect(editMeal(dinner, { description: 'x', alcohol_units: 0 })!.alcohol_g).toBe(0);
    expect(editMeal(dinner, { description: 'x', alcohol_units: 'lots' })!.alcohol_g).toBe(132);
  });

  it('keeps a blanked estimate as unknown, not zero', () => {
    const m = editMeal(dinner, { description: 'x', kcal: null, protein_g: '' })!;
    expect(m.kcal).toBeNull();
    expect(m.protein_g).toBeNull();
  });

  it('respects an explicit "not sorted", and sets a time', () => {
    expect(editMeal(dinner, { description: 'Pasta', time: '19:30', meal_type: null })!.meal_type).toBeNull();
    expect(editMeal(dinner, { description: 'Pasta', time: '19:30', meal_type: 'lunch' })!.meal_type).toBe('lunch');
    expect(editMeal(dinner, { description: 'Pasta', time: '19:30' })!.time).toBe('19:30');
  });

  it('refuses an edit that removes the description', () => {
    expect(editMeal(dinner, { description: '   ' })).toBeNull();
    expect(editMeal(dinner, null)).toBeNull();
  });
});
