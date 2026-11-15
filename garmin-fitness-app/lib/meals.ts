// The meal diary. One row per thing eaten or drunk; the day's nutrition row is
// DERIVED from the day's meals here, so the diary is the single source of truth
// on any day that has one (tasks/lessons.md 14).
//
// The null-versus-zero rule (lesson 4) decides almost everything below:
//   - A positive amount in the meals is known, complete day or not.
//   - A ZERO is known only when the person has confirmed the day is complete
//     (or, for alcohol, said outright that they had none). Otherwise "no
//     alcohol among the meals logged so far" is simply not yet known.
//   - Day totals (calories, protein…) exist only for a complete day in which
//     every meal has an estimate. Half a day's calories is not a low-calorie day.

import { GRAMS_PER_UNIT, type NutritionLog } from '@/lib/nutrition';

export type MealSource = 'text' | 'photo' | 'manual';

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'in_between'] as const;
export type MealType = typeof MEAL_TYPES[number];
export const MEAL_TYPE_LABEL: Record<MealType, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', in_between: 'In between',
};

export function isMealType(v: unknown): v is MealType {
  return typeof v === 'string' && (MEAL_TYPES as readonly string[]).includes(v);
}

/**
 * A fallback only, for an entry that arrives without a type: the person's own
 * word ("lunch: …") always wins. Outside the usual meal hours it is "in between".
 */
const MEAL_WORDS: [MealType, RegExp][] = [
  ['breakfast',  /^(breakfast|morgenmad|morgenmaden)\b/i],
  ['lunch',      /^(lunch|frokost|frokosten)\b/i],
  ['dinner',     /^(dinner|supper|aftensmad|aftensmaden|middag|middagsmad)\b/i],
  ['in_between', /^(snack|snacks|in between|mellemm[aå]ltid|eftermiddagssnack)\b/i],
];

/** "Frokost: …" or "Dinner - …" names its own meal. Used when no type was given. */
export function mealTypeFromDescription(description: string): MealType | null {
  const start = description.trim();
  for (const [type, pattern] of MEAL_WORDS) if (pattern.test(start)) return type;
  return null;
}

export function mealTypeFromTime(time: string | null): MealType | null {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  const mins = h * 60 + m;
  if (mins >= 5 * 60 && mins < 10 * 60 + 30) return 'breakfast';
  if (mins >= 11 * 60 + 30 && mins < 14 * 60 + 30) return 'lunch';
  if (mins >= 17 * 60 + 30 && mins < 21 * 60) return 'dinner';
  return 'in_between';
}

export interface Meal {
  id?: number;
  /** The day the meal belongs to (after-midnight eating belongs to the evening before). */
  date: string;
  /** 'HH:MM', or null when not known. */
  time: string | null;
  /** Breakfast, lunch, dinner or in between. Null when it cannot be told (e.g. amounts typed by hand). */
  meal_type: MealType | null;
  description: string;
  /** Estimates. Null = unknown (a hand-logged count carried over has no calories). */
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  added_sugar_g: number | null;
  fat_g: number | null;
  fibre_g: number | null;
  veg_fruit_portions: number | null;
  /** Grams of pure alcohol, computed in code from volume and strength. */
  alcohol_g: number;
  candy_portions: number;
  savoury_snacks: number;
  sugary_drinks: number;
  caffeine: boolean;
  ultra_processed: boolean;
  /** A drink with no food: it does not move "last food time" unless it has calories. */
  drink_only: boolean;
  /** Not a meal: the statement "no alcohol today". */
  no_alcohol_statement: boolean;
  source: MealSource;
}

export const NUTRIENT_FIELDS = ['kcal', 'protein_g', 'carbs_g', 'added_sugar_g', 'fat_g', 'fibre_g', 'veg_fruit_portions'] as const;
export type NutrientField = typeof NUTRIENT_FIELDS[number];

/** Meals at or after this hour count as evening eating. */
export const EVENING_FROM_HOUR = 19;
/** Before this hour, a time belongs to the previous evening. */
const NIGHT_UNTIL_HOUR = 5;

const isTime = (t: string | null): t is string => !!t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** Minutes on a clock where 00:00-04:59 comes AFTER 23:59, so late-night eating sorts as late. */
export function dayMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h < NIGHT_UNTIL_HOUR ? h + 24 : h) * 60 + m;
}
const isEvening = (time: string) => dayMinutes(time) >= EVENING_FROM_HOUR * 60;
const isAfter14 = (time: string) => dayMinutes(time) >= 14 * 60;

