import { describe, it, expect } from 'vitest';
import {
  DETAIL_EXPOSURES, MIN_DAYS_FOR_THIRDS, clock, detailComparisons, formatValue, netByDate, netExposure,
  thirdsBuckets, thirdsOf, valuesOf,
} from '@/lib/nutrition-detail';
import { doseResponse, rankEffects, OUTCOMES, type DayMetrics } from '@/lib/nutrition-analysis';
import type { NutritionLog } from '@/lib/nutrition';
import type { WellnessRecord } from '@/types';

const log = (date: string, over: Partial<NutritionLog> = {}): NutritionLog => ({
  date, alcohol_units: null, candy_portions: null, savoury_snacks: null, sugary_drinks: null,
  last_food_time: null, caffeine_after_14: null, notes: null, from_meals: true, day_complete: true, ...over,
});

const sugar = DETAIL_EXPOSURES.find(e => e.key === 'added_sugar_g')!;
const lastFood = DETAIL_EXPOSURES.find(e => e.key === 'last_food')!;

const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;

describe('thirdsOf', () => {
  it('needs nine days, so each third has three', () => {
    expect(thirdsOf([1, 2, 3, 4, 5, 6, 7, 8])).toBeNull();
    expect(MIN_DAYS_FOR_THIRDS).toBe(9);
    expect(thirdsOf([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual({ low: 3, high: 7, nLow: 3, nHigh: 3, n: 9 });
  });

  it('is not fooled by order', () => {
    expect(thirdsOf([9, 1, 8, 2, 7, 3, 6, 4, 5])).toEqual(thirdsOf([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  // A measure that is zero most days has no "highest third" that means anything.
  it('gives up when ties make the thirds indistinguishable', () => {
    expect(thirdsOf([0, 0, 0, 0, 0, 0, 0, 0, 5])).toBeNull();
    expect(thirdsOf(Array(12).fill(40))).toBeNull();
  });
});

describe('detailComparisons', () => {
  const logs = Array.from({ length: 12 }, (_, i) => log(day(i + 1), { added_sugar_g: (i + 1) * 5 })); // 5..60

  it('builds a labelled comparison with the real cut-offs in it', () => {
    const [c] = detailComparisons(logs, [sugar]);
    expect(c.thirds).toMatchObject({ low: 20, high: 45 });
    expect(c.label).toBe('Added sugar: 45 g or more (vs 20 g or less)');
  });

  it('tests true for the highest third, false for the lowest, and null for the middle', () => {
    const [c] = detailComparisons(logs, [sugar]);
    expect(c.test(log(day(1), { added_sugar_g: 60 }))).toBe(true);
    expect(c.test(log(day(1), { added_sugar_g: 5 }))).toBe(false);
    expect(c.test(log(day(1), { added_sugar_g: 30 }))).toBeNull();
  });

  // The whole point of reading the diary totals: a partial day is not a low day.
  it('leaves a day with no total out, never treating it as low', () => {
    const withPartial = [...logs, log(day(20), { day_complete: false, added_sugar_g: null })];
    const [c] = detailComparisons(withPartial, [sugar]);
    expect(c.test(withPartial[withPartial.length - 1])).toBeNull();
    expect(c.thirds.n).toBe(12);
  });

  it('skips a measure that has too few days, and keeps the others', () => {
    const mixed = logs.map((l, i) => i < 3 ? { ...l, kcal: 2000 + i * 100 } : l);
    const out = detailComparisons(mixed, DETAIL_EXPOSURES);
    expect(out.map(c => c.exposure.key)).toEqual(['added_sugar_g']);
  });
});

describe('last food', () => {
  it('counts after-midnight eating as later than 23:59', () => {
    expect(lastFood.of(log(day(1), { last_food_time: '00:30' }))).toBeGreaterThan(lastFood.of(log(day(1), { last_food_time: '23:30' }))!);
    expect(lastFood.of(log(day(1)))).toBeNull();
  });

  it('prints a clock time, including past midnight', () => {
    expect(clock(1470)).toBe('00:30');
    expect(clock(21 * 60 + 5)).toBe('21:05');
    expect(formatValue(lastFood, 20 * 60 + 15)).toBe('20:15');
    expect(formatValue(sugar, 45.2)).toBe('45 g');
  });
});

describe('net calories as an exposure', () => {
  const well = (date: string, kcal: number, synced: string): WellnessRecord => ({
    id: 1, date, steps: null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null,
    body_fat_pct: null, muscle_mass_kg: null, bone_mass_kg: null, body_water_pct: null, visceral_fat: null,
    metabolic_age: null, stress_score: null, body_battery: null, weight_kg: null, vo2max: null,
    fitness_age: null, flights_climbed: null, respiratory_rate: null, walking_asymmetry_pct: null,
    walking_speed: null, walking_double_support_pct: null, oxygen_saturation: null, mindful_minutes: null,
    kcal_burned: kcal, kcal_synced_at: synced,
  });

  it('uses only days with a complete diary and a final burn figure', () => {
    const logs = [log('2026-10-01', { kcal: 2000 }), log('2026-10-02', { kcal: 2400 }), log('2026-10-03', { kcal: 1800, day_complete: false })];
    const w = [
      well('2026-10-01T00:00:00.000Z', 2600, '2026-10-02T04:00:00Z'),
      well('2026-10-02T00:00:00.000Z', 2600, '2026-10-02T04:00:00Z'), // synced mid-day: partial
      well('2026-10-03T00:00:00.000Z', 2600, '2026-10-04T04:00:00Z'),
    ];
    const net = netByDate(logs, w);
    expect([...net.entries()]).toEqual([['2026-10-01', -600]]);
    expect(netExposure(net).of(logs[0])).toBe(-600);
    expect(netExposure(net).of(logs[1])).toBeNull();
    expect(netExposure(net).format!(-600)).toBe('−600 kcal');
    expect(netExposure(net).format!(350)).toBe('+350 kcal');
  });
});

describe('the comparison finds a real effect, in the right direction', () => {
  // 18 complete days; sleep the next morning falls as added sugar rises.
  const logs = Array.from({ length: 18 }, (_, i) => log(day(i + 1), { added_sugar_g: 10 + i * 4 })); // 10..78
  const metrics = new Map<string, DayMetrics>();
  logs.forEach((l, i) => {
    const next = `2026-10-${String(i + 2).padStart(2, '0')}`;
    metrics.set(next, { date: next, hrv: null, restingHr: 50 + i * 0.4, sleepHours: 7.5, sleepScore: 85 - i, bodyBattery: 60, stress: 25 });
  });

  it('ranks added sugar against next-morning sleep score, and calls it worse', () => {
    const comparisons = detailComparisons(logs, DETAIL_EXPOSURES);
    expect(comparisons.map(c => c.exposure.key)).toEqual(['added_sugar_g']);
    const ranked = rankEffects(logs, metrics, comparisons, OUTCOMES);
    const sleep = ranked.find(e => e.outcome.key === 'sleepScore')!;
    expect(sleep.exposureLabel).toMatch(/^Added sugar: /);
    expect(sleep.delta!).toBeLessThan(-8);     // the high-sugar days slept clearly worse
    expect(sleep.worse).toBe(true);            // lower is the unfavourable way for sleep score
    expect(sleep.nExposed).toBeGreaterThanOrEqual(5);
    const rhr = ranked.find(e => e.outcome.key === 'restingHr')!;
    expect(rhr.delta!).toBeGreaterThan(0);     // resting HR rose…
    expect(rhr.worse).toBe(true);              // …and for that metric rising is the bad way
  });

  it('shows the dose-response from lowest to highest third', () => {
    const [c] = detailComparisons(logs, [sugar]);
    const dr = doseResponse(logs, metrics, sugar.of, thirdsBuckets(c.thirds), OUTCOMES.find(o => o.key === 'sleepScore')!);
    expect(dr.buckets.map(b => b.label)).toEqual(['Lowest third', 'Middle third', 'Highest third']);
    expect(dr.buckets.map(b => b.n)).toEqual([6, 6, 6]);
    expect(dr.buckets[0].delta).toBeNull();                       // the baseline
    expect(dr.buckets[1].delta!).toBeLessThan(0);
    expect(dr.buckets[2].delta!).toBeLessThan(dr.buckets[1].delta!); // dose-response: more sugar, worse sleep
  });

  it('every complete day lands in exactly one bucket, including values equal to a cut-off', () => {
    const [c] = detailComparisons(logs, [sugar]);
    const [lo, mid, hi] = thirdsBuckets(c.thirds);
    for (const v of valuesOf(logs, sugar)) {
      const hits = [lo, mid, hi].filter(b => v >= b.min && v <= b.max).length;
      expect(hits, `value ${v}`).toBeGreaterThanOrEqual(1);
    }
    expect(mid.min).toBeGreaterThan(lo.max);
    expect(hi.min).toBeGreaterThan(mid.max);
  });
});
