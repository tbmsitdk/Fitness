import { describe, it, expect } from 'vitest';
import { computeCardioAge, rhrScore, bodyFatScore, hrvScore, activeMinutesScore } from '@/lib/cardio-age';

describe('rhrScore', () => {
  it('scores lower RHR higher', () => {
    expect(rhrScore(45)).toBe(100);
    expect(rhrScore(55)).toBe(80);
    expect(rhrScore(85)).toBe(20);
  });
});

describe('bodyFatScore', () => {
  it('rates a lean 57-year-old male as excellent', () => {
    expect(bodyFatScore(10, 57, 'male')).toBe(100); // age 40-59 band: excellent <= 11%
  });
  it('rates a higher body fat % lower for the same age/sex', () => {
    expect(bodyFatScore(32, 57, 'male')).toBeLessThan(bodyFatScore(20, 57, 'male'));
  });
});

describe('hrvScore', () => {
  it('scores above-expected HRV higher than 50', () => {
    expect(hrvScore(60, 57)).toBeGreaterThan(50); // expected ~48.5 at age 57
  });
  it('scores below-expected HRV lower than 50', () => {
    expect(hrvScore(20, 57)).toBeLessThan(50);
  });
  it('never exceeds the 0-100 range', () => {
    expect(hrvScore(500, 20)).toBeLessThanOrEqual(100);
    expect(hrvScore(0, 20)).toBeGreaterThanOrEqual(0);
  });
});

describe('activeMinutesScore', () => {
  it('rewards higher weekly volume', () => {
    expect(activeMinutesScore(350)).toBe(100);
    expect(activeMinutesScore(200)).toBe(70);
    expect(activeMinutesScore(100)).toBe(40);
    expect(activeMinutesScore(10)).toBe(20);
  });
});

describe('computeCardioAge', () => {
  it('includes only factors with available data', () => {
    const result = computeCardioAge({ age: 57, sex: 'male', weeklyActiveMinutes: 200 });
    // activity is always present; nothing else was supplied
    expect(result.factors.map(f => f.key)).toEqual(['activity']);
  });

  it('includes all 6 factors when all data is present', () => {
    const result = computeCardioAge({
      age: 57, sex: 'male',
      restingHr: 50, vo2max: 45, bodyFatPct: 15, hrvRmssd: 55,
      weeklyActiveMinutes: 250, sleepScore14dAvg: 80,
    });
    expect(result.factors).toHaveLength(6);
    expect(result.factors.map(f => f.key).sort()).toEqual(
      ['activity', 'bodyfat', 'hrv', 'rhr', 'sleep', 'vo2'].sort()
    );
  });

  it('produces a younger cardio age for strong biomarkers', () => {
    const strong = computeCardioAge({
      age: 57, sex: 'male',
      restingHr: 45, vo2max: 48, bodyFatPct: 10, hrvRmssd: 65,
      weeklyActiveMinutes: 400, sleepScore14dAvg: 90,
    });
    expect(strong.cardioAge).toBeLessThan(57);
  });

  it('produces an older cardio age for weak biomarkers', () => {
    const weak = computeCardioAge({
      age: 57, sex: 'male',
      restingHr: 85, vo2max: 25, bodyFatPct: 35, hrvRmssd: 15,
      weeklyActiveMinutes: 20, sleepScore14dAvg: 40,
    });
    expect(weak.cardioAge).toBeGreaterThan(57);
  });

  it('renormalizes weights so missing data does not silently default to neutral', () => {
    // Only VO2max supplied (weight 25) — composite should equal that factor's own score
    const result = computeCardioAge({ age: 57, sex: 'male', vo2max: 46, weeklyActiveMinutes: 0 });
    // activity always included too (weight 15) — verify composite is the weighted
    // blend of exactly those two, not diluted by phantom missing factors
    const activityFactor = result.factors.find(f => f.key === 'activity')!;
    const vo2Factor = result.factors.find(f => f.key === 'vo2')!;
    const expected = Math.round((vo2Factor.score * 25 + activityFactor.score * 15) / 40);
    expect(result.composite).toBe(expected);
  });
});
