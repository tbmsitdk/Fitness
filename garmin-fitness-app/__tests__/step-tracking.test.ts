import { describe, it, expect } from 'vitest';
import { stepTracking, MIN_DAYS_FOR_WEEK } from '@/lib/step-tracking';
import type { WellnessRecord } from '@/types';

// 2026-11-16 is a Monday.
const TODAY = '2026-11-16';
const GOAL = 8750;

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const row = (date: string, steps: number | null): WellnessRecord => ({
  id: 1, date, steps, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null,
  body_fat_pct: null, muscle_mass_kg: null, bone_mass_kg: null, body_water_pct: null, visceral_fat: null,
  metabolic_age: null, stress_score: null, body_battery: null, weight_kg: null, vo2max: null,
  fitness_age: null, flights_climbed: null, respiratory_rate: null, walking_asymmetry_pct: null,
  walking_speed: null, walking_double_support_pct: null, oxygen_saturation: null, mindful_minutes: null,
});
const days = (list: [number, number | null][], shape: 'iso' | 'bare' = 'iso') =>
  list.map(([back, steps]) => row(shape === 'iso' ? `${addDays(TODAY, -back)}T00:00:00.000Z` : addDays(TODAY, -back), steps));
const t = (w: WellnessRecord[]) => stepTracking({ wellness: w, goal: GOAL, today: TODAY });

describe('stepTracking — totals against the target', () => {
  const w = days([[1, 12_000], [2, 6_000], [3, 9_000], [4, 3_000]]);

  it('adds up days, average, hit rate and the best day', () => {
    const r = t(w);
    expect(r).toMatchObject({ days: 4, total: 30_000, avg: 7_500, hits: 2, hitRate: 50 });
    expect(r.best).toEqual({ date: addDays(TODAY, -1), steps: 12_000 });
    expect(r.median).toBe(7_500);
  });

  it('measures the total against what the goal would have added up to', () => {
    const r = t(w);
    expect(r.targetTotal).toBe(35_000);
    expect(r.vsTarget).toBe(-5_000);
    expect(r.vsTargetPct).toBe(86);
    expect(r.avgGap).toBe(-1_250);
  });

  it('never uses today', () => {
    const r = t([...w, row(`${TODAY}T00:00:00.000Z`, 940)]);
    expect(r.days).toBe(4);
    expect(r.to).toBe(addDays(TODAY, -1));
  });

  // Lesson 4
  it('leaves a day with no count out of every average, and reports the gap', () => {
    const r = t(days([[1, 9_000], [3, 9_000], [5, 9_000]]));
    expect(r.days).toBe(3);
    expect(r.avg).toBe(9_000);          // not dragged down by the two missing days
    expect(r.missing).toBe(2);          // days 2 and 4 sit between the first and last count
    expect(t(days([[1, 0], [2, null], [3, 250_000]])).days).toBe(0);
  });

  it('gives the same answer for bare dates and ISO timestamps', () => {
    const list: [number, number][] = [[1, 12_000], [2, 6_000], [9, 7_000], [40, 9_500]];
    expect(t(days(list, 'iso'))).toEqual(t(days(list, 'bare')));
  });

  it('is empty, not zero, with no counts', () => {
    const r = t([]);
    expect(r).toMatchObject({ days: 0, avg: null, hitRate: null, from: null, vsTargetPct: null, best: null });
  });
});

describe('stepTracking — streaks', () => {
  it('finds the current streak from yesterday and the longest in the period', () => {
    const r = t(days([[1, 9_000], [2, 9_000], [3, 5_000], [4, 9_000], [5, 9_000], [6, 9_000], [7, 9_000], [8, 5_000]]));
    expect(r.streak.current).toBe(2);
    expect(r.streak.longest).toEqual({ days: 4, end: addDays(TODAY, -4) });
  });

  it('does not bridge a day with no count', () => {
    const r = t(days([[1, 9_000], [2, 9_000], [4, 9_000], [5, 9_000]]));   // day 3 missing
    expect(r.streak.current).toBe(2);
    expect(r.streak.longest!.days).toBe(2);
  });

  it('has no longest streak when the goal was never reached', () => {
    expect(t(days([[1, 5_000], [2, 6_000]])).streak.longest).toBeNull();
  });
});

