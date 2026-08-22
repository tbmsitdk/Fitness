// Catalog of the manually-logged mobility / strength / respiratory routine.
// This is the single source of truth for which exercises exist, how each one
// is measured, and how they group in the UI.

export type ExerciseCategory = 'strength' | 'spine' | 'shoulder' | 'circulation' | 'respiratory';

// Which field the progression chart tracks for this exercise. Every exercise
// still ACCEPTS all fields (sets/reps/duration/load) — this only decides the
// headline metric and which input is emphasised in the form.
export type ExerciseMetric = 'reps' | 'duration' | 'load' | 'airofit';

export interface ExerciseDef {
  key: string;
  label: string;
  category: ExerciseCategory;
  primaryMetric: ExerciseMetric;
  /** Rough seconds per rep — used only to estimate session duration for
   *  training-load purposes on rep-based exercises (no timer is recorded). */
  secondsPerRep?: number;
  /** Pre-filled form values for a fresh day: the routine as prescribed.
   *  defaultValue is the primary metric (seconds, or kg for grip). */
  defaultSets?: number;
  defaultValue?: number;
  defaultReps?: number; // grip strength only — squeezes at that resistance
  hint?: string;
}

export const CATEGORY_LABEL: Record<ExerciseCategory, string> = {
  strength:    'Strength & Endurance',
  spine:       'Spine & Trunk Mobility',
  shoulder:    'Shoulder & Arm Mobility',
  circulation: 'Circulation & Activation',
  respiratory: 'Respiratory',
};

// Categorical slots 1-5 of a validated dark-mode palette, assigned in fixed
// CATEGORY_ORDER (the order they stack in). Verified against the dark chart
// surface: worst adjacent CVD ΔE 8.4, worst adjacent normal-vision ΔE 19.3.
// The previous ad-hoc set FAILED — its purple/blue pair was ΔE 13.5 in normal
// vision (below the 15 floor) and 5.7 under protanopia, while sitting directly
// adjacent in the stacked bar. Do not re-order or substitute without re-validating.
export const CATEGORY_COLOR: Record<ExerciseCategory, string> = {
  strength:    '#3987e5', // blue
  spine:       '#d95926', // orange
  shoulder:    '#199e70', // aqua
  circulation: '#c98500', // yellow
  respiratory: '#d55181', // magenta
};

// Single-hue sequential ramp (blue) for the adherence grid — magnitude of work
// per day. Brighter = more work; empty days stay near the surface colour.
export const ADHERENCE_RAMP = ['#1c5cab', '#256abf', '#3987e5', '#6da7ec'];
export const ADHERENCE_EMPTY = 'hsl(240 3.7% 12%)';

// Nominal intensity factor per category, used to estimate a conservative TSS
// contribution from a logged session. These are deliberately low — this is
// supplementary work, not a hard interval session.
export const CATEGORY_INTENSITY: Record<ExerciseCategory, number> = {
  strength:    0.65,
  spine:       0.45,
  shoulder:    0.45,
  circulation: 0.50,
  respiratory: 0.30,
};

