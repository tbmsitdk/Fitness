// Energy balance: calories taken in (meal diary) against calories burned
// (the watch's daily total = resting + active), per day.
//
// A net figure is only as good as BOTH of its halves, so a day gets one only
// when both are whole (tasks/lessons.md 4 and 21):
//   - intake: a diary day the person marked complete, with every meal estimated
//   - burned: a figure synced AFTER the day ended. The sync runs at 04:00 and
//     reads "today" too, when the watch has counted four hours of the day; that
//     partial figure must never be subtracted from a full day's food.
// Anything else is shown as what it is — partial or missing — and left out of
// every average.

import type { WellnessRecord } from '@/types';
import type { NutritionLog } from '@/lib/nutrition';
import { dateOnly } from '@/lib/raw-data';

/** Rough energy content of a kilogram of body fat. A planning figure, not physiology. */
export const KCAL_PER_KG = 7700;
/** Days of net figures needed before a weekly rate is worth stating. */
export const MIN_DAYS_FOR_RATE = 7;

export type IntakeStatus = 'complete' | 'partial' | 'none';
export type BurnStatus = 'final' | 'partial' | 'none';

export interface EnergyDay {
  date: string;
  /** Calories eaten and drunk. Null unless the diary day is complete. */
  intake: number | null;
  intakeStatus: IntakeStatus;
  /** Calories burned (resting + active). Null unless the day's figure is final. */
  burned: number | null;
  active: number | null;
  resting: number | null;
  burnStatus: BurnStatus;
  /** intake − burned. Negative = deficit, positive = surplus. Null unless both halves are whole. */
  net: number | null;
}

/**
 * Was the burn figure written after the day was over? Home is Copenhagen, where
 * the day ends at 22:00 or 23:00 UTC; 23:00 UTC is used for both, which at
 * worst asks a summer day to wait one extra hour.
 */
export function isBurnFinal(w: Pick<WellnessRecord, 'date' | 'kcal_burned' | 'kcal_synced_at'>): boolean {
  if (w.kcal_burned == null || !w.kcal_synced_at) return false;
  const synced = Date.parse(w.kcal_synced_at);
  const dayEnd = Date.parse(`${dateOnly(w.date)}T23:00:00Z`);
  return Number.isFinite(synced) && Number.isFinite(dayEnd) && synced >= dayEnd;
}

/** One row per day that has anything on either side, newest first. */
export function energyDays(nutritionLogs: NutritionLog[], wellness: WellnessRecord[]): EnergyDay[] {
  const days = new Map<string, EnergyDay>();
  const dayFor = (date: string): EnergyDay => {
    const d = days.get(date) ?? {
      date, intake: null, intakeStatus: 'none', burned: null, active: null, resting: null, burnStatus: 'none', net: null,
    };
    days.set(date, d);
    return d;
  };

  for (const l of nutritionLogs) {
    // A hand-typed day has counts but no calories: it is not an intake day at all.
    if (!l.from_meals) continue;
    const d = dayFor(dateOnly(l.date));
    if (l.day_complete && l.kcal != null) { d.intake = l.kcal; d.intakeStatus = 'complete'; }
    else d.intakeStatus = 'partial';
  }

  for (const w of wellness) {
    if (w.kcal_burned == null) continue;
    const d = dayFor(dateOnly(w.date));
    if (isBurnFinal(w)) {
      d.burned = w.kcal_burned; d.active = w.active_kcal ?? null; d.resting = w.resting_kcal ?? null;
      d.burnStatus = 'final';
    } else d.burnStatus = 'partial';
  }

  for (const d of days.values()) {
    if (d.intake != null && d.burned != null) d.net = d.intake - d.burned;
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export interface EnergySummary {
  /** Days with both halves whole — the only days in any figure below. */
  days: number;
  avgIntake: number | null;
  avgBurned: number | null;
  /** Mean daily net. Negative = average deficit. */
  avgNet: number | null;
  totalNet: number | null;
  deficitDays: number;
  surplusDays: number;
  /**
   * What the average net would mean in kg of body weight per week if it held.
   * Null with fewer than MIN_DAYS_FOR_RATE days: a couple of days say nothing.
   */
  kgPerWeek: number | null;
}

export function energySummary(rows: EnergyDay[]): EnergySummary {
  const whole = rows.filter(r => r.net != null);
  const n = whole.length;
  if (n === 0) {
    return { days: 0, avgIntake: null, avgBurned: null, avgNet: null, totalNet: null, deficitDays: 0, surplusDays: 0, kgPerWeek: null };
  }
  const sum = (pick: (r: EnergyDay) => number) => whole.reduce((s, r) => s + pick(r), 0);
  const totalNet = sum(r => r.net as number);
  const avgNet = totalNet / n;
  return {
    days: n,
    avgIntake: Math.round(sum(r => r.intake as number) / n),
    avgBurned: Math.round(sum(r => r.burned as number) / n),
    avgNet: Math.round(avgNet),
    totalNet: Math.round(totalNet),
    deficitDays: whole.filter(r => (r.net as number) < 0).length,
    surplusDays: whole.filter(r => (r.net as number) > 0).length,
    kgPerWeek: n >= MIN_DAYS_FOR_RATE ? Math.round(((avgNet * 7) / KCAL_PER_KG) * 100) / 100 : null,
  };
}

/** "350 kcal deficit" / "200 kcal surplus" / "in balance". */
export function describeNet(net: number): string {
  const rounded = Math.round(net);
  if (rounded === 0) return 'in balance';
  return `${Math.abs(rounded).toLocaleString('en-US')} kcal ${rounded < 0 ? 'deficit' : 'surplus'}`;
}