/** An entry that counts as eating: anything but a calorie-free drink (black coffee, water). */
const isFood = (m: Meal) => !(m.drink_only && !(m.kcal && m.kcal > 0));

/**
 * Entries with food in them but no time. While any exist, the day's last food,
 * first food and eating window cannot be known: the untimed entry might be the
 * latest thing eaten.
 */
export function untimedFood(meals: Meal[]): Meal[] {
  return meals.filter(m => !m.no_alcohol_statement && isFood(m) && !isTime(m.time));
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export type DerivedDay = Omit<NutritionLog, 'id' | 'notes'>;

/**
 * The day's nutrition row, computed from its meals.
 * `complete` = the person confirmed every meal of the day is logged.
 */
export function deriveDay(date: string, meals: Meal[], complete: boolean): DerivedDay {
  const real = meals.filter(m => !m.no_alcohol_statement);
  const saidNoAlcohol = meals.some(m => m.no_alcohol_statement);

  // Positive → known. Zero → known only on a complete day.
  const count = (field: 'candy_portions' | 'savoury_snacks' | 'sugary_drinks'): number | null => {
    const sum = real.reduce((s, m) => s + m[field], 0);
    return sum > 0 ? round1(sum) : complete ? 0 : null;
  };

  const alcoholGrams = real.reduce((s, m) => s + m.alcohol_g, 0);
  const alcohol_units = alcoholGrams > 0
    ? Math.round((alcoholGrams / GRAMS_PER_UNIT) * 2) / 2
    : complete || saidNoAlcohol ? 0 : null;

  // Food times. "Last food" is a MAXIMUM over the day, so it is only the day's
  // value once nothing can still be missing: the day must be marked complete
  // AND every entry with food must have a time. On a partial day it would only
  // be a lower bound, and an untimed dinner would silently leave lunch as
  // "the last thing eaten" — a wrong value, which is worse than an unknown one
  // (tasks/lessons.md 25).
  const foodEntries = real.filter(isFood);
  const timesKnown = complete && foodEntries.length > 0 && foodEntries.every(m => isTime(m.time));
  const times = timesKnown
    ? foodEntries.map(m => m.time as string).sort((a, b) => dayMinutes(a) - dayMinutes(b))
    : [];
  const last_food_time = timesKnown ? times[times.length - 1] : null;
  const first_food_time = timesKnown ? times[0] : null;
  // One timed meal is a moment, not a window: showing "0 h" would be a made-up number.
  const eating_window_h = timesKnown && times.length >= 2
    ? round1((dayMinutes(times[times.length - 1]) - dayMinutes(times[0])) / 60) : null;

  // Caffeine after 14:00: one timed late coffee makes it true. "No" needs a
  // complete day in which every caffeinated item has a time.
  const caffeinated = real.filter(m => m.caffeine);
  const caffeine_after_14 = caffeinated.some(m => isTime(m.time) && isAfter14(m.time)) ? true
    : complete && caffeinated.every(m => isTime(m.time)) ? false : null;

  // Totals: complete day, at least one real meal, and no unknown estimates.
  const total = (field: NutrientField): number | null => {
    if (!complete || real.length === 0 || real.some(m => m[field] == null)) return null;
    return round1(real.reduce((s, m) => s + (m[field] as number), 0));
  };
  const kcal = total('kcal');

  const share = (pick: (m: Meal) => boolean, needsTime: boolean): number | null => {
    if (kcal == null || kcal <= 0) return null;
    if (needsTime && real.some(m => (m.kcal ?? 0) > 0 && !isTime(m.time))) return null;
    return Math.round((real.filter(pick).reduce((s, m) => s + (m.kcal ?? 0), 0) / kcal) * 100);
  };

  return {
    date,
    alcohol_units,
    candy_portions: count('candy_portions'),
    savoury_snacks: count('savoury_snacks'),
    sugary_drinks: count('sugary_drinks'),
    last_food_time,
    caffeine_after_14,
    from_meals: true,
    day_complete: complete,
    meal_count: real.length,
    kcal: kcal == null ? null : Math.round(kcal),
    protein_g: total('protein_g'),
    carbs_g: total('carbs_g'),
    added_sugar_g: total('added_sugar_g'),
    fat_g: total('fat_g'),
    fibre_g: total('fibre_g'),
    veg_fruit_portions: total('veg_fruit_portions'),
    evening_kcal_pct: share(m => isTime(m.time) && isEvening(m.time), true),
    ultra_processed_pct: share(m => m.ultra_processed, false),
    // Needs every meal with calories to have a type, or the share would be understated.
    in_between_kcal_pct: real.some(m => (m.kcal ?? 0) > 0 && m.meal_type == null) ? null : share(m => m.meal_type === 'in_between', false),
    first_food_time,
    eating_window_h,
  };
}

/**
 * When the first meal is added to a day that was logged by hand, the hand-typed
 * amounts become one diary entry — so nothing is lost and nothing is counted
 * twice. Its calories are unknown, not zero.
 */
export function carryOverMeal(row: NutritionLog): Meal | null {
  if (row.from_meals) return null;
  const alcohol = row.alcohol_units ?? 0;
  const candy = row.candy_portions ?? 0;
  const savoury = row.savoury_snacks ?? 0;
  const sugary = row.sugary_drinks ?? 0;
  // Nothing positive to carry. (A typed 0 for alcohol is carried separately, as
  // a statement; a typed 0 for sweets becomes "not known" until the day is
  // marked complete, which is the cautious direction.)
  if (alcohol + candy + savoury + sugary === 0 && !row.caffeine_after_14 && !row.last_food_time) return null;

  const parts = [
    alcohol > 0 ? `${alcohol} alcohol units` : '', candy > 0 ? `${candy} candy portions` : '',
    savoury > 0 ? `${savoury} savoury snacks` : '', sugary > 0 ? `${sugary} sugary drinks` : '',
    row.caffeine_after_14 ? 'caffeine after 14:00' : '',
  ].filter(Boolean);
  return {
    date: row.date.slice(0, 10),
    // A late coffee needs a time to stay "after 14:00"; the last-food time carries the rest.
    time: row.last_food_time ?? (row.caffeine_after_14 ? '15:00' : null),
    meal_type: null,
    description: `Logged by hand earlier${parts.length ? `: ${parts.join(', ')}` : ''}`,
    kcal: null, protein_g: null, carbs_g: null, added_sugar_g: null, fat_g: null, fibre_g: null, veg_fruit_portions: null,
    alcohol_g: alcohol * GRAMS_PER_UNIT,
    candy_portions: candy, savoury_snacks: savoury, sugary_drinks: sugary,
    caffeine: row.caffeine_after_14 === true,
    ultra_processed: false,
    drink_only: !row.last_food_time,
    no_alcohol_statement: false,
    source: 'manual',
  };
}

/** A typed "0 alcohol" on a hand-logged day must survive as a statement. */
export function carryOverStatement(row: NutritionLog): Meal | null {
  if (row.from_meals || row.alcohol_units !== 0) return null;
  return noAlcoholStatement(row.date.slice(0, 10));
}

export function noAlcoholStatement(date: string): Meal {
  return {
    date, time: null, meal_type: null, description: 'No alcohol today',
    kcal: 0, protein_g: 0, carbs_g: 0, added_sugar_g: 0, fat_g: 0, fibre_g: 0, veg_fruit_portions: 0,
    alcohol_g: 0, candy_portions: 0, savoury_snacks: 0, sugary_drinks: 0,
    caffeine: false, ultra_processed: false, drink_only: true, no_alcohol_statement: true, source: 'text',
  };
}

/** Rescales a meal's portion: every amount moves together. */
export function scaleMeal(meal: Meal, factor: number): Meal {
  const f = Math.min(5, Math.max(0.1, factor));
  const s = (v: number | null) => (v == null ? null : round1(v * f));
  return {
    ...meal,
    kcal: meal.kcal == null ? null : Math.round(meal.kcal * f),
    protein_g: s(meal.protein_g), carbs_g: s(meal.carbs_g), added_sugar_g: s(meal.added_sugar_g),
    fat_g: s(meal.fat_g), fibre_g: s(meal.fibre_g), veg_fruit_portions: s(meal.veg_fruit_portions),
    alcohol_g: round1(meal.alcohol_g * f),
    candy_portions: round1(meal.candy_portions * f), savoury_snacks: round1(meal.savoury_snacks * f),
    sugary_drinks: round1(meal.sugary_drinks * f),
  };
}

/** Validates a meal arriving over HTTP. Returns null if it cannot be stored. */
export function cleanMeal(raw: unknown, date: string): Meal | null {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m !== 'object') return null;
  const description = typeof m.description === 'string' ? m.description.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (!description) return null;
  const amount = (v: unknown, max: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(max, round1(v)) : null;
  const time = typeof m.time === 'string' && isTime(m.time) ? m.time : null;
  return {
    date, time,
    // The stated type wins; then a label in the description ("Frokost: …"); then the time of day.
    meal_type: isMealType(m.meal_type) ? m.meal_type : mealTypeFromDescription(description) ?? mealTypeFromTime(time),
    description,
    kcal: amount(m.kcal, 6000) === null ? null : Math.round(amount(m.kcal, 6000)!),
    protein_g: amount(m.protein_g, 400), carbs_g: amount(m.carbs_g, 1000), added_sugar_g: amount(m.added_sugar_g, 600),
    fat_g: amount(m.fat_g, 500), fibre_g: amount(m.fibre_g, 150), veg_fruit_portions: amount(m.veg_fruit_portions, 20),
    alcohol_g: amount(m.alcohol_g, 600) ?? 0,
    candy_portions: amount(m.candy_portions, 40) ?? 0,
    savoury_snacks: amount(m.savoury_snacks, 40) ?? 0,
    sugary_drinks: amount(m.sugary_drinks, 40) ?? 0,
    caffeine: m.caffeine === true,
    ultra_processed: m.ultra_processed === true,
    drink_only: m.drink_only === true,
    no_alcohol_statement: m.no_alcohol_statement === true,
    source: m.source === 'photo' ? 'photo' : m.source === 'manual' ? 'manual' : 'text',
  };
}

/** One line for a meal, as shown in the diary and in a quick-log proposal. */
export function mealLine(m: Meal): string {
  if (m.no_alcohol_statement) return 'No alcohol today';
  const bits: string[] = [];
  if (m.kcal != null) bits.push(`~${m.kcal} kcal`);
  if (m.protein_g != null && m.protein_g > 0) bits.push(`${m.protein_g} g protein`);
  if (m.added_sugar_g != null && m.added_sugar_g > 0) bits.push(`${m.added_sugar_g} g added sugar`);
  if (m.fibre_g != null && m.fibre_g > 0) bits.push(`${m.fibre_g} g fibre`);
  if (m.alcohol_g > 0) bits.push(`${Math.round((m.alcohol_g / GRAMS_PER_UNIT) * 2) / 2} alcohol units`);
  if (m.candy_portions > 0) bits.push(`${m.candy_portions} candy`);
  if (m.savoury_snacks > 0) bits.push(`${m.savoury_snacks} savoury`);
  if (m.sugary_drinks > 0) bits.push(`${m.sugary_drinks} sugary drink${m.sugary_drinks === 1 ? '' : 's'}`);
  if (m.caffeine) bits.push('caffeine');
  const type = m.meal_type ? `${MEAL_TYPE_LABEL[m.meal_type]}${m.time ? '' : ':'} ` : '';
  return `${type}${m.time ? `${m.time} ` : ''}${m.description}${bits.length ? ` — ${bits.join(', ')}` : ''}`;
}

/** Calories per kind of meal for one day's entries; null where an entry has no estimate. */
export function kcalByMealType(meals: Meal[]): { type: MealType | null; label: string; meals: Meal[]; kcal: number | null }[] {
  const real = meals.filter(m => !m.no_alcohol_statement);
  const groups: (MealType | null)[] = [...MEAL_TYPES, null];
  return groups
    .map(type => {
      const inGroup = real.filter(m => m.meal_type === type);
      return {
        type,
        label: type ? MEAL_TYPE_LABEL[type] : 'Not sorted',
        meals: inGroup,
        kcal: inGroup.some(m => m.kcal == null) ? null : inGroup.reduce((s, m) => s + (m.kcal as number), 0),
      };
    })
    .filter(g => g.meals.length > 0);
}

// ── Duplicates ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'with', 'some', 'og', 'en', 'et', 'med', 'til', 'lidt']);

function words(description: string): Set<string> {
  return new Set(
    description.toLowerCase().normalize('NFKD').replace(/[^a-z0-9æøå ]+/g, ' ')
      .split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w)),
  );
}

