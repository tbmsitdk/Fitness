import { describe, it, expect } from 'vitest';
import { buildMaxHrLookup } from '@/lib/hr-zones';
import { computeHRZoneDistribution } from '@/lib/training-load';
import type { Activity } from '@/types';

const reading = (date: string, max_hr: number | null) => ({ date, max_hr });

describe('buildMaxHrLookup', () => {
  it('averages the top 3 readings in the trailing year', () => {
    const lookup = buildMaxHrLookup([
      reading('2024-01-10', 170),
      reading('2024-03-01', 180),
      reading('2024-05-15', 175),
      reading('2024-07-01', 160), // not in top 3
    ], 190);
    // At 2024-08-01: top 3 of [170,180,175,160] = (180+175+170)/3 = 175
    expect(lookup('2024-08-01')).toBe(175);
  });

  it('excludes readings after the query date', () => {
    const lookup = buildMaxHrLookup([
      reading('2024-01-10', 170),
      reading('2024-06-01', 200), // future relative to query
    ], 190);
    expect(lookup('2024-03-01')).toBe(170);
  });

  it('excludes readings older than 365 days', () => {
    const lookup = buildMaxHrLookup([
      reading('2020-01-01', 195),
      reading('2024-02-01', 170),
    ], 190);
    expect(lookup('2024-06-01')).toBe(170);
  });

  it('falls back when no readings in window', () => {
    const lookup = buildMaxHrLookup([reading('2020-01-01', 180)], 185);
    expect(lookup('2024-06-01')).toBe(185);
  });

  it('ignores implausible readings (<=100 or >=230)', () => {
    const lookup = buildMaxHrLookup([
      reading('2024-01-10', 80),
      reading('2024-02-10', 250),
      reading('2024-03-10', null),
    ], 190);
    expect(lookup('2024-06-01')).toBe(190);
  });

  it('handles invalid dates by returning fallback', () => {
    const lookup = buildMaxHrLookup([reading('2024-01-10', 170)], 190);
    expect(lookup('not-a-date')).toBe(190);
  });
});

describe('computeHRZoneDistribution with per-date lookup', () => {
  const act = (date: string, avg_hr: number): Activity => ({
    id: 1, garmin_id: 'g', activity_type: 'running', date, title: '',
    distance_km: 10, duration_seconds: 3600, calories: 500,
    avg_hr, max_hr: null, training_effect: null, avg_cadence: null,
    avg_speed_kmh: null, tss: null, avg_power: null, max_power: null,
    elevation_gain: null, normalized_power: null, ftp: null,
  });

  it('classifies the same avg HR differently as max HR changes over time', () => {
    // avg HR 130: with maxHR 200 → 65% (Zone 2); with maxHR 160 → 81% (Zone 4)
    const maxHrFor = (date: string) => (date.startsWith('2020') ? 200 : 160);
    const zonesYoung = computeHRZoneDistribution([act('2020-06-01T08:00:00Z', 130)], maxHrFor);
    const zonesOld   = computeHRZoneDistribution([act('2024-06-01T08:00:00Z', 130)], maxHrFor);
    const top = (z: ReturnType<typeof computeHRZoneDistribution>) =>
      z.reduce((best, cur) => (cur.minutes > best.minutes ? cur : best));
    expect(top(zonesYoung).zone).toContain('Zone 2');
    expect(top(zonesOld).zone).toContain('Zone 4');
  });

  it('still accepts a plain number for maxHR', () => {
    const zones = computeHRZoneDistribution([act('2024-06-01T08:00:00Z', 130)], 200);
    expect(zones).toHaveLength(5);
    expect(zones.reduce((s, z) => s + z.minutes, 0)).toBeGreaterThan(0);
  });
});
