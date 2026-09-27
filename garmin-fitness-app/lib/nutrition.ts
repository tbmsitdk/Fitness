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
  | 'sugary_drinks'
  | 'last_food_time'
  | 'caffeine_after_14'
  | 'meal_quality';

export interface NutritionLog {
  id?: number;
  date: string;                       // YYYY-MM-DD
  alcohol_units: number | null;
  candy_portions: number | null;
  sugary_drinks: number | null;
  last_food_time: string | null;      // 'HH:MM'
  caffeine_after_14: boolean | null;
  meal_quality: number | null;        // 1-5
  notes: string | null;
}

export const NUTRITION_NUMERIC_FIELDS = [
  'alcohol_units', 'candy_portions', 'sugary_drinks', 'meal_quality',
] as const;

/**
 * A logged zero and an unlogged day are completely different facts, and
 * conflating them destroys the analysis: every day you forgot to log would
 * silently become a sober, sugar-free day and wash out the very effect you are
 * looking for. The form therefore has an explicit "clean day" action that
 * writes real zeros, and absence stays absence.
 */
export function isCleanDay(log: NutritionLog): boolean {
  return log.alcohol_units === 0 && log.candy_portions === 0 && log.sugary_drinks === 0;
}

/** Did this row record anything at all? Used to reject accidental empty saves. */
export function hasAnyEntry(log: Partial<NutritionLog>): boolean {
  return [
    log.alcohol_units, log.candy_portions, log.sugary_drinks,
    log.meal_quality, log.last_food_time,
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

/**
 * One Danish standard drink (genstand) = 12 g pure alcohol.
 * Computed as: volume(cl) x ABV(%) x 0.789 / 12, rounded to 1 decimal.
 */
export const ALCOHOL_REFERENCE: { label: string; units: number }[] = [
  { label: 'Beer, 33 cl @ 4.6%', units: 1.0 },
  { label: 'Beer, 50 cl @ 4.6%', units: 1.5 },
  { label: 'Strong beer, 33 cl @ 8%', units: 1.7 },
  { label: 'Wine, 12 cl glass @ 12%', units: 1.0 },
  { label: 'Wine, 75 cl bottle @ 12%', units: 6.0 },
  { label: 'Spirits, 4 cl @ 40%', units: 1.0 },
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
  {
    key: 'meal_quality',
    label: 'Meal quality',
    summary: 'Your actual MEALS on a 1–5 scale — ignore alcohol and candy, already logged above.',
    counts: [
      'Judge only the meals themselves: composition, preparation, and snacking between them.',
      'Pick the level whose description best matches the day. Do not average.',
      'If two levels fit equally, choose the lower one.',
    ],
    doesNotCount: [
      'Alcohol, candy and sugary drinks — those are separate fields, do not double-count.',
      'How you felt, how hard you trained, or whether you were "good".',
    ],
  },
];

/**
 * Anchored levels for meal quality. Each is described by OBSERVABLE behaviour,
 * not by a feeling — "how clean was today" means something different on a bad
 * week than a good one, and that drift is indistinguishable from a real change.
 */
export const MEAL_QUALITY_LEVELS: { value: number; label: string; description: string }[] = [
  { value: 1, label: 'Mostly processed',
    description: 'Takeaway, fast food or ready meals for the main meal. Few or no vegetables all day. Grazing between meals.' },
  { value: 2, label: 'Ad hoc',
    description: 'One proper meal; the rest skipped, grabbed, or assembled from snacks. Vegetables at most once.' },
  { value: 3, label: 'Typical',
    description: '2–3 regular meals, mostly home-prepared. Vegetables at one or two of them. Some unplanned snacking.' },
  { value: 4, label: 'Good',
    description: 'All meals home-prepared and eaten at a table. Vegetables at two or more meals. No unplanned snacking.' },
  { value: 5, label: 'Very good',
    description: 'As level 4, plus protein at every main meal, vegetables at every main meal, and nothing eaten between meals.' },
];

/** Postgres DECIMAL columns arrive as strings; dates may arrive as Date objects. */
export function coerceNutritionLog(row: Record<string, unknown>): NutritionLog {
  const num = (v: unknown) => (v != null ? Number(v) : null);
  const date = row.date instanceof Date
    ? row.date.toISOString().slice(0, 10)
    : String(row.date).slice(0, 10);
  return {
    id: row.id != null ? Number(row.id) : undefined,
    date,
    alcohol_units: num(row.alcohol_units),
    candy_portions: num(row.candy_portions),
    sugary_drinks: num(row.sugary_drinks),
    last_food_time: row.last_food_time != null ? String(row.last_food_time).slice(0, 5) : null,
    caffeine_after_14: row.caffeine_after_14 == null ? null : Boolean(row.caffeine_after_14),
    meal_quality: num(row.meal_quality),
    notes: row.notes != null ? String(row.notes) : null,
  };
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
