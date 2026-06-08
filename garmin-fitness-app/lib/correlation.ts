// Statistical correlation explorer — finds relationships between daily metrics
// (wellness + training load) using Pearson correlation, optionally lagged by
// a number of days (e.g. "does last night's sleep predict today's resting HR?").
// Pure stats, no AI — every result is a computed number with a plain-language gloss.

export interface MetricSeries {
  key: string;
  label: string;
  unit: string;
  goodDirection?: 'up' | 'down'; // used only for phrasing, not for the math
  values: Map<string, number>; // date (yyyy-mm-dd) -> value
}

export interface CorrelationResult {
  a: MetricSeries;
  b: MetricSeries;
  lagDays: number; // metric A is sampled `lagDays` before metric B
  r: number;
  n: number;
  description: string;
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function strengthLabel(absR: number): string {
  if (absR >= 0.5) return 'a strong';
  if (absR >= 0.3) return 'a moderate';
  return 'a weak';
}

function describe(a: MetricSeries, b: MetricSeries, lagDays: number, r: number, n: number): string {
  const direction = r > 0 ? 'higher' : 'lower';
  const strength = strengthLabel(Math.abs(r));
  const timing = lagDays === 0
    ? 'on the same day'
    : `${lagDays} day${lagDays > 1 ? 's' : ''} later`;
  const subject = lagDays === 0 ? `${a.label} tends to track with ${b.label.toLowerCase()}` : `${a.label} tends to be followed by ${direction} ${b.label.toLowerCase()}`;
  if (lagDays === 0) {
    return `${a.label} and ${b.label} show ${strength} ${r > 0 ? 'positive' : 'negative'} relationship ${timing} (r = ${r.toFixed(2)}, n = ${n} days). When one is ${direction === 'higher' ? 'higher' : 'higher'}, the other tends to be ${r > 0 ? 'higher' : 'lower'} too.`;
  }
  return `${subject} ${timing} — ${strength} ${r > 0 ? 'positive' : 'negative'} relationship (r = ${r.toFixed(2)}, n = ${n} days).`;
}

const MIN_SAMPLE_SIZE = 20;
const MIN_ABS_R = 0.25;

/**
 * Scans all distinct metric pairs (and a small set of day-lags) for Pearson
 * correlations, filters out weak/low-sample results, and returns the strongest
 * ones sorted by |r| descending — each with a plain-language description.
 */
export function findCorrelations(series: MetricSeries[], lags: number[] = [0, 1, 2], maxResults = 12): CorrelationResult[] {
  const results: CorrelationResult[] = [];

  for (let i = 0; i < series.length; i++) {
    for (let j = 0; j < series.length; j++) {
      if (i === j) continue;
      const a = series[i];
      const b = series[j];
      // Avoid emitting both (a,b,lag=0) and (b,a,lag=0) — they're identical.
      if (lags.includes(0) && i > j) continue;

      for (const lag of lags) {
        if (lag === 0 && i > j) continue;
        const xs: number[] = [];
        const ys: number[] = [];
        for (const [date, aVal] of a.values) {
          const bDate = lag === 0 ? date : addDays(date, lag);
          const bVal = b.values.get(bDate);
          if (bVal == null) continue;
          xs.push(aVal);
          ys.push(bVal);
        }
        if (xs.length < MIN_SAMPLE_SIZE) continue;
        const r = pearson(xs, ys);
        if (r == null || !isFinite(r) || Math.abs(r) < MIN_ABS_R) continue;

        results.push({
          a, b, lagDays: lag, r: Math.round(r * 1000) / 1000, n: xs.length,
          description: describe(a, b, lag, r, xs.length),
        });
      }
    }
  }

  // De-duplicate near-identical pairs (same metric pair, keep strongest lag)
  const byPair = new Map<string, CorrelationResult>();
  for (const res of results) {
    const key = `${res.a.key}|${res.b.key}`;
    const existing = byPair.get(key);
    if (!existing || Math.abs(res.r) > Math.abs(existing.r)) byPair.set(key, res);
  }

  return [...byPair.values()]
    .sort((x, y) => Math.abs(y.r) - Math.abs(x.r))
    .slice(0, maxResults);
}
