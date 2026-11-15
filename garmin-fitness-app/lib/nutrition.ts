/**
 * Food & drink logging — deliberately narrow.
 *
 * This does not track calories or macros. It tracks a handful of inputs that
 * are (a) recallable at the end of the day, (b) plausibly high-impact, and
 * (c) variable enough to correlate against sleep and recovery.
 *
 * Every field carries an explicit, written definition that is RENDERED IN THE
 * FORM, not just kept here. A measure you define differently in March than in
 * January is worse than no measure at all — the drift looks like a real effect.
 */

export type NutritionField =
  | 'alcohol_units'
  | 'candy_portions'
  | 'savoury_snacks'
  | 'sugary_drinks'
  | 'last_food_time'
  | 'caffeine_after_14';

export interface NutritionLog {
  id?: number;
  date: string;                       // YYYY-MM-DD
  alcohol_units: number | null;
  candy_portions: number | null;
  savoury_snacks: number | null;
  sugary_drinks: number | null;
  last_food_time: string | null;      // 'HH:MM'
  caffeine_after_14: boolean | null;
  notes: string | null;

  // ── Derived from the meal diary (lib/meals.ts). Absent on hand-logged days. ──
  /** True when this row was computed from logged meals rather than typed in. */
  from_meals?: boolean;
  /** The person confirmed that every meal of the day is logged. */
  day_complete?: boolean;
  meal_count?: number | null;
  /**
   * Day totals. Null unless the day is complete AND every meal has an
   * estimate — a total over half a day would read as a real, tiny number.
   */
  kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  added_sugar_g?: number | null;
  fat_g?: number | null;
  fibre_g?: number | null;
  veg_fruit_portions?: number | null;
  /** Share of the day's calories eaten at or after 19:00, 0-100. */
  evening_kcal_pct?: number | null;
  /** Share of the day's calories from mostly ultra-processed meals, 0-100. */
  ultra_processed_pct?: number | null;
  /** Share of the day's calories eaten in between meals, 0-100. */
  in_between_kcal_pct?: number | null;
  first_food_time?: string | null;
  /** Hours from first to last food. */
  eating_window_h?: number | null;
}

export const NUTRITION_NUMERIC_FIELDS = [
  'alcohol_units', 'candy_portions', 'savoury_snacks', 'sugary_drinks',
] as const;

/**
 * A logged zero and an unlogged day are completely different facts, and
 * conflating them destroys the analysis: every day you forgot to log would
 * silently become a sober, sugar-free day and wash out the very effect you are
 * looking for. A 0 must therefore be typed to mean "none today"; absence stays
 * absence and is excluded from every comparison.
 *
 * This is decided PER FIELD, not per day: entering 0 for alcohol makes that day
 * a valid alcohol baseline even if candy was left blank. There is deliberately
 * no whole-day "clean" concept — it would have required all four inputs before
 * any one of them could be used.
 */

/** Did this row record anything at all? Used to reject accidental empty saves. */
export function hasAnyEntry(log: Partial<NutritionLog>): boolean {
  return [
    log.alcohol_units, log.candy_portions, log.savoury_snacks, log.sugary_drinks,
    log.last_food_time,
  ].some(v => v != null && v !== '') || log.caffeine_after_14 === true;
}

// ── Definitions shown in the form ────────────────────────────────────────────

export interface FieldDef {
  key: NutritionField;
  label: string;
  /** One line under the input. */
  summary: string;
  /** Expanded, explicit rules — rendered in the form behind a "definition" toggle. */
  counts: string[];
  doesNotCount: string[];
}

/** One Danish standard drink (genstand) = 12 g of pure alcohol. */
export const GRAMS_PER_UNIT = 12;
/** Density of ethanol, g/ml. */
const ETHANOL_DENSITY = 0.789;

/**
 * Standard units in a drink, rounded to the nearest half.
 *
 * Half-unit resolution is deliberate and matches what the form asks for: how
 * accurately you remember what you drank is a far bigger source of error than
 * the arithmetic, so finer precision would be false.
 */
export function alcoholUnits(volumeMl: number, abvPercent: number): number {
  const grams = volumeMl * (abvPercent / 100) * ETHANOL_DENSITY;
  return Math.round((grams / GRAMS_PER_UNIT) * 2) / 2;
}