/** How alike two descriptions are, 0-1: shared words over the smaller set. */
export function descriptionOverlap(a: string, b: string): number {
  const wa = words(a), wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

/**
 * The entry already in the diary that `candidate` most likely repeats, or null.
 *
 * Same day, much the same description, AND the same occasion: the same kind of
 * meal, or times within an hour of each other. A second coffee in the
 * afternoon, or the same dish for lunch and dinner, is therefore NOT a
 * duplicate — only the same thing at the same sitting is. The caller asks the
 * person; this never drops anything on its own authority.
 */
export function likelyDuplicate(candidate: Meal, existing: Meal[]): Meal | null {
  for (const e of existing) {
    if (e.no_alcohol_statement || e.date !== candidate.date) continue;
    if (descriptionOverlap(candidate.description, e.description) < 0.7) continue;
    const bothTimed = isTime(candidate.time) && isTime(e.time);
    const closeInTime = bothTimed && Math.abs(dayMinutes(candidate.time as string) - dayMinutes(e.time as string)) <= 60;
    const farInTime = bothTimed && !closeInTime;
    const sameMeal = candidate.meal_type != null && candidate.meal_type === e.meal_type;
    if (closeInTime || (sameMeal && !farInTime)) return e;
  }
  return null;
}

// ── Hand-typed amounts and the diary ────────────────────────────────────────

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Amounts typed by hand were the DAY'S totals. When diary meals are then added
 * for the same day, they describe that same food and drink — so they count
 * toward the typed totals, not on top of them. This returns what is left of
 * the carried-over entry once the meals are taken out of it, or null when the
 * meals account for all of it.
 *
 * Typed 5.5 units, then a dinner logged with 5.5 units of wine → nothing left,
 * and the day shows 5.5, not 11. Typed 5.5 units, then only lunch logged →
 * the 5.5 stay, because lunch explains none of them.
 */
export function reduceCarryOver(carry: Meal, added: Meal[]): Meal | null {
  const sum = (pick: (m: Meal) => number) => added.reduce((s, m) => s + pick(m), 0);
  const left = (typed: number, logged: number) => Math.max(0, round(typed - logged));

  const alcohol_g = left(carry.alcohol_g, sum(m => m.alcohol_g));
  const candy = left(carry.candy_portions, sum(m => m.candy_portions));
  const savoury = left(carry.savoury_snacks, sum(m => m.savoury_snacks));
  const sugary = left(carry.sugary_drinks, sum(m => m.sugary_drinks));
  // A typed late coffee is explained once any logged entry has caffeine.
  const caffeine = carry.caffeine && !added.some(m => m.caffeine);

  if (alcohol_g + candy + savoury + sugary === 0 && !caffeine) return null;

  const units = Math.round((alcohol_g / GRAMS_PER_UNIT) * 2) / 2;
  const parts = [
    units > 0 ? `${units} alcohol units` : '', candy > 0 ? `${candy} candy portions` : '',
    savoury > 0 ? `${savoury} savoury snacks` : '', sugary > 0 ? `${sugary} sugary drinks` : '',
    caffeine ? 'caffeine after 14:00' : '',
  ].filter(Boolean);
  return {
    ...carry,
    alcohol_g, candy_portions: candy, savoury_snacks: savoury, sugary_drinks: sugary, caffeine,
    description: `Logged by hand earlier, not covered by the meals above: ${parts.join(', ')}`,
  };
}

// ── Editing an entry ────────────────────────────────────────────────────────

/**
 * An existing entry with the person's corrections applied. Alcohol is edited
 * in units (what the form shows) and stored in grams. A blank estimate stays
 * unknown rather than becoming zero; the date, the source and the "no alcohol"
 * flag cannot be changed here. Returns null if the result has no description.
 */
export function editMeal(existing: Meal, raw: unknown): Meal | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const units = r.alcohol_units;
  const alcohol_g = typeof units === 'number' && Number.isFinite(units) && units >= 0
    ? Math.round(Math.min(50, units) * GRAMS_PER_UNIT * 10) / 10
    : existing.alcohol_g;
  const cleaned = cleanMeal({ ...r, alcohol_g, source: existing.source }, existing.date);
  if (!cleaned) return null;
  return {
    ...cleaned,
    id: existing.id,
    // An explicit choice of "not sorted" is kept; cleanMeal would otherwise guess from the time.
    meal_type: 'meal_type' in r ? (isMealType(r.meal_type) ? r.meal_type : null) : cleaned.meal_type,
    no_alcohol_statement: existing.no_alcohol_statement,
  };
}
