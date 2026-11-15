// Early-warning watch: several recovery signals drifting the wrong way at once,
// for several days — the pattern that tends to precede illness or overreaching.
//
// Deliberately plain code, not a model call: it must be the same every time,
// explainable, and testable. The model only words the result (lib/daily-brief).
//
// Traps this avoids (tasks/lessons.md):
//   3. Direction: resting HR, stress and breathing rate are bad when they RISE;
//      body battery and sleep score are bad when they FALL.
//   4. A missing reading is not a zero and is never counted as "normal".
//   6. Alcohol, travel and hard training move the same signals. They are
//      reported as likely explanations, not hidden.

import type { WellnessRecord } from '@/types';
import type { NutritionLog } from '@/lib/nutrition';
import { tripDates, expectedAdaptationDays, totalZonesCrossed, type TravelLog } from '@/lib/travel';
import { dateOnly } from '@/lib/raw-data';

export type WarningLevel = 'none' | 'watch' | 'warning';

export interface WarningMetric {
  key: 'resting_hr' | 'stress_score' | 'respiratory_rate' | 'body_battery' | 'sleep_score';
  label: string;
  unit: string;
  /** True when a HIGHER value is the bad direction. */
  badWhenHigh: boolean;
  /** Physiological signals: at least one must be off before anything is raised. */
  core: boolean;
}

export const WARNING_METRICS: WarningMetric[] = [
  { key: 'resting_hr',       label: 'Resting HR',     unit: 'bpm', badWhenHigh: true,  core: true },
  { key: 'stress_score',     label: 'Stress',         unit: '',    badWhenHigh: true,  core: true },
  { key: 'respiratory_rate', label: 'Breathing rate', unit: '/min', badWhenHigh: true, core: true },
  { key: 'body_battery',     label: 'Body battery',   unit: '',    badWhenHigh: false, core: false },
  { key: 'sleep_score',      label: 'Sleep score',    unit: '',    badWhenHigh: false, core: false },
];

export const BASELINE_DAYS = 28;
export const RECENT_DAYS = 3;
export const MIN_BASELINE_READINGS = 14;
/** Robust z-score (median/MAD) beyond which a reading counts as off. */
export const OFF_THRESHOLD = 1.5;
/** Data older than this cannot say anything about today. */
export const STALE_AFTER_DAYS = 3;

export interface WarningSignal {
  key: WarningMetric['key'];
  label: string;
  unit: string;
  /** Most recent reading. */
  latest: number;
  /** Median of the baseline window. */
  baseline: number;
  /** How far the latest reading is in the BAD direction, in robust standard deviations. */
  deviation: number;
  /** Of the recent readings, how many were off. */
  daysOff: number;
  recentReadings: number;
}

export interface EarlyWarning {
  level: WarningLevel;
  /** Date of the newest wellness row used. Null when there is no data. */
  asOf: string | null;
  /** True when the newest data is too old to judge today. */
  stale: boolean;
  /** Signals that are off, worst first. */
  signals: WarningSignal[];
  /** Things already known that could account for it. */
  explanations: string[];
  /** Why the level is what it is, in one sentence. */
  reason: string;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayDiff(from: string, to: string): number {
  return Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000);
}

export interface EarlyWarningInput {
  wellness: WellnessRecord[];
  /** Today in the home timezone, YYYY-MM-DD. */
  today: string;
  nutritionLogs?: NutritionLog[];
  travelLogs?: TravelLog[];
  /** Training stress per day (YYYY-MM-DD → TSS), for the "hard training" explanation. */
  dailyLoad?: Map<string, number>;
}

