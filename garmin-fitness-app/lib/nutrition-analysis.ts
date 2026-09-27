/**
 * Does what you eat and drink show up in your recovery?
 *
 * Three deliberate choices, each of which changes the answer:
 *
 * 1. LAG. Alcohol on Saturday evening does not affect Saturday's metrics — it
 *    affects Saturday NIGHT's sleep and Sunday morning's HRV. Comparing intake
 *    on day D against recovery on day D is the most common way to conclude
 *    "no effect" when there is a large one.
 *
 * 2. BUCKETS, NOT CORRELATION COEFFICIENTS. With a few hundred days, r is noisy
 *    and nearly impossible to act on. "3-4 units cost you 9 ms of HRV" is both
 *    more robust and more useful than "r = -0.34".
 *
 * 3. HONEST n. Every bucket carries its sample size, and buckets below
 *    MIN_BUCKET_N are marked unreliable rather than quietly shown as fact.
 *
 * This is observational n-of-1 data. Repeated measures on one person control
 * for genetics, age and training history in a way population studies cannot,
 * so it is decent personal evidence — but it is not proof of causation, and
 * confounders are called out where they are known (see weekendSplit).
 */

import type { NutritionLog } from './nutrition';

/** Below this many days, a bucket's mean is not worth reporting as fact. */
export const MIN_BUCKET_N = 5;

export interface DayMetrics {
  date: string;
  hrv: number | null;
  restingHr: number | null;
  sleepHours: number | null;
  sleepScore: number | null;
  bodyBattery: number | null;
  stress: number | null;
  tss: number | null;
}

export type OutcomeKey = keyof Omit<DayMetrics, 'date'>;

export interface OutcomeDef {
  key: OutcomeKey;
  label: string;
  unit: string;
  /** Does a HIGHER value mean a better outcome? Drives colouring, not maths. */
  higherIsBetter: boolean;
  /** Decimal places when displayed. */
  decimals: number;
}

export const OUTCOMES: OutcomeDef[] = [
  { key: 'hrv',         label: 'HRV (RMSSD)',   unit: 'ms', higherIsBetter: true,  decimals: 1 },
  { key: 'restingHr',   label: 'Resting HR',    unit: 'bpm', higherIsBetter: false, decimals: 1 },
  { key: 'sleepScore',  label: 'Sleep score',   unit: '',   higherIsBetter: true,  decimals: 1 },
  { key: 'sleepHours',  label: 'Sleep',         unit: 'h',  higherIsBetter: true,  decimals: 2 },
  { key: 'bodyBattery', label: 'Body battery',  unit: '',   higherIsBetter: true,  decimals: 1 },
  { key: 'stress',      label: 'Stress',        unit: '',   higherIsBetter: false, decimals: 1 },
  { key: 'tss',         label: 'Next-day load', unit: 'TSS', higherIsBetter: true, decimals: 1 },
];

/**
 * Which day's metrics answer for intake on day D.
 *
 * Everything here is measured the MORNING AFTER, so every outcome uses D+1.
 * Garmin stamps a night's sleep on the date you woke up, so the sleep that
 * followed Saturday's drinking is already filed under Sunday — the same +1
 * offset is correct for sleep and for next-morning HRV alike.
 */
export const OUTCOME_LAG_DAYS = 1;

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Saturday or Sunday. Used to expose weekend confounding, never to hide it. */
export function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ── Dose-response ────────────────────────────────────────────────────────────

export interface Bucket {
  label: string;
  min: number;
  max: number;   // inclusive upper bound; Infinity for the top bucket
}

export const ALCOHOL_BUCKETS: Bucket[] = [
  { label: 'None',      min: 0,   max: 0 },
  { label: '1–2 units', min: 0.5, max: 2 },
  { label: '3–4 units', min: 2.5, max: 4 },
  { label: '5+ units',  min: 4.5, max: Infinity },
];

export const CANDY_BUCKETS: Bucket[] = [
  { label: 'None',         min: 0,   max: 0 },
  { label: '1 portion',    min: 0.5, max: 1 },
  { label: '2–3 portions', min: 1.5, max: 3 },
  { label: '4+ portions',  min: 3.5, max: Infinity },
];

export interface BucketResult {
  label: string;
  n: number;
  value: number | null;
  /** Difference from the baseline (first) bucket. Null on the baseline itself. */
  delta: number | null;
  /** n below MIN_BUCKET_N — show it, but never as a confident number. */
  unreliable: boolean;
}

export interface DoseResponse {
  outcome: OutcomeDef;
  buckets: BucketResult[];
  /** Total days contributing any outcome value. */
  n: number;
}

/**
 * Average an outcome within each intake bucket.
 *
 * `intakeOf` reads the exposure from a nutrition row; days where it is null are
 * skipped entirely, because an unlogged day is not a zero-intake day.
 */
export function doseResponse(
  logs: NutritionLog[],
  metricsByDate: Map<string, DayMetrics>,
  intakeOf: (l: NutritionLog) => number | null,
  buckets: Bucket[],
  outcome: OutcomeDef,
): DoseResponse {
  const samples: number[][] = buckets.map(() => []);

  for (const log of logs) {
    const intake = intakeOf(log);
    if (intake == null) continue;               // never logged — not a zero

    const idx = buckets.findIndex(b => intake >= b.min && intake <= b.max);
    if (idx === -1) continue;

    const outcomeDay = metricsByDate.get(addDays(log.date, OUTCOME_LAG_DAYS));
    const value = outcomeDay?.[outcome.key];
    if (value == null) continue;

    samples[idx].push(value);
  }

  const means = samples.map(mean);
  const baseline = means[0];

  return {
    outcome,
    n: samples.reduce((s, arr) => s + arr.length, 0),
    buckets: buckets.map((b, i) => ({
      label: b.label,
      n: samples[i].length,
      value: means[i],
      delta: i > 0 && means[i] != null && baseline != null ? means[i]! - baseline : null,
      unreliable: samples[i].length > 0 && samples[i].length < MIN_BUCKET_N,
    })),
  };
}

