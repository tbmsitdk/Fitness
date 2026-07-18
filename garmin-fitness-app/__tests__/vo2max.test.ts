import { describe, it, expect } from 'vitest';
import { vo2maxRating } from '@/lib/vo2max';

describe('vo2maxRating', () => {
  it('rates 40.3 as Excellent for a 57-year-old male (the reported inconsistency)', () => {
    const r = vo2maxRating(40.3, 57, 'male');
    expect(r.category).toBe('Excellent');
    expect(r.percentile).toBeGreaterThanOrEqual(70);
    expect(r.percentile).toBeLessThan(90);
  });

  it('the same 40.3 is only Good for a 40-year-old male (age-adjusted)', () => {
    const r = vo2maxRating(40.3, 40, 'male');
    expect(r.category).toBe('Good');
  });

  it('uses female bands', () => {
    expect(vo2maxRating(33, 55, 'female').category).toBe('Excellent');
    expect(vo2maxRating(33, 55, 'male').category).toBe('Fair');
  });

  it('caps percentile below 100 and above 0', () => {
    expect(vo2maxRating(70, 57, 'male').percentile).toBeLessThanOrEqual(99);
    expect(vo2maxRating(10, 57, 'male').percentile).toBeGreaterThanOrEqual(5);
  });

  it('score bands match LongevityScore weights', () => {
    expect(vo2maxRating(46, 57, 'male').score).toBe(100); // Superior
    expect(vo2maxRating(41, 57, 'male').score).toBe(80);  // Excellent
    expect(vo2maxRating(36, 57, 'male').score).toBe(60);  // Good
    expect(vo2maxRating(32, 57, 'male').score).toBe(40);  // Fair
    expect(vo2maxRating(25, 57, 'male').score).toBe(20);  // Poor
  });
});