// Everything is timed in seconds except the grip dynamometer (kg + reps) and
// Airofit. Sets default to 1 in the UI and when absent in the data.
export const EXERCISES: ExerciseDef[] = [
  // ── Strength & Endurance ──────────────────────────────────────────────────
  { key: 'squats',              label: 'Squats',                     category: 'strength', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },
  { key: 'ballet_squats',       label: 'Ballet squats',              category: 'strength', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },
  { key: 'horseback_stands',    label: 'Horseback stands',           category: 'strength', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30,  hint: 'Isometric hold' },
  { key: 'doorway_press',       label: 'Doorway press',              category: 'strength', primaryMetric: 'duration', defaultSets: 1, defaultValue: 120, hint: 'Isometric hold' },
  { key: 'dead_hang',           label: 'Dead hang',                  category: 'strength', primaryMetric: 'duration', defaultSets: 2, defaultValue: 10,  hint: 'Grip + shoulder decompression' },
  { key: 'grip_strength_press', label: 'Grip strength press',        category: 'strength', primaryMetric: 'load',     secondsPerRep: 3, defaultValue: 5, defaultReps: 100, hint: 'Dynamometer resistance (kg) + reps' },

  // ── Spine & Trunk Mobility ────────────────────────────────────────────────
  { key: 'foam_roller_thoracic', label: 'Foam roller thoracic ext.', category: 'spine', primaryMetric: 'duration', defaultSets: 1, defaultValue: 180 },
  { key: 'body_waves',           label: 'Body waves',                category: 'spine', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },
  { key: 'trunk_twists',         label: 'Trunk twists',              category: 'spine', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },
  { key: 'twist_the_waist',      label: 'Twist the waist',           category: 'spine', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },
  { key: 'golf_swings',          label: 'Golf swings',               category: 'spine', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },

  // ── Shoulder & Arm Mobility ───────────────────────────────────────────────
  { key: 'forward_arm_circles',  label: 'Forward arm circles',       category: 'shoulder', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },
  { key: 'backward_arm_swings',  label: 'Backward arm swings',       category: 'shoulder', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },
  { key: 'arm_swings',           label: 'Arm swings',                category: 'shoulder', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },
  { key: 'dead_arms',            label: 'Dead arms',                 category: 'shoulder', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },
  { key: 'tiptoe_arm_swings',    label: 'Tiptoe arm swings',         category: 'shoulder', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },

  // ── Circulation & Activation ──────────────────────────────────────────────
  { key: 'lymphatic_hops',       label: 'Lymphatic hops',            category: 'circulation', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },
  { key: 'marches',              label: 'Marches',                   category: 'circulation', primaryMetric: 'duration', defaultSets: 1, defaultValue: 30 },

  // ── Respiratory ───────────────────────────────────────────────────────────
  { key: 'airofit',              label: 'Airofit',                   category: 'respiratory', primaryMetric: 'airofit', hint: 'Breathing trainer session' },
];

export const EXERCISE_BY_KEY: Record<string, ExerciseDef> =
  Object.fromEntries(EXERCISES.map(e => [e.key, e]));

export const EXERCISE_KEYS = new Set(EXERCISES.map(e => e.key));

export const CATEGORY_ORDER: ExerciseCategory[] =
  ['strength', 'spine', 'shoulder', 'circulation', 'respiratory'];

export function exercisesByCategory(): { category: ExerciseCategory; label: string; exercises: ExerciseDef[] }[] {
  return CATEGORY_ORDER.map(category => ({
    category,
    label: CATEGORY_LABEL[category],
    exercises: EXERCISES.filter(e => e.category === category),
  })).filter(g => g.exercises.length > 0);
}

// ── Logged entry shape ──────────────────────────────────────────────────────

export interface ExerciseLog {
  id: number;
  date: string;
  exercise_key: string;
  sets: number | null;
  reps: number | null;
  duration_seconds: number | null;
  load_kg: number | null;
  // Airofit-specific
  vital_capacity_l: number | null;
  inspiratory_strength: number | null;
  expiratory_strength: number | null;
  notes: string | null;
}

// Numeric columns a client may write. Whitelisted to keep the dynamic SQL safe.
export const EXERCISE_NUMERIC_FIELDS = [
  'sets', 'reps', 'duration_seconds', 'load_kg',
  'vital_capacity_l', 'inspiratory_strength', 'expiratory_strength',
] as const;

export type ExerciseNumericField = typeof EXERCISE_NUMERIC_FIELDS[number];

