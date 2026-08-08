import { vo2maxRating } from '@/lib/vo2max';

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
