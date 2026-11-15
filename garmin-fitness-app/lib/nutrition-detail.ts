// Correlation analysis on the DETAILED meal-diary numbers: calories, protein,
// fibre, added sugar, how late and how often you eat, and net energy balance.
//
// Fixed thresholds ("50 g of sugar", "under 80 g of protein") would be guesses
// about what is a lot FOR YOU. Instead each measure is split into thirds of
// your own complete days, and the highest third is compared with the lowest.
// What counts as high is therefore high for you, and the comparison needs no
// invented cut-off.
//
// Everything here reads the same nutrition rows as the rest of the analysis
// (lib/nutrition-analysis.ts). Those rows hold a total only on days that were
// marked complete (lib/meals.ts), so a partial day is never a "low" day:
// accessors return null and the day is left out (tasks/lessons.md 4, 21, 25).

import { lastFoodMinutes, type NutritionLog } from '@/lib/nutrition';
import type { Bucket } from '@/lib/nutrition-analysis';
import { energyDays } from '@/lib/energy-balance';
import type { WellnessRecord } from '@/types';

export interface DetailExposure {
  key: string;
  /** Short name, e.g. "Added sugar". */
  label: string;
  unit: string;
  decimals: number;
  /** The day's value, or null when it is not known. Null days take no part. */
  of: (l: NutritionLog) => number | null;
  /** How to print a value (default: rounded, with its unit). */
  format?: (v: number) => string;
}

const num = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);

/** Minutes past midnight (24:30 = 00:30 the next night) back to a clock time. */
export function clock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const DETAIL_EXPOSURES: DetailExposure[] = [
  { key: 'kcal',                label: 'Calories eaten',          unit: 'kcal', decimals: 0, of: l => num(l.kcal) },
  { key: 'protein_g',           label: 'Protein',                 unit: 'g',    decimals: 0, of: l => num(l.protein_g) },
  { key: 'fibre_g',             label: 'Fibre',                   unit: 'g',    decimals: 0, of: l => num(l.fibre_g) },
  { key: 'added_sugar_g',       label: 'Added sugar',             unit: 'g',    decimals: 0, of: l => num(l.added_sugar_g) },
  { key: 'veg_fruit_portions',  label: 'Vegetables and fruit',    unit: 'portions', decimals: 1, of: l => num(l.veg_fruit_portions) },
  { key: 'evening_kcal_pct',    label: 'Share eaten after 19:00', unit: '%',    decimals: 0, of: l => num(l.evening_kcal_pct) },
  { key: 'in_between_kcal_pct', label: 'Share eaten in between meals', unit: '%', decimals: 0, of: l => num(l.in_between_kcal_pct) },
  { key: 'ultra_processed_pct', label: 'Share ultra-processed',   unit: '%',    decimals: 0, of: l => num(l.ultra_processed_pct) },
  { key: 'eating_window_h',     label: 'Eating window',           unit: 'h',    decimals: 1, of: l => num(l.eating_window_h) },
  // Late-night eating counts as later than 23:59, not as early morning.
  { key: 'last_food',           label: 'Last food',               unit: '',     decimals: 0, of: l => lastFoodMinutes(l), format: clock },
];

/** Net energy balance per day (eaten − burned), for days with both halves whole. */
export function netByDate(logs: NutritionLog[], wellness: WellnessRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of energyDays(logs, wellness)) if (d.net != null) out.set(d.date, d.net);
  return out;
}

export function netExposure(net: Map<string, number>): DetailExposure {
  return {
    key: 'net_kcal', label: 'Net calories (eaten − burned)', unit: 'kcal', decimals: 0,
    of: l => net.get(l.date.slice(0, 10)) ?? null,
    format: v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('en-US')} kcal`,
  };
}

export function formatValue(e: DetailExposure, v: number): string {
  if (e.format) return e.format(v);
  const rounded = Number(v.toFixed(e.decimals));
  return `${rounded.toLocaleString('en-US')}${e.unit ? ` ${e.unit}` : ''}`;
}

// ── Thirds ───────────────────────────────────────────────────────────────────

/**
 * Days needed before a measure is split at all. With nine, the lowest and the
 * highest third each hold at least three days; ties only add to them.
 */
export const MIN_DAYS_FOR_THIRDS = 9;

export interface Thirds {
  /** Lowest third: values at or below this. */
  low: number;
  /** Highest third: values at or above this. */
  high: number;
  nLow: number;
  nHigh: number;
  n: number;
}

/**
 * Cut-offs for the lowest and highest third of a set of values. Null when
 * there are too few days, or so many ties that the thirds cannot be told apart
 * (a measure that is 0 on most days has no "highest third" worth comparing).
 */
export function thirdsOf(values: number[]): Thirds | null {
  if (values.length < MIN_DAYS_FOR_THIRDS) return null;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const low = s[Math.ceil(n / 3) - 1];
  const high = s[Math.floor((2 * n) / 3)];
  if (!(low < high)) return null;
  return { low, high, nLow: s.filter(v => v <= low).length, nHigh: s.filter(v => v >= high).length, n };
}

export interface DetailComparison {
  exposure: DetailExposure;
  thirds: Thirds;
  /** Habit label for the ranking table, with the real cut-offs in it. */
  label: string;
  /** true = highest third, false = lowest third, null = middle or not known. */
  test: (l: NutritionLog) => boolean | null;
}

/** Days that have a value for this measure. */
export function valuesOf(logs: NutritionLog[], e: DetailExposure): number[] {
  return logs.map(e.of).filter((v): v is number => v != null);
}

/** One comparison per measure that has enough days to split. Order follows the input. */
export function detailComparisons(logs: NutritionLog[], exposures: DetailExposure[]): DetailComparison[] {
  const out: DetailComparison[] = [];
  for (const exposure of exposures) {
    const thirds = thirdsOf(valuesOf(logs, exposure));
    if (!thirds) continue;
    out.push({
      exposure, thirds,
      label: `${exposure.label}: ${formatValue(exposure, thirds.high)} or more (vs ${formatValue(exposure, thirds.low)} or less)`,
      test: l => {
        const v = exposure.of(l);
        if (v == null) return null;
        if (v >= thirds.high) return true;
        if (v <= thirds.low) return false;
        return null;
      },
    });
  }
  return out;
}

/** Buckets for dose-response: lowest third is the baseline, so deltas read "versus your lowest days". */
export function thirdsBuckets(t: Thirds): Bucket[] {
  // Values are rounded to a tenth, so a margin this small cannot swallow a real value.
  const EPS = 1e-6;
  return [
    { label: 'Lowest third', min: -Infinity, max: t.low },
    { label: 'Middle third', min: t.low + EPS, max: t.high - EPS },
    { label: 'Highest third', min: t.high, max: Infinity },
  ];
}
