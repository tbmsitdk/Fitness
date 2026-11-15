import { describe, it, expect } from 'vitest';
import { dayStatus, historyAverages, historyRows, trendPoints } from '@/lib/nutrition-history';
import type { NutritionLog } from '@/lib/nutrition';

const log = (date: string, over: Partial<NutritionLog> = {}): NutritionLog => ({
  date, alcohol_units: null, candy_portions: null, savoury_snacks: null, sugary_drinks: null,
  last_food_time: null, caffeine_after_14: null, notes: null, ...over,
});

const logs = [
  log('2026-11-12', { alcohol_units: 2 }),                                                                   // typed by hand
  log('2026-11-13T00:00:00.000Z', { from_meals: true, day_complete: true, meal_count: 4, kcal: 2200, protein_g: 110, fibre_g: 30, added_sugar_g: 20, alcohol_units: 0 }),
  log('2026-11-14', { from_meals: true, day_complete: false, meal_count: 2, kcal: null, alcohol_units: 2.5 }), // partial
  log('2026-11-15', { from_meals: true, day_complete: true, meal_count: 3, kcal: 1800, protein_g: 90, fibre_g: null, added_sugar_g: 40, alcohol_units: 0 }),
];

describe('dayStatus', () => {
  it('tells a confirmed diary day from a partial one and from a hand-typed one', () => {
    expect(logs.map(dayStatus)).toEqual(['by_hand', 'complete', 'partial', 'complete']);
  });
});

describe('historyRows', () => {
  it('lists logged days newest first, accepting both date shapes', () => {
    expect(historyRows(logs).map(r => r.date)).toEqual(['2026-11-15', '2026-11-14', '2026-11-13', '2026-11-12']);
  });

  // The point of the card: a partial day must never show up as a small total.
  it('shows totals only for complete days, even if a stale number is on the row', () => {
    const stale = [log('2026-11-14', { from_meals: true, day_complete: false, meal_count: 1, kcal: 450, protein_g: 20 })];
    const r = historyRows(stale)[0];
    expect(r.status).toBe('partial');
    expect(r.kcal).toBeNull();
    expect(r.protein_g).toBeNull();
    expect(r.meals).toBe(1);
  });

  it('keeps alcohol on every kind of day, and unknown as unknown', () => {
    const rows = historyRows(logs);
    expect(rows.find(r => r.date === '2026-11-14')!.alcohol_units).toBe(2.5);
    expect(rows.find(r => r.date === '2026-11-12')!.alcohol_units).toBe(2);
    expect(historyRows([log('2026-11-10', { candy_portions: 1 })])[0].alcohol_units).toBeNull();
  });
});

describe('historyAverages', () => {
  it('averages over the days that have a total, and says how many', () => {
    const avg = Object.fromEntries(historyAverages(historyRows(logs)).map(a => [a.key, a]));
    expect(avg.kcal).toMatchObject({ mean: 2000, n: 2 });   // not diluted by the partial or hand-typed days
    expect(avg.protein_g).toMatchObject({ mean: 100, n: 2 });
    expect(avg.fibre_g).toMatchObject({ mean: 30, n: 1 });  // one complete day had no fibre total
    expect(avg.carbs_g).toMatchObject({ mean: null, n: 0 });
  });
});

describe('trendPoints', () => {
  it('returns oldest-first points and leaves out days without the total', () => {
    expect(trendPoints(historyRows(logs), 'kcal')).toEqual([
      { date: '2026-11-13', value: 2200 }, { date: '2026-11-15', value: 1800 },
    ]);
    expect(trendPoints(historyRows(logs), 'fibre_g')).toEqual([{ date: '2026-11-13', value: 30 }]);
  });
});