/**
 * Reference table shown in the form. Values are COMPUTED, not typed by hand,
 * so the table can never drift away from the formula.
 *
 * Wine is listed at 13/14/15% because that is what is actually in the bottle —
 * an earlier 12%-only row understated a typical red by close to a full unit.
 */
export const ALCOHOL_REFERENCE: { label: string; units: number }[] = [
  { label: 'Beer, 33 cl @ 4.6%',        units: alcoholUnits(330, 4.6) },
  { label: 'Beer, 50 cl @ 4.6%',        units: alcoholUnits(500, 4.6) },
  { label: 'Strong beer, 33 cl @ 8%',   units: alcoholUnits(330, 8) },
  { label: 'Wine, 12 cl glass @ 13%',   units: alcoholUnits(120, 13) },
  { label: 'Wine, 15 cl glass @ 14%',   units: alcoholUnits(150, 14) },
  { label: 'Wine, 75 cl bottle @ 13%',  units: alcoholUnits(750, 13) },
  { label: 'Wine, 75 cl bottle @ 14%',  units: alcoholUnits(750, 14) },
  { label: 'Wine, 75 cl bottle @ 15%',  units: alcoholUnits(750, 15) },
  { label: 'Spirits, 4 cl @ 40%',       units: alcoholUnits(40, 40) },
];

/** One candy portion ≈ 25-30 g of sugar confectionery. */
export const CANDY_REFERENCE: { label: string; portions: number }[] = [
  { label: 'Chocolate bar, 50 g', portions: 2 },
  { label: 'Handful of wine gums / liquorice (~30 g)', portions: 1 },
  { label: 'Scoop of ice cream', portions: 1 },
  { label: 'Slice of cake', portions: 1.5 },
  { label: 'Two biscuits', portions: 1 },
  { label: 'Pastry / danish', portions: 2 },
];

/** One savoury portion ≈ 30 g. */
export const SAVOURY_REFERENCE: { label: string; portions: number }[] = [
  { label: 'Small bag of crisps, 40 g', portions: 1.5 },
  { label: 'Sharing bag of crisps, 175 g', portions: 6 },
  { label: 'Handful of salted nuts (~30 g)', portions: 1 },
  { label: 'Bowl of salted popcorn', portions: 1.5 },
  { label: 'Handful of pretzels / cheese puffs', portions: 1 },
];

export const NUTRITION_FIELDS: FieldDef[] = [
  {
    key: 'alcohol_units',
    label: 'Alcohol',
    summary: 'Standard units (genstande). 1 unit = 12 g pure alcohol.',
    counts: [
      'Count what you actually drank, not what was poured or served.',
      'Use the reference table — a 50 cl beer is 1.5 units, not 1.',
      'Round to the nearest half unit. Precision beyond that is invented.',
      'Log it against the day you drank it, even if you finished after midnight.',
    ],
    doesNotCount: [
      'Alcohol-free beer or wine (under 0.5%).',
      'Alcohol cooked into food — it has largely evaporated.',
    ],
  },
  {
    key: 'candy_portions',
    label: 'Candy & sweets',
    summary: 'Portions. 1 portion ≈ 25–30 g of sugar confectionery.',
    counts: [
      'Sweets, chocolate, liquorice, wine gums, ice cream, cake, biscuits, pastry.',
      'Count portions, not items: a 50 g bar is 2 portions, not 1.',
      'Dessert eaten after a meal counts.',
      'Half portions are fine (0.5); finer than that is guesswork.',
    ],
    doesNotCount: [
      'Fruit, including dried fruit — different sugar, different response.',
      'Dark chocolate over 70% in amounts under 20 g.',
      'Sugar inside a main meal (sauces, bread, dressing) — not trackable honestly.',
      'Sports nutrition taken during training — that is fuelling, logged as training.',
    ],
  },
  {
    key: 'savoury_snacks',
    label: 'Savoury snacks',
    summary: 'Portions. 1 portion ≈ 30 g. Crisps and similar — kept separate from candy on purpose.',
    counts: [
      'Crisps, salted nuts, popcorn, pretzels, cheese puffs, savoury biscuits.',
      'Count portions, not packets: a 40 g bag is 1.5 portions, a 175 g sharing bag is 6.',
      'Anything eaten from a bag in front of the TV belongs here.',
    ],
    doesNotCount: [
      'Anything eaten as part of a meal — crackers with cheese at the table, nuts in a salad.',
      'Plain unsalted nuts eaten as deliberate fuelling.',
      'Vegetables, crudités, olives.',
      'Sweet popcorn — that is candy, since the sugar is the point.',
    ],
  },
  {
    key: 'sugary_drinks',
    label: 'Sugary drinks',
    summary: 'Servings of 25–33 cl. Kept separate from candy: different timing.',
    counts: [
      'Regular soft drinks, fruit juice, squash, energy drinks, sweetened iced tea.',
      'Sweetened coffee drinks (latte with syrup, frappé).',
      'A 50 cl bottle is 2 servings.',
    ],
    doesNotCount: [
      'Diet / zero / light versions — no sugar, and the point here is sugar.',
      'Sports drinks taken DURING a session — that is fuelling.',
      'Plain coffee, tea, water, milk.',
    ],
  },
  {
    key: 'last_food_time',
    label: 'Last food',
    summary: 'Clock time you last took in calories. Affects sleep on its own.',
    counts: [
      'Any food or caloric drink, including a small snack.',
      'Milk in a drink counts; so does a handful of nuts.',
      'Use 24-hour time. After midnight, log against the evening it belonged to.',
    ],
    doesNotCount: [
      'Water, plain tea, black coffee, zero-calorie drinks.',
    ],
  },
  {
    key: 'caffeine_after_14',
    label: 'Caffeine after 14:00',
    summary: 'Yes / no. Caffeine has a ~5–6 hour half-life.',
    counts: [
      'Coffee (including a single espresso), black and green tea, cola.',
      'Energy drinks, pre-workout, caffeine gels or tablets.',
    ],
    doesNotCount: [
      'Decaf.',
      'Herbal or rooibos tea.',
      'Chocolate, unless over 50 g of dark.',
    ],
  },
];

