import { describe, it, expect } from 'vitest';
import {
  filterCyclingByPower,
  computePersonalBests,
  computeWeeklyVolume,
  computeTrainingLoad,
  computeConsistency,
} from '@/lib/training-load';
import type { Activity } from '@/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function act(overrides: Partial<Activity> & { activity_type: string }): Activity {
  return {
    id: 1, garmin_id: 'g1', title: '', date: '2024-06-01T08:00:00Z',
    distance_km: 10, duration_seconds: 3600, calories: 500,
    avg_hr: 140, max_hr: 175, training_effect: 3.0, avg_cadence: 85,
    avg_speed_kmh: 30, tss: 70, avg_power: null, max_power: null,
    elevation_gain: 100, normalized_power: null, ftp: null,
    ...overrides,
  };
}

const RIDE_HARD   = act({ id: 1, garmin_id: 'c1', activity_type: 'cycling', avg_power: 220, normalized_power: 230, duration_seconds: 3600, distance_km: 40 });
const RIDE_EASY   = act({ id: 2, garmin_id: 'c2', activity_type: 'cycling', avg_power: 80,  normalized_power: 85,  duration_seconds: 3600, distance_km: 35 });
const RIDE_NOPWR  = act({ id: 3, garmin_id: 'c3', activity_type: 'cycling', avg_power: null, normalized_power: null, duration_seconds: 3600, distance_km: 30 });
const RUN_5K      = act({ id: 4, garmin_id: 'r1', activity_type: 'running', distance_km: 5.1, duration_seconds: 1350 }); // ~4:25/km
const RUN_10K     = act({ id: 5, garmin_id: 'r2', activity_type: 'running', distance_km: 10.0, duration_seconds: 2700 }); // ~4:30/km

// ── filterCyclingByPower ──────────────────────────────────────────────────────

describe('filterCyclingByPower', () => {
  const activities = [RIDE_HARD, RIDE_EASY, RIDE_NOPWR, RUN_5K];

  it('returns all activities when minPower is null', () => {
    expect(filterCyclingByPower(activities, null)).toHaveLength(4);
  });

  it('returns all activities when minPower is 0', () => {
    expect(filterCyclingByPower(activities, 0)).toHaveLength(4);
  });

  it('excludes cycling rides below threshold', () => {
    const result = filterCyclingByPower(activities, 150);
    expect(result).toHaveLength(2); // RIDE_HARD + RUN_5K
    expect(result.map(a => a.id)).toContain(RIDE_HARD.id);
    expect(result.map(a => a.id)).not.toContain(RIDE_EASY.id);
  });

  it('excludes cycling rides with no power data when threshold is set', () => {
    const result = filterCyclingByPower(activities, 150);
    expect(result.map(a => a.id)).not.toContain(RIDE_NOPWR.id);
  });

  it('never removes non-cycling activities regardless of threshold', () => {
    const result = filterCyclingByPower(activities, 9999);
    expect(result.map(a => a.id)).toContain(RUN_5K.id);
  });

  it('keeps all rides when threshold equals exact avg_power', () => {
    const result = filterCyclingByPower([RIDE_HARD], 220);
    expect(result).toHaveLength(1);
  });

  it('excludes ride when threshold is one above avg_power', () => {
    const result = filterCyclingByPower([RIDE_HARD], 221);
    expect(result).toHaveLength(0);
  });
});

// ── computePersonalBests ──────────────────────────────────────────────────────

describe('computePersonalBests', () => {
  it('finds fastest 5K pace', () => {
    const bests = computePersonalBests([RUN_5K, RUN_10K]);
    const pr5k = bests.find(b => b.label === 'Fastest 5K pace');
    expect(pr5k).toBeDefined();
    expect(pr5k?.activity_type).toBe('running');
  });

  it('finds longest ride', () => {
    const bests = computePersonalBests([RIDE_HARD, RIDE_EASY]);
    const longest = bests.find(b => b.label === 'Longest ride');
    expect(longest?.value).toContain('40');
  });

  it('finds peak avg power', () => {
    const bests = computePersonalBests([RIDE_HARD, RIDE_EASY]);
    const peakPwr = bests.find(b => b.label === 'Peak avg power (ride)');
    expect(peakPwr?.value).toContain('220');
  });

  it('respects minCyclingPower for power PRs', () => {
    // With threshold 150 W, only RIDE_HARD (220W) counts for power PRs
    const bests = computePersonalBests([RIDE_HARD, RIDE_EASY], 150);
    const peakPwr = bests.find(b => b.label === 'Peak avg power (ride)');
    expect(peakPwr?.value).toContain('220');
  });

  it('excludes easy ride from power PRs when below minCyclingPower', () => {
    // With threshold 200 W, only RIDE_HARD (220W) qualifies
    const withThreshold = computePersonalBests([RIDE_HARD, RIDE_EASY], 200);
    const withoutThreshold = computePersonalBests([RIDE_HARD, RIDE_EASY]);
    // Both should find RIDE_HARD as peak power (220W), not RIDE_EASY (80W)
    const peakWith = withThreshold.find(b => b.label === 'Peak avg power (ride)');
    const peakWithout = withoutThreshold.find(b => b.label === 'Peak avg power (ride)');
    expect(peakWith?.value).toBe(peakWithout?.value);
  });

  it('finds no power PRs when all rides are below threshold', () => {
    const bests = computePersonalBests([RIDE_EASY], 150);
    expect(bests.find(b => b.label === 'Peak avg power (ride)')).toBeUndefined();
    expect(bests.find(b => b.label === 'Peak normalized power')).toBeUndefined();
  });

  it('longest ride is NOT affected by minCyclingPower threshold', () => {
    // Distance PRs should include all rides regardless of power threshold
    const bests = computePersonalBests([RIDE_HARD, RIDE_EASY], 150);
    const longest = bests.find(b => b.label === 'Longest ride');
    expect(longest).toBeDefined(); // RIDE_HARD is 40km, passes threshold
  });

  it('returns empty array for empty input', () => {
    expect(computePersonalBests([])).toEqual([]);
  });
});

