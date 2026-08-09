import { vo2maxRating } from '@/lib/vo2max';
import { getAgeAsOf, type UserSettings } from '@/lib/settings';
import type { Activity, WellnessRecord } from '@/types';

export interface CardioFactorInput {
  age: number;
  sex: 'male' | 'female';
  restingHr?: number | null;
  vo2max?: number | null;
  bodyFatPct?: number | null;
  hrvRmssd?: number | null;
  weeklyActiveMinutes?: number | null; // always available (defaults to 0)
  sleepScore14dAvg?: number | null;
}

export interface CardioFactor {
  key: string;
  label: string;
  score: number;  // 0-100
  weight: number; // relative weight in the composite
  raw: number | null;
}

export interface CardioAgeResult {
  cardioAge: number;
  composite: number; // 0-100
  factors: CardioFactor[];
}

export function rhrScore(rhr: number): number {
  if (rhr < 50) return 100;
  if (rhr < 60) return 80;
  if (rhr < 70) return 60;
  if (rhr < 80) return 40;
  return 20;
}

// Age/sex-adjusted body fat % rating — same ACE/ACSM bands used by the Body
// Composition card, so the two cards never disagree about what a given
// body fat % means.
export function bodyFatScore(pct: number, age: number, sex: 'male' | 'female'): number {
  const male = sex === 'male';
  const [excellent, good, average, poor] = male
    ? age < 40 ? [8, 14, 18, 24] : age < 60 ? [11, 17, 22, 28] : [13, 20, 25, 30]
    : age < 40 ? [16, 21, 25, 32] : age < 60 ? [18, 24, 29, 35] : [19, 26, 31, 37];
  if (pct <= excellent) return 100;
  if (pct <= good)      return 80;
  if (pct <= average)   return 60;
  if (pct <= poor)      return 40;
  return 20;
}

// Approximate age-expected HRV (RMSSD, ms) — HRV declines fairly steadily with
// age. This is a smooth approximation, not a specific clinical citation; HRV
// varies enormously between individuals and measurement devices, so it's
// scored gently (small weight, wide tolerance) rather than as a hard cutoff.
export function hrvScore(rmssd: number, age: number): number {
  const expected = Math.max(20, 80 - (age - 20) * 0.85);
  const pctDiff = ((rmssd - expected) / expected) * 100;
  return Math.max(0, Math.min(100, 50 + pctDiff * 1.5));
}

export function activeMinutesScore(weeklyMinutes: number): number {
  if (weeklyMinutes >= 300) return 100;
  if (weeklyMinutes >= 150) return 70;
  if (weeklyMinutes >= 60)  return 40;
  return 20;
}

// Weighted composite of up to 6 biomarkers. Only factors with available data
// are included — a missing metric is excluded and the remaining weights are
// renormalized, rather than silently defaulting to a neutral 50 (which would
// distort the score whenever data is missing).
export function computeCardioAge(input: CardioFactorInput): CardioAgeResult {
  const { age, sex } = input;
  const factors: CardioFactor[] = [];

  if (input.vo2max != null) {
    factors.push({ key: 'vo2', label: 'VO₂ Max', score: vo2maxRating(input.vo2max, age, sex).score, weight: 25, raw: input.vo2max });
  }
  if (input.restingHr != null) {
    factors.push({ key: 'rhr', label: 'Resting HR', score: rhrScore(input.restingHr), weight: 20, raw: input.restingHr });
  }
  if (input.bodyFatPct != null) {
    factors.push({ key: 'bodyfat', label: 'Body Fat %', score: bodyFatScore(input.bodyFatPct, age, sex), weight: 15, raw: input.bodyFatPct });
  }
  factors.push({ key: 'activity', label: 'Weekly Active Minutes', score: activeMinutesScore(input.weeklyActiveMinutes ?? 0), weight: 15, raw: Math.round(input.weeklyActiveMinutes ?? 0) });
  if (input.sleepScore14dAvg != null) {
    factors.push({ key: 'sleep', label: 'Sleep Score (14d avg)', score: input.sleepScore14dAvg, weight: 10, raw: Math.round(input.sleepScore14dAvg) });
  }
  if (input.hrvRmssd != null) {
    factors.push({ key: 'hrv', label: 'HRV (RMSSD)', score: hrvScore(input.hrvRmssd, age), weight: 15, raw: input.hrvRmssd });
  }

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0) || 1;
  const composite = factors.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight;
  const cardioAge = Math.round(age * (1 - (composite - 50) / 200));

  return { cardioAge, composite: Math.round(composite), factors };
}

// ── Historical time series ──────────────────────────────────────────────────

export interface CardioAgeHistoryPoint {
  date: string;
  chronoAge: number;
  cardioAge: number;
  composite: number;
  factorCount: number;
}

// How stale a forward-filled reading is allowed to be before it's treated as
// missing rather than carried forward indefinitely.
const LOOKBACK_DAYS = { restingHr: 30, vo2max: 120, bodyFatPct: 60, hrvRmssd: 14 } as const;

const DAY_MS = 86400000;

// Forward-fills a sparse wellness field to every sample date: the most recent
// non-null reading on/before that date, or null if the latest reading is
// older than the field's lookback window. Single forward sweep — O(n + m).
function forwardFillSeries(
  sortedAsc: WellnessRecord[],
  field: keyof WellnessRecord,
  sampleDates: Date[],
  lookbackDays: number,
): (number | null)[] {
  const results: (number | null)[] = [];
  let idx = 0;
  let lastValue: number | null = null;
  let lastTime = -Infinity;
  for (const asOf of sampleDates) {
    const asOfTime = asOf.getTime();
    while (idx < sortedAsc.length && new Date(sortedAsc[idx].date).getTime() <= asOfTime) {
      const v = sortedAsc[idx][field];
      if (v != null) { lastValue = v as number; lastTime = new Date(sortedAsc[idx].date).getTime(); }
      idx++;
    }
    results.push(lastValue != null && asOfTime - lastTime <= lookbackDays * DAY_MS ? lastValue : null);
  }
  return results;
}

