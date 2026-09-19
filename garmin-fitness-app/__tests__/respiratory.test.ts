import { describe, it, expect } from 'vitest';
import {
  predictedVitalCapacity, predictedMIP, predictedMEP, percentOfPredicted, linearTrend,
} from '@/lib/respiratory';

describe('predictedVitalCapacity', () => {
  it('matches the ECCS/Quanjer equation for a 55yo male at 180cm', () => {
    // 5.76 * 1.80 - 0.026 * 55 - 4.34 = 10.368 - 1.43 - 4.34 = 4.598
    expect(predictedVitalCapacity(55, 'male', 180)).toBeCloseTo(4.6, 2);
  });

  it('predicts a lower capacity for a female of the same age and height', () => {
    const m = predictedVitalCapacity(55, 'male', 180)!;
    const f = predictedVitalCapacity(55, 'female', 180)!;
    expect(f).toBeLessThan(m);
  });

  it('falls with age and rises with height', () => {
    expect(predictedVitalCapacity(65, 'male', 180)!).toBeLessThan(predictedVitalCapacity(45, 'male', 180)!);
    expect(predictedVitalCapacity(55, 'male', 190)!).toBeGreaterThan(predictedVitalCapacity(55, 'male', 170)!);
  });

  it('returns null without a height rather than inventing one', () => {
    expect(predictedVitalCapacity(55, 'male', null)).toBeNull();
    expect(predictedVitalCapacity(55, 'male', 0)).toBeNull();
  });

  it('clamps rather than extrapolating to absurd ages', () => {
    expect(predictedVitalCapacity(120, 'male', 180)).toEqual(predictedVitalCapacity(80, 'male', 180));
  });
});

describe('predictedMIP / predictedMEP', () => {
  it('matches Black & Hyatt for a 55yo male', () => {
    expect(predictedMIP(55, 'male')).toBe(Math.round(143 - 0.55 * 55)); // 113
    expect(predictedMEP(55, 'male')).toBe(Math.round(268 - 1.03 * 55)); // 211
  });

  it('predicts lower pressures for females', () => {
    expect(predictedMIP(55, 'female')).toBeLessThan(predictedMIP(55, 'male'));
    expect(predictedMEP(55, 'female')).toBeLessThan(predictedMEP(55, 'male'));
  });

  it('declines with age', () => {
    expect(predictedMIP(70, 'male')).toBeLessThan(predictedMIP(30, 'male'));
  });

  it('never returns a negative pressure', () => {
    expect(predictedMEP(80, 'female')).toBeGreaterThanOrEqual(0);
  });
});

describe('percentOfPredicted', () => {
  it('expresses a reading as a percentage of its benchmark', () => {
    expect(percentOfPredicted(90, 113)).toBe(80);
  });

  it('returns null when either side is missing or the benchmark is zero', () => {
    expect(percentOfPredicted(null, 113)).toBeNull();
    expect(percentOfPredicted(90, null)).toBeNull();
    expect(percentOfPredicted(90, 0)).toBeNull();
  });
});

describe('linearTrend', () => {
  it('recovers a perfect straight line', () => {
    expect(linearTrend([1, 2, 3, 4], 2)).toEqual([1, 2, 3, 4]);
  });

  it('slopes upward for a rising series', () => {
    const t = linearTrend([3.1, 3.4, 3.3, 3.9], 2)!;
    expect(t[3]!).toBeGreaterThan(t[0]!);
  });

  it('is flat for a flat series', () => {
    expect(linearTrend([5, 5, 5, 5], 2)).toEqual([5, 5, 5, 5]);
  });

  it('refuses to imply a direction from fewer than 3 readings', () => {
    expect(linearTrend([1, 2], 2)).toEqual([null, null]);
  });

  it('ignores gaps but still returns a value at every index', () => {
    const t = linearTrend([1, null, 3, null, 5], 2);
    expect(t).toHaveLength(5);
    expect(t.every(v => v != null)).toBe(true);
    expect(t[4]).toBeCloseTo(5, 5);
  });

  it('honours the requested precision', () => {
    // litres need 2dp; pressures only 1
    expect(linearTrend([3.111, 3.222, 3.333], 2)![0]).toBe(3.11);
    expect(linearTrend([90.11, 91.22, 92.33], 1)![0]).toBe(90.11 > 0 ? 90.1 : 0);
  });
});