export function computeEarlyWarning(input: EarlyWarningInput): EarlyWarning {
  const byDay = new Map<string, WellnessRecord>();
  for (const w of input.wellness) {
    const day = dateOnly(w.date);
    if (day <= input.today) byDay.set(day, w);
  }
  const days = [...byDay.keys()].sort();
  const asOf = days.length ? days[days.length - 1] : null;

  if (!asOf) {
    return { level: 'none', asOf: null, stale: true, signals: [], explanations: [], reason: 'No wellness data yet.' };
  }
  if (dayDiff(asOf, input.today) > STALE_AFTER_DAYS) {
    return {
      level: 'none', asOf, stale: true, signals: [], explanations: [],
      reason: `The newest data is from ${asOf}; that is too old to judge today.`,
    };
  }

  // Recent = the last RECENT_DAYS calendar days up to the newest row.
  // Baseline = the BASELINE_DAYS before that, so a bad week cannot become its own normal.
  const recentFrom = addDays(asOf, -(RECENT_DAYS - 1));
  const baselineFrom = addDays(recentFrom, -BASELINE_DAYS);

  const signals: WarningSignal[] = [];
  let judged = 0;

  for (const m of WARNING_METRICS) {
    const read = (day: string): number | null => {
      const v = byDay.get(day)?.[m.key];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    const baseline = days.filter(d => d >= baselineFrom && d < recentFrom).map(read).filter((v): v is number => v !== null);
    const recent = days.filter(d => d >= recentFrom).map(d => ({ day: d, v: read(d) })).filter((r): r is { day: string; v: number } => r.v !== null);
    if (baseline.length < MIN_BASELINE_READINGS || recent.length < 2) continue;
    judged++;

    const med = median(baseline);
    const mad = median(baseline.map(v => Math.abs(v - med)));
    // A perfectly flat baseline has MAD 0; fall back to a small fraction of
    // the level so one unit of change is not an infinite deviation.
    const scale = mad > 0 ? mad / 0.6745 : Math.max(Math.abs(med) * 0.03, 1);
    const badZ = (v: number) => ((v - med) / scale) * (m.badWhenHigh ? 1 : -1);

    const daysOff = recent.filter(r => badZ(r.v) >= OFF_THRESHOLD).length;
    const latest = recent[recent.length - 1].v;
    // Off = at least two of the recent readings, and still off (or close) today.
    if (daysOff >= 2 && badZ(latest) >= OFF_THRESHOLD - 0.5) {
      signals.push({
        key: m.key, label: m.label, unit: m.unit, latest,
        baseline: Math.round(med * 10) / 10,
        deviation: Math.round(badZ(latest) * 10) / 10,
        daysOff, recentReadings: recent.length,
      });
    }
  }

  signals.sort((a, b) => b.deviation - a.deviation);
  const coreOff = signals.some(s => WARNING_METRICS.find(m => m.key === s.key)?.core);

  let level: WarningLevel = 'none';
  if (coreOff && signals.length >= 3) level = 'warning';
  else if (coreOff && signals.length >= 2) level = 'watch';

  // ── Known causes of the same pattern ──────────────────────────────────────
  const explanations: string[] = [];
  if (level !== 'none') {
    // Intake on day D shows in the morning of D+1.
    const drinks = (input.nutritionLogs ?? [])
      .filter(n => n.alcohol_units != null && n.alcohol_units >= 2)
      .filter(n => { const morning = addDays(dateOnly(n.date), 1); return morning >= recentFrom && morning <= asOf; });
    if (drinks.length) {
      const total = drinks.reduce((s, n) => s + (n.alcohol_units ?? 0), 0);
      explanations.push(`Alcohol: ${total} units logged over ${drinks.length} of the nights before these readings.`);
    }

    for (const trip of input.travelLogs ?? []) {
      const zones = totalZonesCrossed(trip);
      const away = tripDates(trip, input.today);
      const adaptingUntil = trip.return_date ? addDays(dateOnly(trip.return_date), expectedAdaptationDays(zones)) : null;
      const travelling = away.some(d => d >= recentFrom && d <= asOf);
      const adapting = zones >= 2 && adaptingUntil !== null && dateOnly(trip.return_date!) <= asOf && adaptingUntil >= recentFrom;
      if (travelling || adapting) {
        explanations.push(travelling
          ? `Travel: away in ${trip.destination}${zones >= 2 ? ` (${zones} time zones crossed)` : ''}.`
          : `Travel: back from ${trip.destination} on ${dateOnly(trip.return_date!)}, ${zones} time zones; still within the expected adjustment period.`);
        break;
      }
    }

    if (input.dailyLoad) {
      const load = (from: string, to: string) => {
        let sum = 0;
        for (const [day, tss] of input.dailyLoad!) if (day >= from && day <= to) sum += tss;
        return sum;
      };
      const recentLoad = load(addDays(recentFrom, -1), asOf) / (RECENT_DAYS + 1);
      const usualLoad = load(baselineFrom, addDays(recentFrom, -2)) / (BASELINE_DAYS - 1);
      if (usualLoad > 0 && recentLoad >= usualLoad * 1.6 && recentLoad >= 40) {
        explanations.push(`Training: the last ${RECENT_DAYS + 1} days averaged ${Math.round(recentLoad)} TSS a day against a usual ${Math.round(usualLoad)}.`);
      }
    }
  }

  const reason =
    judged === 0 ? 'Not enough recent readings and baseline to judge.'
    : level === 'warning' ? `${signals.length} recovery signals have been off for at least two of the last ${RECENT_DAYS} days.`
    : level === 'watch' ? `${signals.length} recovery signals have been off for at least two of the last ${RECENT_DAYS} days.`
    : signals.length === 1 ? `Only ${signals[0].label.toLowerCase()} is off; one signal alone is not a pattern.`
    : signals.length > 1 ? 'Sleep and body battery are down but heart rate, stress and breathing are normal — more likely short nights than something brewing.'
    : 'Recovery signals are within their normal range.';

  return { level, asOf, stale: false, signals, explanations, reason };
}
