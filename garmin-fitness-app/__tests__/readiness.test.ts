import { describe, it, expect } from 'vitest';
import { computeReadiness } from '@/lib/readiness';
import type { WellnessRecord } from '@/types';

function day(dateOffset: number, overrides: Partial<WellnessRecord> = {}): WellnessRecord {
  const d = new Date('2026-01-31T00:00:00Z');
  d.setDate(d.getDate() + dateOffset);
  return {
    id: dateOffset, date: d.toISOString().slice(0, 10),
    steps: null, resting_hr: 50, hrv_rmssd: 60, sleep_hours: 7.5, sleep_score: 80,
    body_fat_pct: null, muscle_mass_kg: null, bone_mass_kg: null, body_water_pct: null,
    visceral_fat: null, metabolic_age: null, stress_score: 25, body_battery: 70,
    weight_kg: null, vo2max: null, fitness_age: null, flights_climbed: null,
    respiratory_rate: null, walking_asymmetry_pct: null, walking_speed: null,
    walking_double_support_pct: null, oxygen_saturation: null, mindful_minutes: null,
    ...overrides,
  };
}

describe('computeReadiness', () => {
  it('returns null with fewer than 8 days of data', () => {
    const wellness = Array.from({ length: 7 }, (_, i) => day(i));
    expect(computeReadiness(wellness)).toBeNull();
  });

  it('scores a well-recovered day as Ready or Primed', () => {
    const baseline = Array.from({ length: 30 }, (_, i) => day(i));
    const today = day(30, { hrv_rmssd: 70, resting_hr: 45, sleep_score: 90, body_battery: 90 });
    const result = computeReadiness([...baseline, today]);
    expect(result).not.toBeNull();
    expect(result!.overall).toBeGreaterThanOrEqual(55);
  });

  it('scores a poorly-recovered day as Maintain or Rest', () => {
    const baseline = Array.from({ length: 30 }, (_, i) => day(i));
    const today = day(30, { hrv_rmssd: 30, resting_hr: 65, sleep_score: 40, body_battery: 20 });
    const result = computeReadiness([...baseline, today]);
    expect(result).not.toBeNull();
    expect(result!.overall).toBeLessThan(55);
  });

  it('falls back to 100 - stress_score when body_battery is missing', () => {
    const baseline = Array.from({ length: 30 }, (_, i) => day(i, { body_battery: null }));
    const today = day(30, { body_battery: null, stress_score: 20 });
    const result = computeReadiness([...baseline, today]);
    const batteryFactor = result!.factors.find(f => f.key === 'battery');
    expect(batteryFactor?.score).toBe(80); // 100 - 20
  });

  it('drops the HRV factor when fewer than 5 baseline readings are available (regression: a period-filtered wellness array must never be passed here)', () => {
    const fullBaseline = Array.from({ length: 30 }, (_, i) => day(i));
    // Same 30-day array length as a real "1M" period slice would have, but
    // only the last 2 days carry an HRV reading — simulating sparse data.
    const sparseBaseline = fullBaseline.map((w, i) => i < 28 ? { ...w, hrv_rmssd: null } : w);
    const today = day(30, { hrv_rmssd: 70, resting_hr: 45, sleep_score: 90, body_battery: 90 });
    const full = computeReadiness([...fullBaseline, today]);
    const sparse = computeReadiness([...sparseBaseline, today]);
    expect(full!.factors.map(f => f.key)).toContain('hrv');
    expect(sparse!.factors.map(f => f.key)).not.toContain('hrv');
  });
});