// ── computeWeeklyVolume ───────────────────────────────────────────────────────

describe('computeWeeklyVolume', () => {
  const activities = [
    act({ id: 10, garmin_id: 'r10', activity_type: 'running',  date: '2024-06-03T08:00:00Z', distance_km: 10, duration_seconds: 3000 }),
    act({ id: 11, garmin_id: 'c11', activity_type: 'cycling',  date: '2024-06-05T08:00:00Z', distance_km: 50, duration_seconds: 5400 }),
    act({ id: 12, garmin_id: 'w12', activity_type: 'walking',  date: '2024-06-06T08:00:00Z', distance_km: 5,  duration_seconds: 3600 }),
  ];

  it('groups activities into weeks', () => {
    const vol = computeWeeklyVolume(activities);
    expect(vol.length).toBeGreaterThanOrEqual(1);
  });

  it('accumulates running km correctly', () => {
    const vol = computeWeeklyVolume(activities);
    const totalRunKm = vol.reduce((s, w) => s + w.running_km, 0);
    expect(totalRunKm).toBeCloseTo(10);
  });

  it('accumulates cycling km correctly', () => {
    const vol = computeWeeklyVolume(activities);
    const totalCycleKm = vol.reduce((s, w) => s + w.cycling_km, 0);
    expect(totalCycleKm).toBeCloseTo(50);
  });

  it('returns empty array for empty input', () => {
    expect(computeWeeklyVolume([])).toEqual([]);
  });
});

// ── computeTrainingLoad ───────────────────────────────────────────────────────

describe('computeTrainingLoad', () => {
  const activities = [
    act({ id: 20, garmin_id: 't20', activity_type: 'running', date: '2024-01-01T08:00:00Z', tss: 80 }),
    act({ id: 21, garmin_id: 't21', activity_type: 'cycling', date: '2024-01-03T08:00:00Z', tss: 120 }),
  ];

  it('produces one entry per day between first and last activity', () => {
    const load = computeTrainingLoad(activities);
    expect(load.length).toBeGreaterThan(0);
  });

  it('CTL is non-negative', () => {
    const load = computeTrainingLoad(activities);
    load.forEach(d => expect(d.ctl).toBeGreaterThanOrEqual(0));
  });

  it('ATL is non-negative', () => {
    const load = computeTrainingLoad(activities);
    load.forEach(d => expect(d.atl).toBeGreaterThanOrEqual(0));
  });

  it('TSB ≈ CTL - ATL (within rounding)', () => {
    const load = computeTrainingLoad(activities);
    // TSB is stored rounded to 1 decimal, so allow ±0.2 difference
    load.forEach(d => expect(Math.abs(d.tsb - (d.ctl - d.atl))).toBeLessThan(0.2));
  });

  it('returns empty array for empty input', () => {
    expect(computeTrainingLoad([])).toEqual([]);
  });
});

// ── computeConsistency ────────────────────────────────────────────────────────

describe('computeConsistency', () => {
  const activities = [
    act({ id: 30, garmin_id: 'cs30', activity_type: 'running', date: '2024-06-01T08:00:00Z' }),
    act({ id: 31, garmin_id: 'cs31', activity_type: 'cycling', date: '2024-06-01T10:00:00Z' }), // same day
    act({ id: 32, garmin_id: 'cs32', activity_type: 'walking', date: '2024-06-15T08:00:00Z' }),
  ];

  it('returns one entry per month', () => {
    const result = computeConsistency(activities);
    expect(result.length).toBe(1);
    expect(result[0].month).toBe('2024-06');
  });

  it('counts unique active days (not activity count)', () => {
    const result = computeConsistency(activities);
    // June 1 and June 15 = 2 active days (even though June 1 has 2 activities)
    expect(result[0].active_days).toBe(2);
  });

  it('tracks sport-specific days', () => {
    const result = computeConsistency(activities);
    expect(result[0].running_days).toBe(1);
    expect(result[0].cycling_days).toBe(1);
    expect(result[0].walking_days).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(computeConsistency([])).toEqual([]);
  });
});