// ── Ranked effects ───────────────────────────────────────────────────────────

export interface EffectSize {
  exposureLabel: string;
  outcome: OutcomeDef;
  /** Mean with exposure minus mean without. */
  delta: number | null;
  /** Cohen's d — delta in pooled standard deviations. */
  d: number | null;
  nExposed: number;
  nBaseline: number;
  unreliable: boolean;
  /** True when the direction is unfavourable for this outcome. */
  worse: boolean;
}

/**
 * Compare days where an exposure was present against days where it was
 * explicitly absent. Cohen's d makes effects comparable across metrics that
 * live on different scales — 10 ms of HRV and 3 bpm of resting HR are not
 * otherwise commensurable.
 */
export function effectSize(
  logs: NutritionLog[],
  metricsByDate: Map<string, DayMetrics>,
  exposureLabel: string,
  isExposed: (l: NutritionLog) => boolean | null,
  outcome: OutcomeDef,
): EffectSize {
  const exposed: number[] = [];
  const baseline: number[] = [];

  for (const log of logs) {
    const flag = isExposed(log);
    if (flag == null) continue;
    const value = metricsByDate.get(addDays(log.date, OUTCOME_LAG_DAYS))?.[outcome.key];
    if (value == null) continue;
    (flag ? exposed : baseline).push(value);
  }

  const mExposed = mean(exposed);
  const mBaseline = mean(baseline);
  const delta = mExposed != null && mBaseline != null ? mExposed - mBaseline : null;

  // Pooled SD for Cohen's d.
  let d: number | null = null;
  const sdE = stdDev(exposed);
  const sdB = stdDev(baseline);
  if (delta != null && sdE != null && sdB != null) {
    const nE = exposed.length, nB = baseline.length;
    const pooled = Math.sqrt(((nE - 1) * sdE ** 2 + (nB - 1) * sdB ** 2) / (nE + nB - 2));
    if (pooled > 0) d = delta / pooled;
  }

  return {
    exposureLabel,
    outcome,
    delta,
    d,
    nExposed: exposed.length,
    nBaseline: baseline.length,
    unreliable: exposed.length < MIN_BUCKET_N || baseline.length < MIN_BUCKET_N,
    worse: delta == null ? false : outcome.higherIsBetter ? delta < 0 : delta > 0,
  };
}

/**
 * Weekend confounding, made visible.
 *
 * Drinking clusters on weekends, and weekends also bring later nights, different
 * training and different meals. A plain drinking-vs-sober comparison is partly a
 * Saturday-vs-Tuesday comparison. Splitting the exposure by weekday/weekend
 * shows whether the effect survives inside each group — if it does, the weekend
 * is not doing the work.
 */
export function weekendSplit(
  logs: NutritionLog[],
  metricsByDate: Map<string, DayMetrics>,
  isExposed: (l: NutritionLog) => boolean | null,
  outcome: OutcomeDef,
): { weekday: EffectSize; weekend: EffectSize } {
  const weekdayLogs = logs.filter(l => !isWeekend(l.date));
  const weekendLogs = logs.filter(l => isWeekend(l.date));
  return {
    weekday: effectSize(weekdayLogs, metricsByDate, 'Weekdays', isExposed, outcome),
    weekend: effectSize(weekendLogs, metricsByDate, 'Weekends', isExposed, outcome),
  };
}

/**
 * Rank every exposure x outcome pair by absolute effect size.
 *
 * NOTE ON MULTIPLE COMPARISONS: scanning many pairs will surface some purely by
 * chance. Treat the ranking as a list of hypotheses worth testing deliberately
 * (a fortnight without alcohol, say), not as a set of established findings. The
 * UI states this; do not strip it.
 */
export function rankEffects(
  logs: NutritionLog[],
  metricsByDate: Map<string, DayMetrics>,
  exposures: { label: string; test: (l: NutritionLog) => boolean | null }[],
  outcomes: OutcomeDef[] = OUTCOMES,
): EffectSize[] {
  const all: EffectSize[] = [];
  for (const e of exposures) {
    for (const o of outcomes) {
      all.push(effectSize(logs, metricsByDate, e.label, e.test, o));
    }
  }
  return all
    .filter(e => e.d != null)
    .sort((a, b) => Math.abs(b.d!) - Math.abs(a.d!));
}

/** Standard exposures, defined once so every card asks the same question. */
export const STANDARD_EXPOSURES: { label: string; test: (l: NutritionLog) => boolean | null }[] = [
  { label: 'Any alcohol',       test: l => l.alcohol_units == null ? null : l.alcohol_units > 0 },
  { label: '3+ units alcohol',  test: l => l.alcohol_units == null ? null : l.alcohol_units >= 3 },
  { label: 'Any candy',         test: l => l.candy_portions == null ? null : l.candy_portions > 0 },
  { label: '3+ candy portions', test: l => l.candy_portions == null ? null : l.candy_portions >= 3 },
  { label: 'Any crisps/snacks', test: l => l.savoury_snacks == null ? null : l.savoury_snacks > 0 },
  { label: '2+ savoury snacks', test: l => l.savoury_snacks == null ? null : l.savoury_snacks >= 2 },
  { label: 'Sugary drinks',     test: l => l.sugary_drinks == null ? null : l.sugary_drinks > 0 },
  { label: 'Caffeine after 14', test: l => l.caffeine_after_14 },
  { label: 'Poor meals (≤2)',   test: l => l.meal_quality == null ? null : l.meal_quality <= 2 },
];
