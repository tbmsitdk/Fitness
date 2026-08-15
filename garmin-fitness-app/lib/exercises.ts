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
  hint?: string;
}

export const CATEGORY_LABEL: Record<ExerciseCategory, string> = {
  strength:    'Strength & Endurance',
  spine:       'Spine & Trunk Mobility',
  shoulder:    'Shoulder & Arm Mobility',
  circulation: 'Circulation & Activation',
  respiratory: 'Respiratory',
};

export const CATEGORY_COLOR: Record<ExerciseCategory, string> = {
  strength:    '#22C55E',
  spine:       '#3B82F6',
  shoulder:    '#A78BFA',
  circulation: '#F59E0B',
  respiratory: '#EC4899',
};

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
  { key: 'squats',              label: 'Squats',                     category: 'strength', primaryMetric: 'duration' },
  { key: 'ballet_squats',       label: 'Ballet squats',              category: 'strength', primaryMetric: 'duration' },
  { key: 'horseback_stands',    label: 'Horseback stands',           category: 'strength', primaryMetric: 'duration', hint: 'Isometric hold' },
  { key: 'doorway_press',       label: 'Doorway press',              category: 'strength', primaryMetric: 'duration', hint: 'Isometric hold' },
  { key: 'dead_hang',           label: 'Dead hang',                  category: 'strength', primaryMetric: 'duration', hint: 'Grip + shoulder decompression' },
  { key: 'grip_strength_press', label: 'Grip strength press',        category: 'strength', primaryMetric: 'load',     secondsPerRep: 3, hint: 'Dynamometer resistance (kg) + reps' },

  // ── Spine & Trunk Mobility ────────────────────────────────────────────────
  { key: 'foam_roller_thoracic', label: 'Foam roller thoracic ext.', category: 'spine', primaryMetric: 'duration' },
  { key: 'body_waves',           label: 'Body waves',                category: 'spine', primaryMetric: 'duration' },
  { key: 'trunk_twists',         label: 'Trunk twists',              category: 'spine', primaryMetric: 'duration' },
  { key: 'twist_the_waist',      label: 'Twist the waist',           category: 'spine', primaryMetric: 'duration' },
  { key: 'golf_swings',          label: 'Golf swings',               category: 'spine', primaryMetric: 'duration' },

  // ── Shoulder & Arm Mobility ───────────────────────────────────────────────
  { key: 'forward_arm_circles',  label: 'Forward arm circles',       category: 'shoulder', primaryMetric: 'duration' },
  { key: 'backward_arm_swings',  label: 'Backward arm swings',       category: 'shoulder', primaryMetric: 'duration' },
  { key: 'arm_swings',           label: 'Arm swings',                category: 'shoulder', primaryMetric: 'duration' },
  { key: 'dead_arms',            label: 'Dead arms',                 category: 'shoulder', primaryMetric: 'duration' },
  { key: 'tiptoe_arm_swings',    label: 'Tiptoe arm swings',         category: 'shoulder', primaryMetric: 'duration' },

  // ── Circulation & Activation ──────────────────────────────────────────────
  { key: 'lymphatic_hops',       label: 'Lymphatic hops',            category: 'circulation', primaryMetric: 'duration' },
  { key: 'marches',              label: 'Marches',                   category: 'circulation', primaryMetric: 'duration' },

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
