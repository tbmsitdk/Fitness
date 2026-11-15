import { describe, it, expect } from 'vitest';
import {
  adherence, cleanRule, dayCompliance, describeRule, experimentOutcomes, experimentsPromptSection,
  parseProposals, experimentAnalysisQuestion, type Experiment,
} from '@/lib/experiments';
import type { NutritionLog } from '@/lib/nutrition';
import type { WellnessRecord } from '@/types';

const log = (date: string, over: Partial<NutritionLog> = {}): NutritionLog => ({
  date, alcohol_units: null, candy_portions: null, savoury_snacks: null, sugary_drinks: null,
  last_food_time: null, caffeine_after_14: null, meal_quality: null, notes: null, ...over,
});

const wellness = (date: string, over: Partial<WellnessRecord>): WellnessRecord => ({
  id: 1, date, steps: null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null,
  body_fat_pct: null, muscle_mass_kg: null, bone_mass_kg: null, body_water_pct: null, visceral_fat: null,
  metabolic_age: null, stress_score: null, body_battery: null, weight_kg: null, vo2max: null,
  fitness_age: null, flights_climbed: null, respiratory_rate: null, walking_asymmetry_pct: null,
  walking_speed: null, walking_double_support_pct: null, oxygen_saturation: null, mindful_minutes: null,
  ...over,
});

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const isWeekendNight = (day: string) => [5, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());

// 2026-11-02 is a Monday.
const exp = (over: Partial<Experiment> = {}): Experiment => ({
  id: 1, title: 'Two dry weeks', hypothesis: 'Sleep score rises about 5 points.',
  rule: { type: 'max_per_day', field: 'alcohol_units', value: 0 },
  start_date: '2026-11-02', end_date: '2026-11-15', status: 'active', checkins: {}, created_at: '2026-11-01T00:00:00Z',
  ...over,
});

describe('dayCompliance', () => {
  const dry = { type: 'max_per_day', field: 'alcohol_units', value: 0 } as const;

  // Lesson 4: the whole point. An unlogged day must never count as a dry day.
  it('is UNKNOWN for a day with no log, or with the field left blank', () => {
    expect(dayCompliance(dry, undefined, undefined)).toBeNull();
    expect(dayCompliance(dry, log('2026-11-02', { candy_portions: 2 }), undefined)).toBeNull();
  });

  it('counts an entered 0 as kept and anything above the limit as broken', () => {
    expect(dayCompliance(dry, log('2026-11-02', { alcohol_units: 0 }), undefined)).toBe(true);
    expect(dayCompliance(dry, log('2026-11-02', { alcohol_units: 0.5 }), undefined)).toBe(false);
    expect(dayCompliance({ type: 'max_per_day', field: 'candy_portions', value: 1 }, log('x', { candy_portions: 1 }), undefined)).toBe(true);
  });

  it('judges last-food time, treating after-midnight eating as late', () => {
    const rule = { type: 'last_food_before', time: '19:30' } as const;
    expect(dayCompliance(rule, log('x', { last_food_time: '19:00' }), undefined)).toBe(true);
    expect(dayCompliance(rule, log('x', { last_food_time: '19:30' }), undefined)).toBe(true);
    expect(dayCompliance(rule, log('x', { last_food_time: '21:15' }), undefined)).toBe(false);
    expect(dayCompliance(rule, log('x', { last_food_time: '00:30' }), undefined)).toBe(false);
    expect(dayCompliance(rule, log('x'), undefined)).toBeNull();
  });

  it('judges late caffeine, and a blank is unknown rather than "none"', () => {
    const rule = { type: 'no_late_caffeine' } as const;
    expect(dayCompliance(rule, log('x', { caffeine_after_14: false }), undefined)).toBe(true);
    expect(dayCompliance(rule, log('x', { caffeine_after_14: true }), undefined)).toBe(false);
    expect(dayCompliance(rule, log('x'), undefined)).toBeNull();
  });

  it('uses the manual check-in for manual rules, ignoring the log', () => {
    const rule = { type: 'manual' } as const;
    expect(dayCompliance(rule, log('x', { alcohol_units: 9 }), true)).toBe(true);
    expect(dayCompliance(rule, undefined, false)).toBe(false);
    expect(dayCompliance(rule, undefined, undefined)).toBeNull();
  });
});