describe('stepTracking — weeks, months, weekdays', () => {
  // Four full weeks (Mon 2026-10-19 .. Sun 2026-11-15): weekdays 6,600, weekends 11,200.
  const month = Array.from({ length: 28 }, (_, i) => {
    const back = 28 - i;                                    // oldest first
    const day = addDays(TODAY, -back);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    return [back, dow === 0 || dow === 6 ? 11_200 : 6_600] as [number, number];
  });
  const r = t(days(month));

  it('groups by Monday-start weeks and averages over counted days', () => {
    expect(r.weeks).toHaveLength(4);
    expect(r.weeks[0].start).toBe('2026-10-19');
    expect(r.weeks.every(w => w.days === 7 && !w.partial)).toBe(true);
    expect(r.weeks[0]).toMatchObject({ avg: 7_914, hits: 2 }); // (5 x 6600 + 2 x 11200) / 7 = 7,914.3
  });

  // Lesson 2: a period that starts mid-week must not pass off a stub as a week.
  it('marks a short week as partial instead of treating it as a result', () => {
    const stub = t(days([[1, 9_000], [2, 9_000], [3, 9_000]]));
    expect(MIN_DAYS_FOR_WEEK).toBe(4);
    expect(stub.weeks.length).toBeGreaterThanOrEqual(1);
    expect(stub.weeks.some(w => w.partial)).toBe(true);
  });

  it('shows the weekday gap, Monday first', () => {
    expect(r.weekdays.map(w => w.name)[0]).toBe('Monday');
    expect(r.weekdays[0]).toMatchObject({ n: 4, mean: 6_600, hits: 0, hitRate: 0, gap: -2_150 });
    expect(r.weekdays[6]).toMatchObject({ name: 'Sunday', mean: 11_200, hitRate: 100, gap: 2_450 });
  });

  it('rolls days up by calendar month', () => {
    const m = t(days([[40, 9_000], [41, 8_000], [10, 10_000]])).months;
    expect(m.map(x => x.month)).toEqual(['2026-10', '2026-11']);
    expect(m[0]).toMatchObject({ days: 2, avg: 8_500, hits: 1, hitRate: 50 });
  });

  it('compares the last four weeks with the four before', () => {
    const rows = days(Array.from({ length: 56 }, (_, i) => [i + 1, i < 28 ? 6_000 : 9_000] as [number, number]));
    expect(t(rows).last4weeks).toMatchObject({ avg: 6_000, previousAvg: 9_000, change: -3_000 });
    expect(t(days([[1, 6_000], [2, 6_000]])).last4weeks.change).toBeNull();   // too thin to compare
  });
});

describe('stepTracking — bands', () => {
  it('sorts days into shares of the goal, with every day in exactly one band', () => {
    const r = t(days([[1, 3_000], [2, 5_000], [3, 7_500], [4, 8_750], [5, 10_000], [6, 12_000]]));
    expect(r.bands.map(b => b.n)).toEqual([1, 1, 1, 2, 1]);
    expect(r.bands.reduce((s, b) => s + b.n, 0)).toBe(r.days);
    expect(r.bands.filter(b => b.reachesGoal).reduce((s, b) => s + b.n, 0)).toBe(r.hits);
  });

  it('puts a day exactly at the goal in the reached band', () => {
    const r = t(days([[1, 8_750]]));
    expect(r.bands.find(b => b.n === 1)!.reachesGoal).toBe(true);
  });

  it('labels the bands in plain steps, with the real goal at the boundary', () => {
    const labels = t(days([[1, 9_000]])).bands.map(b => b.label);
    expect(labels[0]).toBe('Under 4,400');
    expect(labels[2]).toContain('to 8,750');
    expect(labels[3]).toContain('8,750 to');
  });
});
