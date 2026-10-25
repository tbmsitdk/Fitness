/**
 * Longevity sub-scores.
 *
 * These were step functions — resting HR scored 85 anywhere under 55 bpm and
 * 100 only under 50 — which made the headline score almost immovable. Real
 * progress (resting HR 54.8 -> 52.9, sleep 6.9h -> 7.7h) changed nothing,
 * because none of it crossed a band edge. A score that cannot move is not
 * measuring anything.
 *
 * Every component is now interpolated between the SAME anchor points the bands
 * used, so the calibration is unchanged at those values but continuous in
 * between. Scores shift by a few points on first use, upward on the whole,
 * because stepping always rounded down to the band floor.
 */

export type Anchor = [value: number, score: number];

/**
 * Piecewise-linear score from anchors, which must be sorted by value ascending.
 * Values outside the range clamp to the nearest anchor's score rather than
 * extrapolating into nonsense.
 *
 * Works for metrics in either direction, and for non-monotonic ones: sleep
 * peaks in the 7-9h range and falls away on both sides, which anchors express
 * naturally and a band table could not.
 */
export function interpolateScore(value: number, anchors: Anchor[]): number {
  if (anchors.length === 0) return 0;
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];

  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (value >= x0 && value <= x1) {
      if (x1 === x0) return y1;
      const t = (value - x0) / (x1 - x0);
      return Math.round((y0 + t * (y1 - y0)) * 10) / 10;
    }
  }
  return last[1];
}

/** Resting heart rate, bpm. Lower is better; anchors are the old band edges. */
export const RHR_ANCHORS: Anchor[] = [
  [45, 100], [50, 100], [55, 85], [60, 70], [65, 55], [70, 40], [75, 25], [85, 10],
];

export function restingHrScore(bpm: number): number {
  return interpolateScore(bpm, RHR_ANCHORS);
}

/**
 * Credit for a falling resting HR, scaled by how fast it is falling rather than
 * switched on at a threshold. The old +10 flipped at a slope of -0.05 bpm/day,
 * so a hair either side of it moved the headline score by a full point.
 */
export function rhrTrendBonus(slopePerDay: number): number {
  if (!Number.isFinite(slopePerDay) || slopePerDay >= 0) return 0;
  return Math.round(Math.min(10, -slopePerDay * 200) * 10) / 10;
}

/** Skeletal muscle mass, kg. */
export const MUSCLE_ANCHORS_MALE: Anchor[] = [[20, 10], [25, 25], [28, 50], [33, 75], [38, 100]];
export const MUSCLE_ANCHORS_FEMALE: Anchor[] = [[14, 10], [18, 25], [20, 50], [25, 75], [30, 100]];

export function muscleMassScore(kg: number, sex: 'male' | 'female'): number {
  return interpolateScore(kg, sex === 'male' ? MUSCLE_ANCHORS_MALE : MUSCLE_ANCHORS_FEMALE);
}

/** Sleep hours. Peaks at 7-9h and falls away on BOTH sides — more is not better. */
export const SLEEP_ANCHORS: Anchor[] = [
  [3, 10], [5, 40], [6, 70], [7, 100], [9, 100], [10, 80], [12, 50],
];

export function sleepScore(hours: number): number {
  return interpolateScore(hours, SLEEP_ANCHORS);
}

/** Weekly active minutes. 150 is the public-health floor, 300 the upper target. */
export const ACTIVE_ANCHORS: Anchor[] = [[0, 20], [60, 40], [150, 70], [300, 100], [600, 100]];

export function activeMinutesScore(weeklyMinutes: number): number {
  return interpolateScore(weeklyMinutes, ACTIVE_ANCHORS);
}

/** Weighted mean over whatever components have data, reweighted proportionally. */
export function compositeScore(parts: { score: number; weight: number }[]): number {
  const total = parts.reduce((s, p) => s + p.weight, 0);
  if (total === 0) return 0;
  return Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0) / total);
}

// ── Stable inputs ────────────────────────────────────────────────────────────

/**
 * A representative recent value for a biomarker.
 *
 * Scores were being computed from a SINGLE most-recent reading. One night's
 * resting HR moves several bpm with illness, alcohol or bad sleep — the very
 * things being measured elsewhere in this app — so the cardiovascular age
 * jumped around day to day and reacted to noise rather than to fitness.
 *
 * Takes the MEDIAN over a window, which ignores one freak reading entirely
 * where a mean would drag towards it. When the window is empty the most recent
 * reading is used instead and `stale` is set, so a metric recorded
 * infrequently (a manual weigh-in) still counts but can be labelled honestly.
 */
export interface WindowedValue {
  value: number | null;
  /** How many readings the median was taken over. 0 when falling back. */
  n: number;
  /** True when no reading fell inside the window. */
  stale: boolean;
  /** Age in days of the newest reading used. */
  ageDays: number | null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function windowedValue(
  readings: { date: string; value: number | null }[],
  days: number,
  now: number = Date.now(),
): WindowedValue {
  const present = readings
    .filter((r): r is { date: string; value: number } => r.value != null)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (present.length === 0) return { value: null, n: 0, stale: false, ageDays: null };

  const ageOf = (d: string) =>
    Math.floor((now - new Date(`${d}T00:00:00`).getTime()) / 86_400_000);

  const inWindow = present.filter(r => ageOf(r.date) < days);
  if (inWindow.length > 0) {
    return {
      value: median(inWindow.map(r => r.value)),
      n: inWindow.length,
      stale: false,
      ageDays: ageOf(inWindow[0].date),
    };
  }
  // Nothing recent: fall back to the newest reading rather than dropping the
  // factor, and say that it is old.
  return { value: present[0].value, n: 0, stale: true, ageDays: ageOf(present[0].date) };
}

/**
 * Window lengths per biomarker, set by how fast each actually moves and how
 * noisy its daily reading is.
 */
export const INPUT_WINDOW_DAYS = {
  restingHr: 14,   // daily, swings with sleep/alcohol/illness
  hrv: 14,         // daily, the noisiest of all
  bodyFat: 30,     // manual weigh-ins, sparse and scale-dependent
  vo2max: 60,      // Garmin moves it slowly; a long window is still responsive
  muscleMass: 30,  // same scale, same sparseness as body fat
} as const;