describe('adherence', () => {
  it('counts kept, broken and unknown days separately, up to today', () => {
    const logs = [
      log('2026-11-02', { alcohol_units: 0 }), log('2026-11-03', { alcohol_units: 0 }),
      log('2026-11-04', { alcohol_units: 2 }), log('2026-11-06T00:00:00.000Z', { alcohol_units: 0 }),
      log('2026-11-20', { alcohol_units: 0 }), // after the experiment: ignored
    ];
    const a = adherence(exp(), logs, '2026-11-06');
    expect(a).toMatchObject({ daysElapsed: 5, daysTotal: 14, kept: 3, broken: 1, unknown: 1, percent: 75 });
    expect(a.unknownDays).toEqual(['2026-11-05']);
  });

  it('has no percentage until something is logged — not 0%, not 100%', () => {
    const a = adherence(exp(), [], '2026-11-06');
    expect(a.percent).toBeNull();
    expect(a.unknown).toBe(5);
  });

  it('stops at the end date and handles an experiment that has not started', () => {
    expect(adherence(exp(), [], '2026-12-25').daysElapsed).toBe(14);
    expect(adherence(exp(), [], '2026-10-01')).toMatchObject({ daysElapsed: 0, unknown: 0, percent: null });
  });
});

describe('experimentOutcomes', () => {
  /** Mornings: sleep score = base, +weekendBonus after a weekend night, +effect during the experiment. */
  function build(effect: number, weekendBonus: number, shape: 'bare' | 'iso' = 'iso') {
    const rows: WellnessRecord[] = [];
    for (let night = '2026-10-05'; night <= '2026-11-15'; night = addDays(night, 1)) {
      const during = night >= '2026-11-02';
      const v = 70 + (isWeekendNight(night) ? weekendBonus : 0) + (during ? effect : 0) + (new Date(`${night}T12:00:00Z`).getUTCDate() % 3) - 1;
      const morning = addDays(night, 1);
      rows.push(wellness(shape === 'iso' ? `${morning}T00:00:00.000Z` : morning, { sleep_score: v, resting_hr: 50 - (during ? effect / 2 : 0) + (rows.length % 2) }));
    }
    return rows;
  }
  const sleep = (rows: WellnessRecord[], e = exp({ status: 'completed' })) =>
    experimentOutcomes(e, rows, '2026-11-20').find(o => o.key === 'sleep_score')!;

  it('reports a real improvement, with the change in the metric\'s own sign', () => {
    const o = sleep(build(6, 0));
    expect(o.verdict).toBe('better');
    expect(o.change).toBeCloseTo(6, 0);
    expect(o.nDuring).toBe(14);
  });

  // Lesson 3: lower resting HR is the improvement.
  it('reads a FALL in resting HR as better, and a rise as worse', () => {
    const better = experimentOutcomes(exp({ status: 'completed' }), build(6, 0), '2026-11-20').find(o => o.key === 'resting_hr')!;
    expect(better.change).toBeLessThan(0);
    expect(better.verdict).toBe('better');
    const worse = experimentOutcomes(exp({ status: 'completed' }), build(-6, 0), '2026-11-20').find(o => o.key === 'resting_hr')!;
    expect(worse.verdict).toBe('worse');
  });

  it('says "no clear change" when nothing changed', () => {
    expect(sleep(build(0, 0)).verdict).toBe('no clear change');
  });

  // Lesson 6: a one-week experiment covering one weekend, against a baseline
  // with two, must not be fooled by how good weekend sleep is.
  it('is not fooled by the weekday mix: a big weekend bonus and no real effect is no change', () => {
    const o = sleep(build(0, 15));
    expect(o.verdict).toBe('no clear change');
    expect(Math.abs(o.change!)).toBeLessThan(1.5);
  });

  it('says so when there is not enough data, instead of guessing a direction', () => {
    const o = sleep(build(6, 0).slice(0, 5));
    expect(o.verdict).toBe('not enough data');
    expect(o.change).toBeNull();
  });

  it('flags a comparison that could only be made on one kind of night', () => {
    const weekdaysOnly = build(6, 0).filter(r => !isWeekendNight(addDays(r.date.slice(0, 10), -1)));
    const o = sleep(weekdaysOnly);
    expect(o.verdict).toBe('better');
    expect(o.singleStratum).toBe(true);
  });

  it('only uses nights that have happened while the experiment is running', () => {
    const o = experimentOutcomes(exp(), build(6, 0), '2026-11-08').find(x => x.key === 'sleep_score')!;
    expect(o.nDuring).toBe(6); // nights of 2-7 Nov → mornings 3-8 Nov
  });

  it('gives the same answer for bare dates and ISO timestamps', () => {
    expect(sleep(build(6, 3, 'bare'))).toEqual(sleep(build(6, 3, 'iso')));
  });
});