/** Postgres returns DECIMAL as strings and DATE as Date — normalise a raw row. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function coerceExerciseLog(row: any): ExerciseLog {
  const out = { ...row } as ExerciseLog;
  out.date = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10);
  for (const f of EXERCISE_NUMERIC_FIELDS) {
    out[f] = row[f] != null ? Number(row[f]) : null;
  }
  return out;
}

/** Total volume for an entry's primary metric — what progression charts plot. */
export function primaryValue(log: ExerciseLog): number | null {
  const def = EXERCISE_BY_KEY[log.exercise_key];
  if (!def) return null;
  const sets = log.sets && log.sets > 0 ? log.sets : 1;
  switch (def.primaryMetric) {
    case 'reps':     return log.reps != null ? log.reps * sets : null;
    case 'duration': return log.duration_seconds != null ? log.duration_seconds * sets : null;
    case 'load':     return log.load_kg;               // peak reading, never multiplied
    case 'airofit':  return log.duration_seconds != null ? Math.round(log.duration_seconds / 60) : null;
  }
}

export function primaryUnit(key: string): string {
  switch (EXERCISE_BY_KEY[key]?.primaryMetric) {
    case 'reps':     return 'reps';
    case 'duration': return 's';
    case 'load':     return 'kg';
    case 'airofit':  return 'min';
    default:         return '';
  }
}

/** Estimated seconds of work in a logged entry — explicit duration where
 *  recorded, otherwise reps x the exercise's nominal seconds-per-rep. */
export function estimatedSeconds(log: ExerciseLog): number {
  const def = EXERCISE_BY_KEY[log.exercise_key];
  if (!def) return 0;
  const sets = log.sets && log.sets > 0 ? log.sets : 1;
  if (log.duration_seconds != null) return log.duration_seconds * sets;
  if (log.reps != null && def.secondsPerRep) return log.reps * def.secondsPerRep * sets;
  return 0;
}

/** The prescribed routine as form values, for pre-filling a fresh day. */
export function defaultDraft(): Record<string, Record<string, string>> {
  const draft: Record<string, Record<string, string>> = {};
  for (const def of EXERCISES) {
    if (def.defaultValue == null) continue; // e.g. Airofit — only logged when used
    const fields: Record<string, string> = {};
    if (def.defaultSets != null) fields.sets = String(def.defaultSets);
    fields[def.primaryMetric === 'load' ? 'load_kg' : 'duration_seconds'] = String(def.defaultValue);
    if (def.defaultReps != null) fields.reps = String(def.defaultReps);
    draft[def.key] = fields;
  }
  return draft;
}

/** Total estimated work seconds for a set of logs (a day, a week, whatever). */
export function totalSeconds(logs: ExerciseLog[]): number {
  return logs.reduce((s, l) => s + estimatedSeconds(l), 0);
}

/** Longest run of consecutive logged days ending today or yesterday. Returns 0
 *  if the most recent log is older than yesterday (the streak is broken). */
export function currentStreak(dates: string[], todayStr = new Date().toISOString().slice(0, 10)): number {
  const set = new Set(dates.map(d => d.slice(0, 10)));
  if (set.size === 0) return 0;

  const day = (offset: number) => {
    const d = new Date(`${todayStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  };

  // Allow the streak to still count if today isn't logged yet but yesterday was
  let offset = set.has(day(0)) ? 0 : set.has(day(1)) ? 1 : -1;
  if (offset === -1) return 0;

  let streak = 0;
  while (set.has(day(offset))) { streak++; offset++; }
  return streak;
}

/** Conservative estimated TSS for a day's logged exercises. These sessions have
 *  no HR or power data, so load is approximated from estimated work time and a
 *  nominal per-category intensity factor (TSS = hours x IF^2 x 100). */
export function estimateExerciseTss(logs: ExerciseLog[]): number {
  let tss = 0;
  for (const log of logs) {
    const def = EXERCISE_BY_KEY[log.exercise_key];
    if (!def) continue;
    const hours = estimatedSeconds(log) / 3600;
    const intensity = CATEGORY_INTENSITY[def.category];
    tss += hours * intensity * intensity * 100;
  }
  return Math.round(tss * 10) / 10;
}
