// Per-activity figures worked out in code from the stored 10-second samples
// (heart rate, power, cadence), for the raw-data tables the coach and Deep
// Analysis read. The model gets one row per activity, never the samples: a year
// of them is millions of rows.
//
// Design rule, as everywhere: not recorded is EMPTY, never zero.
//  - an activity with no stored samples gets no row at all (its summary figures
//    are still in activities.csv);
//  - a figure that needs power or heart rate the activity lacks is empty;
//  - decoupling needs 20+ minutes, cardiac lag only counts above a weak fit.

import {
  computeBestEfforts, computeDecoupling, computeVariabilityIndex, computeWorkAboveFtp, computeCardiacLag,
  type ActivitySample,
} from '@/lib/activity-analysis';

export interface ActivityDetailRow {
  /** ISO start of the activity, as stored. */
  date: string;
  type: string;
  title: string;
  /** Minutes covered by stored samples (can be shorter than the activity). */
  sample_minutes: number;
  /** Share of samples that carry a power / heart-rate reading, 0-100. */
  pct_with_power: number;
  pct_with_hr: number;
  best_10s_w: number | null;
  best_1min_w: number | null;
  best_5min_w: number | null;
  best_20min_w: number | null;
  /** Average heart rate during the best 20-minute power window. */
  best_20min_hr: number | null;
  /** Power:HR drift, first half against second; positive = HR rose for the same power. */
  decoupling_pct: number | null;
  variability_index: number | null;
  /** Average watts above FTP while above it, and the share of time above it. */
  avg_w_above_ftp: number | null;
  pct_time_above_ftp: number | null;
  /** Seconds HR trails power; only reported when the fit is at least moderate. */
  cardiac_lag_s: number | null;
  /** Peak and average heart rate from the samples. */
  peak_hr: number | null;
}

export const ACTIVITY_DETAIL_COLUMNS = [
  'date', 'weekday', 'start_time', 'type', 'title', 'sample_minutes', 'pct_with_power', 'pct_with_hr',
  'best_10s_w', 'best_1min_w', 'best_5min_w', 'best_20min_w', 'best_20min_hr', 'decoupling_pct',
  'variability_index', 'avg_w_above_ftp', 'pct_time_above_ftp', 'cardiac_lag_s', 'peak_hr',
] as const;

const SAMPLE_INTERVAL = 10;
const share = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

export interface ActivityForDetail { date: string; activity_type: string; title: string }

/** One row from one activity's samples, or null when it has none to read. */
export function activityDetailRow(
  activity: ActivityForDetail, samples: ActivitySample[], ftp: number | null,
): ActivityDetailRow | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a.elapsed_seconds - b.elapsed_seconds);

  const withPower = sorted.filter(s => s.power != null && s.power > 0);
  const withHr = sorted.filter(s => s.hr != null && s.hr > 0);
  // A power meter that reads 0 the whole time is not a power meter.
  const hasPower = withPower.length >= 3;
  const hasHr = withHr.length >= 3;

  const efforts = hasPower ? computeBestEfforts(sorted) : [];
  const byLabel = (label: string) => efforts.find(e => e.label === label);
  const twenty = byLabel('20min');

  const decoupling = hasPower && hasHr ? computeDecoupling(sorted) : null;
  const vi = hasPower ? computeVariabilityIndex(sorted) : null;
  const aboveFtp = hasPower ? computeWorkAboveFtp(sorted, ftp) : null;
  const lag = hasPower && hasHr ? computeCardiacLag(sorted) : null;

  return {
    date: activity.date,
    type: activity.activity_type,
    title: activity.title,
    sample_minutes: Math.round((sorted[sorted.length - 1].elapsed_seconds + SAMPLE_INTERVAL) / 60),
    pct_with_power: share(withPower.length, sorted.length),
    pct_with_hr: share(withHr.length, sorted.length),
    best_10s_w: byLabel('10s')?.power ?? null,
    best_1min_w: byLabel('1min')?.power ?? null,
    best_5min_w: byLabel('5min')?.power ?? null,
    best_20min_w: twenty?.power ?? null,
    best_20min_hr: twenty?.hr ?? null,
    decoupling_pct: decoupling ? decoupling.pctDrift : null,
    variability_index: vi ? vi.vi : null,
    avg_w_above_ftp: aboveFtp ? aboveFtp.avgWattsAboveFtp : null,
    pct_time_above_ftp: aboveFtp ? aboveFtp.pctTimeAboveFtp : null,
    // A weak fit is a guess; leave it empty.
    cardiac_lag_s: lag && lag.confidence !== 'low' ? lag.lagSeconds : null,
    peak_hr: hasHr ? Math.max(...withHr.map(s => s.hr as number)) : null,
  };
}

export function buildActivityDetailRows(
  activities: (ActivityForDetail & { id: number })[],
  samplesByActivity: Map<number, ActivitySample[]>,
  ftp: number | null,
): ActivityDetailRow[] {
  const rows: ActivityDetailRow[] = [];
  for (const a of activities) {
    const r = activityDetailRow(a, samplesByActivity.get(a.id) ?? [], ftp);
    if (r) rows.push(r);
  }
  return rows.sort((x, y) => x.date.localeCompare(y.date));
}

// ── Raw 10-second samples for the few activities a run should look inside ──

/** Most activities whose samples one analysis run is given. Keeps the upload small. */
export const MAX_SAMPLE_ACTIVITIES = 30;

export const SAMPLE_FILE_COLUMNS = ['activity_id', 'start', 'type', 'elapsed_seconds', 'hr', 'power', 'cadence'] as const;

const cell = (v: number | string | null) => (v == null ? '' : String(v));

/** CSV rows (no header) for one activity. Empty means not recorded, never zero. */
export function sampleCsvRows(
  activity: { id: number; start: string; type: string }, samples: ActivitySample[],
): string[] {
  return [...samples]
    .sort((a, b) => a.elapsed_seconds - b.elapsed_seconds)
    .map(s => [activity.id, activity.start, activity.type, s.elapsed_seconds, s.hr, s.power, s.cadence].map(cell).join(','));
}