// Trailing sum over a rolling window ending at each sample date. Two pointers
// only ever move forward as asOf increases — O(n + m) total, not O(n*m).
function trailingSum(
  sortedAsc: { date: string; value: number }[],
  sampleDates: Date[],
  windowDays: number,
): number[] {
  const results: number[] = [];
  let start = 0, end = 0, sum = 0;
  for (const asOf of sampleDates) {
    const asOfTime = asOf.getTime();
    const windowStartTime = asOfTime - windowDays * DAY_MS;
    while (end < sortedAsc.length && new Date(sortedAsc[end].date).getTime() <= asOfTime) {
      sum += sortedAsc[end].value; end++;
    }
    while (start < end && new Date(sortedAsc[start].date).getTime() < windowStartTime) {
      sum -= sortedAsc[start].value; start++;
    }
    results.push(sum);
  }
  return results;
}

function trailingAvg(
  sortedAsc: { date: string; value: number }[],
  sampleDates: Date[],
  windowDays: number,
): (number | null)[] {
  const results: (number | null)[] = [];
  let start = 0, end = 0, sum = 0, count = 0;
  for (const asOf of sampleDates) {
    const asOfTime = asOf.getTime();
    const windowStartTime = asOfTime - windowDays * DAY_MS;
    while (end < sortedAsc.length && new Date(sortedAsc[end].date).getTime() <= asOfTime) {
      sum += sortedAsc[end].value; count++; end++;
    }
    while (start < end && new Date(sortedAsc[start].date).getTime() < windowStartTime) {
      sum -= sortedAsc[start].value; count--; start++;
    }
    results.push(count > 0 ? sum / count : null);
  }
  return results;
}

// Reconstructs cardiovascular age at weekly intervals across the full
// wellness/activity history, using forward-filled biomarkers (Garmin doesn't
// re-measure VO2max/body-fat every day) and the same rolling windows the
// live snapshot uses for activity minutes and sleep. Points where fewer than
// 2 biomarkers were available are dropped rather than shown as a flat,
// activity-only-driven age that would mislead the trend.
export function computeCardioAgeHistory(
  wellness: WellnessRecord[],
  activities: Activity[],
  settings: UserSettings,
  sampleIntervalDays = 7,
): CardioAgeHistoryPoint[] {
  const wellnessAsc = [...wellness].sort((a, b) => a.date.localeCompare(b.date));
  const activitiesAsc = [...activities].sort((a, b) => a.date.localeCompare(b.date));
  if (wellnessAsc.length === 0 && activitiesAsc.length === 0) return [];

  const firstDate = wellnessAsc[0]?.date ? new Date(wellnessAsc[0].date) : new Date(activitiesAsc[0].date);
  const lastDate = new Date();

  const sampleDates: Date[] = [];
  for (let t = firstDate.getTime(); t <= lastDate.getTime(); t += sampleIntervalDays * DAY_MS) {
    sampleDates.push(new Date(t));
  }
  if (sampleDates.length === 0) return [];

  const restingHrSeries = forwardFillSeries(wellnessAsc, 'resting_hr', sampleDates, LOOKBACK_DAYS.restingHr);
  const vo2maxSeries     = forwardFillSeries(wellnessAsc, 'vo2max', sampleDates, LOOKBACK_DAYS.vo2max);
  const bodyFatSeries    = forwardFillSeries(wellnessAsc, 'body_fat_pct', sampleDates, LOOKBACK_DAYS.bodyFatPct);
  const hrvSeries        = forwardFillSeries(wellnessAsc, 'hrv_rmssd', sampleDates, LOOKBACK_DAYS.hrvRmssd);

  const sleepEntries = wellnessAsc
    .filter(w => w.sleep_score != null)
    .map(w => ({ date: w.date, value: w.sleep_score as number }));
  const sleepSeries = trailingAvg(sleepEntries, sampleDates, 14);

  const activityEntries = activitiesAsc.map(a => ({ date: a.date, value: a.duration_seconds / 60 }));
  const activityMinutesSum28d = trailingSum(activityEntries, sampleDates, 28);

  const points: CardioAgeHistoryPoint[] = [];
  for (let i = 0; i < sampleDates.length; i++) {
    const asOf = sampleDates[i];
    const chronoAge = getAgeAsOf(settings, asOf);
    const result = computeCardioAge({
      age: chronoAge,
      sex: settings.sex,
      restingHr: restingHrSeries[i],
      vo2max: vo2maxSeries[i],
      bodyFatPct: bodyFatSeries[i],
      hrvRmssd: hrvSeries[i],
      weeklyActiveMinutes: activityMinutesSum28d[i] / 4,
      sleepScore14dAvg: sleepSeries[i],
    });

    // "activity" is always present; require at least one real biomarker too,
    // so the series doesn't start with a long stretch of meaningless points.
    const biomarkerCount = result.factors.filter(f => f.key !== 'activity').length;
    if (biomarkerCount === 0) continue;

    points.push({
      date: asOf.toISOString().split('T')[0],
      chronoAge,
      cardioAge: result.cardioAge,
      composite: result.composite,
      factorCount: result.factors.length,
    });
  }

  return points;
}