describe('cleanRule', () => {
  it('accepts the four rule types and rejects everything else', () => {
    expect(cleanRule({ type: 'max_per_day', field: 'alcohol_units', value: 0 })).toEqual({ type: 'max_per_day', field: 'alcohol_units', value: 0 });
    expect(cleanRule({ type: 'last_food_before', time: '19:30' })).toEqual({ type: 'last_food_before', time: '19:30' });
    expect(cleanRule({ type: 'no_late_caffeine', field: 'none' })).toEqual({ type: 'no_late_caffeine' });
    expect(cleanRule({ type: 'manual' })).toEqual({ type: 'manual' });
    for (const bad of [
      null, 'x', {}, { type: 'drop_table' }, { type: 'max_per_day', field: 'weight_kg', value: 0 },
      { type: 'max_per_day', field: 'alcohol_units', value: -1 }, { type: 'max_per_day', field: 'alcohol_units', value: 'lots' },
      { type: 'last_food_before', time: '25:00' }, { type: 'last_food_before', time: '7pm' },
    ]) expect(cleanRule(bad), JSON.stringify(bad)).toBeNull();
  });

  it('describes rules in plain words', () => {
    expect(describeRule({ type: 'max_per_day', field: 'alcohol_units', value: 0 })).toBe('No alcohol units');
    expect(describeRule({ type: 'max_per_day', field: 'candy_portions', value: 1 })).toBe('At most 1 candy portions a day');
  });
});

describe('parseProposals', () => {
  const p = (over: Record<string, unknown> = {}) => ({
    title: 'Two dry weeks', hypothesis: 'h', why: 'w', rule_type: 'max_per_day', rule_field: 'alcohol_units',
    rule_value: 0, rule_time: '', duration_days: 14, ...over,
  });

  it('keeps valid proposals and drops ones whose rule cannot be checked', () => {
    const out = parseProposals(JSON.stringify({ proposals: [p(), p({ rule_field: 'none' }), p({ title: '  ' }), p({ rule_type: 'no_late_caffeine', rule_field: 'none' })] }));
    expect(out.map(x => x.rule.type)).toEqual(['max_per_day', 'no_late_caffeine']);
  });

  it('clamps the duration', () => {
    const out = parseProposals(JSON.stringify({ proposals: [p({ duration_days: 2 }), p({ duration_days: 500 })] }));
    expect(out.map(x => x.duration_days)).toEqual([7, 60]);
  });

  it('throws on a reply that is not JSON', () => {
    expect(() => parseProposals('Try drinking less.')).toThrow(/not JSON/);
  });
});

describe('prompt helpers', () => {
  it('summarises an active experiment for the coach, including unlogged days', () => {
    const e = exp();
    const s = experimentsPromptSection([{ exp: e, adherence: adherence(e, [log('2026-11-02', { alcohol_units: 0 })], '2026-11-04') }], '2026-11-04');
    expect(s).toContain('"Two dry weeks"');
    expect(s).toContain('day 3 of 14');
    expect(s).toContain('rule kept on 1 of 1 logged days');
    expect(s).toContain('2 days not logged');
  });

  it('is empty when there is nothing to say', () => {
    expect(experimentsPromptSection([], '2026-11-04')).toBe('');
    const e = exp({ status: 'abandoned' });
    expect(experimentsPromptSection([{ exp: e, adherence: adherence(e, [], '2026-11-04') }], '2026-11-04')).toBe('');
  });

  it('builds a deep-analysis question within the length limit', () => {
    const q = experimentAnalysisQuestion(exp({ hypothesis: 'x'.repeat(900) }));
    expect(q.length).toBeLessThanOrEqual(600);
    expect(q).toContain('Two dry weeks');
  });
});
