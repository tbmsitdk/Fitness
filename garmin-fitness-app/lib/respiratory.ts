/**
 * Predicted respiratory values for a healthy adult, used as peer benchmarks on
 * the Airofit chart.
 *
 * Every number here comes from a published reference equation — none are
 * invented. Each function names its source so the numbers can be checked.
 *
 * IMPORTANT CAVEAT on the pressure equations: MIP/MEP reference values come
 * from a clinical maneuver performed against a closed valve with a flanged
 * mouthpiece. A handheld trainer measures something similar but not identical,
 * and device readings typically land BELOW lab-derived predictions — the gap is
 * especially wide for MEP. Treat these lines as orientation, not diagnosis, and
 * read your own trend as the real signal.
 */

export type Sex = 'male' | 'female';

/**
 * Predicted vital capacity (litres).
 *
 * ECCS / Quanjer et al. (1993), "Lung volumes and forced ventilatory flows",
 * European Respiratory Journal — the classic European reference equations.
 * Valid roughly ages 18-70; we clamp rather than extrapolate wildly.
 */
export function predictedVitalCapacity(
  age: number, sex: Sex, heightCm: number | null,
): number | null {
  if (!heightCm || heightCm <= 0) return null;
  const h = heightCm / 100; // equations take metres
  const a = Math.min(Math.max(age, 18), 80);
  const vc = sex === 'male'
    ? 5.76 * h - 0.026 * a - 4.34
    : 4.43 * h - 0.026 * a - 2.89;
  return vc > 0 ? Math.round(vc * 100) / 100 : null;
}

/**
 * Predicted maximal inspiratory pressure (cmH2O).
 * Black & Hyatt (1969), Am Rev Respir Dis 99:696-702.
 */
export function predictedMIP(age: number, sex: Sex): number {
  const a = Math.min(Math.max(age, 18), 80);
  const mip = sex === 'male' ? 143 - 0.55 * a : 104 - 0.51 * a;
  return Math.round(Math.max(mip, 0));
}

/**
 * Predicted maximal expiratory pressure (cmH2O).
 * Black & Hyatt (1969), same paper.
 *
 * These values run high — a predicted MEP above 200 is normal for a middle-aged
 * male. A trainer device will almost never read that. See the caveat at the top
 * of this file before showing this number without context.
 */
export function predictedMEP(age: number, sex: Sex): number {
  const a = Math.min(Math.max(age, 18), 80);
  const mep = sex === 'male' ? 268 - 1.03 * a : 170 - 0.53 * a;
  return Math.round(Math.max(mep, 0));
}

/** Percent of predicted, rounded to a whole number. Null when either side is missing. */
export function percentOfPredicted(
  actual: number | null | undefined, predicted: number | null | undefined,
): number | null {
  if (actual == null || predicted == null || predicted <= 0) return null;
  return Math.round((actual / predicted) * 100);
}

/**
 * Least-squares linear fit over evenly-spaced points, returned as a value per
 * input index so it can be plotted as a parallel series. Null for every point
 * when there is too little data to imply a direction — two points are a line,
 * not a trend.
 */
export function linearTrend(values: (number | null)[], decimals = 2): (number | null)[] {
  const pts = values
    .map((y, x) => ({ x, y }))
    .filter((p): p is { x: number; y: number } => p.y != null);

  if (pts.length < 3) return values.map(() => null);

  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
  const d = n * sxx - sx * sx;
  if (d === 0) return values.map(() => null);

  const slope = (n * sxy - sx * sy) / d;
  const intercept = (sy - slope * sx) / n;
  const f = 10 ** decimals;
  // Drawn across every index, including ones with no reading — the fitted line
  // is continuous even where the underlying series has gaps.
  return values.map((_, x) => Math.round((slope * x + intercept) * f) / f);
}