/** Postgres DECIMAL columns arrive as strings; dates may arrive as Date objects. */
export function coerceNutritionLog(row: Record<string, unknown>): NutritionLog {
  const num = (v: unknown) => (v != null ? Number(v) : null);
  const time = (v: unknown) => (v != null ? String(v).slice(0, 5) : null);
  // Queries select `date::text AS day` so the calendar day never passes
  // through a Date object (which would shift it in any zone ahead of UTC).
  const raw = row.day ?? row.date;
  const date = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
  const log: NutritionLog = {
    id: row.id != null ? Number(row.id) : undefined,
    date,
    alcohol_units: num(row.alcohol_units),
    candy_portions: num(row.candy_portions),
    savoury_snacks: num(row.savoury_snacks),
    sugary_drinks: num(row.sugary_drinks),
    last_food_time: time(row.last_food_time),
    caffeine_after_14: row.caffeine_after_14 == null ? null : Boolean(row.caffeine_after_14),
    notes: row.notes != null ? String(row.notes) : null,
  };
  // Diary columns exist only on rows read with SELECT *; leave them off otherwise.
  if ('from_meals' in row) {
    log.from_meals = row.from_meals === true;
    log.day_complete = row.day_complete === true;
    log.meal_count = num(row.meal_count);
    log.kcal = num(row.kcal);
    log.protein_g = num(row.protein_g);
    log.carbs_g = num(row.carbs_g);
    log.added_sugar_g = num(row.added_sugar_g);
    log.fat_g = num(row.fat_g);
    log.fibre_g = num(row.fibre_g);
    log.veg_fruit_portions = num(row.veg_fruit_portions);
    log.evening_kcal_pct = num(row.evening_kcal_pct);
    log.ultra_processed_pct = num(row.ultra_processed_pct);
    log.in_between_kcal_pct = num(row.in_between_kcal_pct);
    log.first_food_time = time(row.first_food_time);
    log.eating_window_h = num(row.eating_window_h);
  }
  return log;
}

/** Minutes past midnight, for correlating "late eating" numerically. */
export function lastFoodMinutes(log: NutritionLog): number | null {
  if (!log.last_food_time) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(log.last_food_time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  // Eating at 01:00 belongs to the previous evening — express it as 25:00 so it
  // sorts and averages as "late", not as "extremely early".
  return h < 4 ? (h + 24) * 60 + min : h * 60 + min;
}
