import { WellnessRecord } from '@/types';

// Single source of truth for "how ready am I to train today" — used by both
// the Readiness Score card and the Daily Training suggestion, so they can
// never show two different recovery numbers for the same day again.

export interface ReadinessFactor {
  key: string;
  label: string;
  score: number; // 0-100
  detail: string;
}

export type ReadinessBandName = 'Primed' | 'Ready' | 'Maintain' | 'Rest';

export interface ReadinessBand {
  label: ReadinessBandName;
  sub: string;
  color: string;
  border: string;
  bg: string;
  dot: string;
}

export interface ReadinessResult {
  overall: number;
  band: ReadinessBand;
  factors: ReadinessFactor[];
}

const avg = (vals: number[]): number => vals.reduce((a, b) => a + b, 0) / vals.length;
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export const READINESS_BAND = (score: number): ReadinessBand => {
  if (score >= 75) return { label: 'Primed',   sub: 'Good day for a hard session', color: 'text-green-400', border: 'border-green-500/30', bg: 'bg-green-500/10', dot: 'bg-green-500' };
  if (score >= 55) return { label: 'Ready',    sub: 'Normal training is fine',     color: 'text-blue-400',  border: 'border-blue-500/30',  bg: 'bg-blue-500/10',  dot: 'bg-blue-500' };
  if (score >= 35) return { label: 'Maintain', sub: 'Keep it easy or moderate',    color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10', dot: 'bg-amber-500' };
  return               { label: 'Rest',        sub: 'Recovery day recommended',    color: 'text-red-400',   border: 'border-red-500/30',   bg: 'bg-red-500/10',   dot: 'bg-red-500' };
};

// wellness must be sorted ascending by date and should be the FULL, unfiltered
// history — this computes its own 30-day rolling baselines, so a dashboard
// period filter (e.g. "1W") would silently truncate the baseline window.
export function computeReadiness(wellnessSortedAsc: WellnessRecord[]): ReadinessResult | null {
  const sorted = wellnessSortedAsc.filter(w => w.date);
  if (sorted.length < 8) return null;

  const today = sorted[sorted.length - 1];
  const baselineWindow = sorted.slice(-31, -1); // last 30 days, excluding today

  const factors: ReadinessFactor[] = [];

  // HRV — higher is better
  const hrvBaseline = baselineWindow.map(w => w.hrv_rmssd).filter((v): v is number => v != null);
  if (today.hrv_rmssd != null && hrvBaseline.length >= 5) {
    const base = avg(hrvBaseline);
    const pctDiff = base > 0 ? ((today.hrv_rmssd - base) / base) * 100 : 0;
    factors.push({
      key: 'hrv', label: 'HRV',
      score: clamp(50 + pctDiff * 2.5),
      detail: `${today.hrv_rmssd} ms · ${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(0)}% vs 30d`,
    });
  }

  // Resting HR — lower is better
  const rhrBaseline = baselineWindow.map(w => w.resting_hr).filter((v): v is number => v != null);
  if (today.resting_hr != null && rhrBaseline.length >= 5) {
    const base = avg(rhrBaseline);
    const pctDiff = base > 0 ? ((base - today.resting_hr) / base) * 100 : 0;
    factors.push({
      key: 'rhr', label: 'Resting HR',
      score: clamp(50 + pctDiff * 5),
      detail: `${today.resting_hr} bpm · ${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(1)}% vs 30d`,
    });
  }

  // Sleep — prefer Garmin's sleep_score (already 0-100), fall back to hours / 8h target
  if (today.sleep_score != null) {
    factors.push({
      key: 'sleep', label: 'Sleep',
      score: clamp(today.sleep_score),
      detail: `Sleep score ${today.sleep_score}${today.sleep_hours != null ? ` · ${today.sleep_hours.toFixed(1)}h` : ''}`,
    });
  } else if (today.sleep_hours != null) {
    factors.push({
      key: 'sleep', label: 'Sleep',
      score: clamp((today.sleep_hours / 8) * 100),
      detail: `${today.sleep_hours.toFixed(1)}h (target 8h)`,
    });
  }

  // Body battery — already 0-100; fall back to 100 - stress
  if (today.body_battery != null) {
    factors.push({
      key: 'battery', label: 'Body Battery',
      score: clamp(today.body_battery),
      detail: `${today.body_battery} / 100`,
    });
  } else if (today.stress_score != null) {
    factors.push({
      key: 'battery', label: 'Recovery',
      score: clamp(100 - today.stress_score),
      detail: `Stress score ${today.stress_score}`,
    });
  }

  if (factors.length === 0) return null;

  const overall = Math.round(avg(factors.map(f => f.score)));
  return { overall, band: READINESS_BAND(overall), factors };
}
