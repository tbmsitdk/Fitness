import { describe, it, expect } from 'vitest';
import { getAge, getMaxHR, getThresholdHR, getBMI, DEFAULT_SETTINGS } from '@/lib/settings';

const base = { ...DEFAULT_SETTINGS };

describe('getAge', () => {
  it('calculates age from birthDate', () => {
    const s = { ...base, birthDate: '1985-01-01' };
    const age = getAge(s);
    expect(age).toBeGreaterThanOrEqual(39);
    expect(age).toBeLessThanOrEqual(41);
  });

  it('falls back to birthYear when birthDate is null', () => {
    const s = { ...base, birthDate: null, birthYear: 1990 };
    const age = getAge(s);
    expect(age).toBeGreaterThanOrEqual(34);
    expect(age).toBeLessThanOrEqual(36);
  });

  it('clamps to valid range', () => {
    expect(getAge({ ...base, birthDate: null, birthYear: new Date().getFullYear() - 5 })).toBe(20);
    expect(getAge({ ...base, birthDate: null, birthYear: new Date().getFullYear() - 200 })).toBe(100);
  });
});

describe('getMaxHR', () => {
  it('uses explicit maxHR when set', () => {
    expect(getMaxHR({ ...base, maxHR: 185 })).toBe(185);
  });

  it('ignores maxHR <= 100', () => {
    const s = { ...base, maxHR: 80, birthDate: null, birthYear: 1980 };
    const hr = getMaxHR(s);
    expect(hr).toBeGreaterThan(100);
  });

  it('calculates from age formula 220 - age', () => {
    const s = { ...base, maxHR: null, birthDate: null, birthYear: new Date().getFullYear() - 30 };
    expect(getMaxHR(s)).toBe(190); // 220 - 30
  });

  it('never returns below 150', () => {
    const s = { ...base, maxHR: null, birthDate: null, birthYear: new Date().getFullYear() - 80 };
    expect(getMaxHR(s)).toBeGreaterThanOrEqual(150);
  });
});

describe('getThresholdHR', () => {
  it('uses explicit thresholdHR when set', () => {
    expect(getThresholdHR({ ...base, thresholdHR: 162 })).toBe(162);
  });

  it('defaults to 85% of maxHR', () => {
    const s = { ...base, thresholdHR: null, maxHR: 190 };
    expect(getThresholdHR(s)).toBe(Math.round(190 * 0.85));
  });
});

describe('getBMI', () => {
  it('calculates BMI correctly', () => {
    expect(getBMI(80, 180)).toBeCloseTo(24.7, 0);
  });

  it('returns null when either value is missing', () => {
    expect(getBMI(null, 180)).toBeNull();
    expect(getBMI(80, null)).toBeNull();
  });
});
