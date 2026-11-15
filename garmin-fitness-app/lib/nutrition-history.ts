// Day-by-day view of the nutrition log: one row per logged day, and averages
// that only ever include days whose totals are real.

import type { NutritionLog } from '@/lib/nutrition';

export type DayStatus = 'complete' | 'partial' | 'by_hand';

export interface HistoryRow {
  date: string;
  status: DayStatus;
  meals: number | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  added_sugar_g: number | null;
  fat_g: number | null;
  fibre_g: number | null;
  veg_fruit_portions: number | null;
  evening_kcal_pct: number | null;
  in_between_kcal_pct: number | null;
  alcohol_units: number | null;
}

export const TOTAL_KEYS = ['kcal', 'protein_g', 'carbs_g', 'added_sugar_g', 'fat_g', 'fibre_g', 'veg_fruit_portions', 'evening_kcal_pct', 'in_between_kcal_pct'] as const;
export type TotalKey = typeof TOTAL_KEYS[number];

/**
 * complete = a diary day the person confirmed; partial = a diary day not yet
 * confirmed (no totals); by_hand = amounts typed into the form (never totals).
 */
export function dayStatus(log: NutritionLog): DayStatus {
  if (!log.from_meals) return 'by_hand';
  return log.day_complete ? 'complete' : 'partial';
}

/** One row per logged day, newest first. Totals are passed through only for complete days. */
export function historyRows(logs: NutritionLog[]): HistoryRow[] {
  return logs
    .map(l => {
      const status = dayStatus(l);
      const total = (v: number | null | undefined) => (status === 'complete' && v != null ? v : null);
      return {
        date: l.date.slice(0, 10),
        status,
        meals: l.from_meals ? l.meal_count ?? null : null,
        kcal: total(l.kcal), protein_g: total(l.protein_g), carbs_g: total(l.carbs_g),
        added_sugar_g: total(l.added_sugar_g), fat_g: total(l.fat_g), fibre_g: total(l.fibre_g),
        veg_fruit_portions: total(l.veg_fruit_portions), evening_kcal_pct: total(l.evening_kcal_pct),
        in_between_kcal_pct: total(l.in_between_kcal_pct),
        alcohol_units: l.alcohol_units,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface HistoryAverage { key: TotalKey; mean: number | null; n: number }

/** Mean of each total over the days that have it. n says how many days that is. */
export function historyAverages(rows: HistoryRow[]): HistoryAverage[] {
  return TOTAL_KEYS.map(key => {
    const values = rows.map(r => r[key]).filter((v): v is number => v != null);
    const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
    return { key, mean: mean == null ? null : Math.round(mean * 10) / 10, n: values.length };
  });
}

/** Oldest-first points for a trend line. Days without the total are left out, not drawn as zero. */
export function trendPoints(rows: HistoryRow[], key: TotalKey): { date: string; value: number }[] {
  return rows
    .filter(r => r[key] != null)
    .map(r => ({ date: r.date, value: r[key] as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
