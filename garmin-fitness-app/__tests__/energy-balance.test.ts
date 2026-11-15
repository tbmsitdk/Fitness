import { describe, it, expect } from 'vitest';
import { describeNet, energyDays, energySummary, isBurnFinal } from '@/lib/energy-balance';
import type { NutritionLog } from '@/lib/nutrition';
import type { WellnessRecord } from '@/types';

const diary = (date: string, over: Partial<NutritionLog> = {}): NutritionLog => ({
  date, alcohol_units: null, candy_portions: null, savoury_snacks: null, sugary_drinks: null,
  last_food_time: null, caffeine_after_14: null, notes: null,
  from_meals: true, day_complete: true, kcal: 2000, ...over,
});

const wellness = (date: string, over: Partial<WellnessRecord> = {}): WellnessRecord => ({
  id: 1, date, steps: null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null,
  body_fat_pct: null, muscle_mass_kg: null, bone_mass_kg: null, body_water_pct: null, visceral_fat: null,
  metabolic_age: null, stress_score: null, body_battery: null, weight_kg: null, vo2max: null,
  fitness_age: null, flights_climbed: null, respiratory_rate: null, walking_asymmetry_pct: null,
  walking_speed: null, walking_double_support_pct: null, oxygen_saturation: null, mindful_minutes: null,
  ...over,
});

/** A burn figure synced at 04:00 UTC the morning after — the normal daily sync. */
const burned = (date: string, kcal: number, over: Partial<WellnessRecord> = {}) => {
  const next = new Date(`${date}T04:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  return wellness(`${date}T00:00:00.000Z`, { kcal_burned: kcal, active_kcal: kcal - 1700, resting_kcal: 1700, kcal_synced_at: next.toISOString(), ...over });
};

describe('isBurnFinal', () => {
  it('accepts a figure synced after the day ended', () => {
    expect(isBurnFinal(burned('2026-11-14', 2600))).toBe(true);
  });

  // The 04:00 sync also reads "today", when the watch has counted four hours.
  it('rejects a figure synced while the day was still running', () => {
    expect(isBurnFinal(wellness('2026-11-15', { kcal_burned: 310, kcal_synced_at: '2026-11-15T04:00:00Z' }))).toBe(false);
    expect(isBurnFinal(wellness('2026-11-15', { kcal_burned: 2400, kcal_synced_at: '2026-11-15T22:30:00Z' }))).toBe(false);
  });

  it('rejects a figure with no sync time, and a day with no figure', () => {
    expect(isBurnFinal(wellness('2026-11-14', { kcal_burned: 2600 }))).toBe(false);
    expect(isBurnFinal(wellness('2026-11-14', { kcal_synced_at: '2026-11-16T04:00:00Z' }))).toBe(false);
  });

  it('handles both date shapes', () => {
    const sync = '2026-11-15T04:00:00Z';
    expect(isBurnFinal(wellness('2026-11-14', { kcal_burned: 2600, kcal_synced_at: sync })))
      .toBe(isBurnFinal(wellness('2026-11-14T00:00:00.000Z', { kcal_burned: 2600, kcal_synced_at: sync })));
  });
});

describe('energyDays', () => {
  it('computes net as intake minus burned: negative is a deficit', () => {
    const [d] = energyDays([diary('2026-11-14', { kcal: 2100 })], [burned('2026-11-14', 2600)]);
    expect(d).toMatchObject({ date: '2026-11-14', intake: 2100, burned: 2600, net: -500, active: 900, resting: 1700 });
    const [s] = energyDays([diary('2026-11-14', { kcal: 3000 })], [burned('2026-11-14', 2600)]);
    expect(s.net).toBe(400);
  });

  // The failure this module exists to prevent: half a day against a whole one.
  it('gives no net when the diary day is not complete', () => {
    const [d] = energyDays([diary('2026-11-14', { day_complete: false, kcal: null })], [burned('2026-11-14', 2600)]);
    expect(d.intakeStatus).toBe('partial');
    expect(d.intake).toBeNull();
    expect(d.net).toBeNull();
    expect(d.burned).toBe(2600); // the burn is still shown
  });

  it('gives no net when the burn figure is from a day still running', () => {
    const today = wellness('2026-11-15', { kcal_burned: 310, kcal_synced_at: '2026-11-15T04:00:00Z' });
    const [d] = energyDays([diary('2026-11-15')], [today]);
    expect(d.burnStatus).toBe('partial');
    expect(d.burned).toBeNull();
    expect(d.net).toBeNull();
    expect(d.intake).toBe(2000);
  });

  it('gives no net when a complete day has no calorie total (an entry without an estimate)', () => {
    const [d] = energyDays([diary('2026-11-14', { kcal: null })], [burned('2026-11-14', 2600)]);
    expect(d.intakeStatus).toBe('partial');
    expect(d.net).toBeNull();
  });

  it('does not treat a hand-typed day as an intake day', () => {
    const rows = energyDays([diary('2026-11-14', { from_meals: false, kcal: undefined, alcohol_units: 2 })], []);
    expect(rows).toEqual([]);
  });

  it('lists days with only one side, newest first', () => {
    const rows = energyDays([diary('2026-11-13')], [burned('2026-11-14', 2600), burned('2026-11-12', 2500)]);
    expect(rows.map(r => [r.date, r.intakeStatus, r.burnStatus, r.net])).toEqual([
      ['2026-11-14', 'none', 'final', null],
      ['2026-11-13', 'complete', 'none', null],
      ['2026-11-12', 'none', 'final', null],
    ]);
  });
});

describe('energySummary', () => {
  const week = (net: number, days: number) => {
    const logs: NutritionLog[] = []; const well: WellnessRecord[] = [];
    for (let i = 1; i <= days; i++) {
      const date = `2026-11-${String(i).padStart(2, '0')}`;
      logs.push(diary(date, { kcal: 2500 + net })); well.push(burned(date, 2500));
    }
    return energyDays(logs, well);
  };

  it('averages only the days with both halves', () => {
    const rows = [
      ...energyDays([diary('2026-11-13', { kcal: 2000 }), diary('2026-11-14', { kcal: 2400 })], [burned('2026-11-13', 2500), burned('2026-11-14', 2500)]),
      ...energyDays([diary('2026-11-10', { day_complete: false, kcal: null })], [burned('2026-11-10', 9000)]),
    ];
    expect(energySummary(rows)).toMatchObject({ days: 2, avgIntake: 2200, avgBurned: 2500, avgNet: -300, totalNet: -600, deficitDays: 2, surplusDays: 0 });
  });

  it('states a weekly rate only with a week of days behind it', () => {
    expect(energySummary(week(-550, 6)).kgPerWeek).toBeNull();
    expect(energySummary(week(-550, 7)).kgPerWeek).toBe(-0.5);   // 550 x 7 / 7700
    expect(energySummary(week(1100, 10)).kgPerWeek).toBe(1);
  });

  it('is empty, not zero, with no whole days', () => {
    expect(energySummary([])).toMatchObject({ days: 0, avgNet: null, totalNet: null, kgPerWeek: null });
  });
});

describe('describeNet', () => {
  it('names the direction in words, so a sign is never the only cue', () => {
    expect(describeNet(-512.4)).toBe('512 kcal deficit');
    expect(describeNet(1340)).toBe('1,340 kcal surplus');
    expect(describeNet(0.3)).toBe('in balance');
  });
});
