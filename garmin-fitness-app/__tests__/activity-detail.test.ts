import { describe, it, expect } from 'vitest';
import { activityDetailRow, buildActivityDetailRows } from '@/lib/activity-detail';
import { buildRawTables, buildRawTablesWithin, DATA_DICTIONARY } from '@/lib/raw-data';
import type { ActivitySample } from '@/lib/activity-analysis';

const act = { id: 1, date: '2026-11-21T11:58:00Z', activity_type: 'cycling', title: 'Zwift - Power Punches' };
// 40 minutes at one sample per 10 s: 150 W steady, a 600 W spike, HR 140.
function ride(opts: { power?: boolean; hr?: boolean; minutes?: number } = {}): ActivitySample[] {
  const { power = true, hr = true, minutes = 40 } = opts;
  return Array.from({ length: minutes * 6 }, (_, i) => ({
    elapsed_seconds: i * 10,
    power: power ? (i === 20 ? 600 : 150) : null,
    hr: hr ? 140 : null,
    cadence: 80,
  }));
}

describe('activityDetailRow', () => {
  it('reads best efforts and variability from the samples', () => {
    const r = activityDetailRow(act, ride(), 200)!;
    expect(r.best_10s_w).toBe(600);
    expect(r.best_20min_w).toBeGreaterThan(150);
    expect(r.variability_index).toBeGreaterThan(1);
    expect(r.sample_minutes).toBe(40);
    expect(r.pct_with_power).toBe(100);
    expect(r.peak_hr).toBe(140);
  });

  it('gives no row for an activity with no samples', () => {
    expect(activityDetailRow(act, [], 200)).toBeNull();
  });

  it('leaves every power figure EMPTY, not zero, for a walk without a power meter', () => {
    const r = activityDetailRow({ ...act, activity_type: 'walking' }, ride({ power: false }), 200)!;
    for (const k of ['best_10s_w', 'best_1min_w', 'best_5min_w', 'best_20min_w', 'best_20min_hr', 'decoupling_pct',
      'variability_index', 'avg_w_above_ftp', 'pct_time_above_ftp', 'cardiac_lag_s'] as const) {
      expect(r[k], k).toBeNull();
    }
    expect(r.pct_with_power).toBe(0);
    expect(r.peak_hr).toBe(140);
  });

  it('leaves heart-rate figures empty when only power was recorded', () => {
    const r = activityDetailRow(act, ride({ hr: false }), 200)!;
    expect(r.peak_hr).toBeNull();
    expect(r.decoupling_pct).toBeNull();
    expect(r.best_10s_w).toBe(600);
  });

  it('has no decoupling for a short effort and no above-FTP figures without an FTP', () => {
    expect(activityDetailRow(act, ride({ minutes: 10 }), 200)!.decoupling_pct).toBeNull();
    const r = activityDetailRow(act, ride(), null)!;
    expect(r.avg_w_above_ftp).toBeNull();
    expect(r.pct_time_above_ftp).toBeNull();
  });

  it('does not report a 20-minute best for a 10-minute ride', () => {
    expect(activityDetailRow(act, ride({ minutes: 10 }), 200)!.best_20min_w).toBeNull();
  });
});

describe('activity_detail.csv in the raw tables', () => {
  const rows = buildActivityDetailRows([act, { ...act, id: 2, date: '2026-11-20T08:00:00Z', title: 'No samples' }],
    new Map([[1, ride()]]), 200);

  it('has one row per activity with samples, the others left out', () => {
    expect(rows).toHaveLength(1);
    const csv = buildRawTables({ activities: [], wellness: [], activityDetail: rows })['activity_detail.csv'];
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].split(',')[0]).toBe('date');
    expect(lines[1]).toContain('Zwift - Power Punches');
    expect(lines[1]).toContain('600');
  });

  it('is absent when there is nothing to show', () => {
    expect(buildRawTables({ activities: [], wellness: [], activityDetail: [] })['activity_detail.csv']).toBeUndefined();
  });

  it('is trimmed with the rest when the window shrinks', () => {
    const old = buildActivityDetailRows([{ ...act, date: '2024-01-01T10:00:00Z' }], new Map([[1, ride()]]), 200);
    const out = buildRawTablesWithin({ activities: [], wellness: [], activityDetail: old }, 100_000, Date.parse('2026-11-21'));
    expect(out.tables['activity_detail.csv']).toBeDefined();
    const tight = buildRawTablesWithin({ activities: [], wellness: [], activityDetail: old }, 1, Date.parse('2026-11-21'));
    expect(tight.tables['activity_detail.csv']).toBeUndefined();
  });

  it('is explained in the data dictionary', () => {
    expect(DATA_DICTIONARY).toContain('activity_detail.csv');
    expect(DATA_DICTIONARY).toContain('never zero');
  });
});

import { sampleCsvRows, SAMPLE_FILE_COLUMNS, MAX_SAMPLE_ACTIVITIES } from '@/lib/activity-detail';

describe('raw sample rows', () => {
  const a = { id: 42, start: '2026-11-21T11:58:00.000Z', type: 'cycling' };
  it('writes one row per sample in time order, with empty cells for what was not recorded', () => {
    const rows = sampleCsvRows(a, [
      { elapsed_seconds: 10, hr: 141, power: null, cadence: 80 },
      { elapsed_seconds: 0, hr: null, power: 150, cadence: null },
    ]);
    expect(rows).toEqual([
      '42,2026-11-21T11:58:00.000Z,cycling,0,,150,',
      '42,2026-11-21T11:58:00.000Z,cycling,10,141,,80',
    ]);
    expect(rows[0].split(',')).toHaveLength(SAMPLE_FILE_COLUMNS.length);
  });
  it('is limited to a handful of activities per run', () => {
    expect(MAX_SAMPLE_ACTIVITIES).toBeLessThanOrEqual(30);
  });
  it('is described in the data dictionary as partial, not the full history', () => {
    expect(DATA_DICTIONARY).toContain('activity_samples.csv');
    expect(DATA_DICTIONARY).toContain('NOT the whole history');
  });
});
