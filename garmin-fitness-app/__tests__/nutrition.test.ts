import { describe, it, expect } from 'vitest';
import {
  coerceNutritionLog, isCleanDay, hasAnyEntry, lastFoodMinutes,
  MEAL_QUALITY_LEVELS, NUTRITION_FIELDS, alcoholUnits, ALCOHOL_REFERENCE, type NutritionLog,
} from '@/lib/nutrition';
import {
  addDays, isWeekend, mean, stdDev, doseResponse, effectSize, rankEffects,
  weekendSplit, ALCOHOL_BUCKETS, OUTCOMES, MIN_BUCKET_N, STANDARD_EXPOSURES,
  type DayMetrics,
} from '@/lib/nutrition-analysis';

function log(o: Partial<NutritionLog> & { date: string }): NutritionLog {
  return {
    alcohol_units: null, candy_portions: null, savoury_snacks: null, sugary_drinks: null,
    last_food_time: null, caffeine_after_14: null, meal_quality: null, notes: null,
    ...o,
  };
}

function metrics(date: string, hrv: number): DayMetrics {
  return { date, hrv, restingHr: null, sleepHours: null, sleepScore: null,
           bodyBattery: null, stress: null, tss: null };
}

const HRV = OUTCOMES.find(o => o.key === 'hrv')!;

describe('field definitions', () => {
  it('defines every field it collects, with both counts and exclusions', () => {
    for (const f of NUTRITION_FIELDS) {
      expect(f.counts.length, f.key).toBeGreaterThan(0);
      expect(f.doesNotCount.length, f.key).toBeGreaterThan(0);
      expect(f.summary.length, f.key).toBeGreaterThan(10);
    }
  });

  it('anchors all five meal-quality levels to observable behaviour', () => {
    expect(MEAL_QUALITY_LEVELS).toHaveLength(5);
    for (const l of MEAL_QUALITY_LEVELS) {
      expect(l.description.length, `level ${l.value}`).toBeGreaterThan(40);
    }
    expect(MEAL_QUALITY_LEVELS.map(l => l.value)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('alcoholUnits', () => {
  it('matches the genstand definition — 12 g of ethanol is one unit', () => {
    // 4 cl of 40% spirits = 40 * 0.40 * 0.789 = 12.6 g -> 1 unit
    expect(alcoholUnits(40, 40)).toBe(1);
  });

  it('converts wine bottles at the strengths actually sold', () => {
    expect(alcoholUnits(750, 13)).toBe(6.5);   // 76.9 g
    expect(alcoholUnits(750, 14)).toBe(7);     // 82.9 g
    expect(alcoholUnits(750, 15)).toBe(7.5);   // 88.8 g
  });

  it('scales with volume, so a large beer is not one unit', () => {
    expect(alcoholUnits(500, 4.6)).toBe(1.5);
    expect(alcoholUnits(330, 4.6)).toBe(1);
  });

  it('rounds to half units — finer precision than recall would be false', () => {
    for (const u of [alcoholUnits(750, 13), alcoholUnits(330, 8), alcoholUnits(150, 14)]) {
      expect(u * 2).toBe(Math.round(u * 2));
    }
  });
});

describe('ALCOHOL_REFERENCE', () => {
  it('is computed from the formula, so the table cannot drift from it', () => {
    const bottle13 = ALCOHOL_REFERENCE.find(r => r.label.includes('75 cl bottle @ 13%'))!;
    expect(bottle13.units).toBe(alcoholUnits(750, 13));
  });

  it('covers the wine strengths actually on the shelf, not just 12%', () => {
    const wines = ALCOHOL_REFERENCE.filter(r => r.label.startsWith('Wine'));
    for (const abv of ['13%', '14%', '15%']) {
      expect(wines.some(w => w.label.includes(abv)), abv).toBe(true);
    }
  });
});

describe('logged zero vs unlogged day', () => {
  it('treats an explicit clean day as clean', () => {
    expect(isCleanDay(log({
      date: '2026-09-01',
      alcohol_units: 0, candy_portions: 0, savoury_snacks: 0, sugary_drinks: 0,
    }))).toBe(true);
  });

  it('does not treat an unlogged day as clean', () => {
    expect(isCleanDay(log({ date: '2026-09-01' }))).toBe(false);
  });

  it('counts crisps toward a clean day — they are tracked, just not as candy', () => {
    const noCrispsField = log({ date: '2026-09-01', alcohol_units: 0, candy_portions: 0, sugary_drinks: 0 });
    expect(isCleanDay(noCrispsField)).toBe(false); // savoury_snacks still unlogged
    expect(isCleanDay({ ...noCrispsField, savoury_snacks: 0 })).toBe(true);
  });

  it('recognises an empty draft so blank saves can be rejected', () => {
    expect(hasAnyEntry({})).toBe(false);
    expect(hasAnyEntry({ alcohol_units: 0 })).toBe(true);
    expect(hasAnyEntry({ caffeine_after_14: true })).toBe(true);
    expect(hasAnyEntry({ savoury_snacks: 2 })).toBe(true);
  });
});

describe('coerceNutritionLog', () => {
  it('converts DECIMAL strings to numbers', () => {
    const r = coerceNutritionLog({
      id: '3', date: '2026-09-01', alcohol_units: '2.5', candy_portions: '1.0',
      sugary_drinks: null, last_food_time: '21:30:00', caffeine_after_14: true,
      meal_quality: '4', notes: null,
    });
    expect(r.alcohol_units).toBe(2.5);
    expect(typeof r.alcohol_units).toBe('number');
    expect(r.last_food_time).toBe('21:30');
    expect(r.meal_quality).toBe(4);
  });

  it('keeps nulls as null rather than turning them into 0', () => {
    const r = coerceNutritionLog({ id: 1, date: '2026-09-01', alcohol_units: null });
    expect(r.alcohol_units).toBeNull();
  });
});

describe('lastFoodMinutes', () => {
  it('converts a clock time to minutes', () => {
    expect(lastFoodMinutes(log({ date: 'd', last_food_time: '20:30' }))).toBe(20 * 60 + 30);
  });

  it('treats after-midnight eating as late, not as early morning', () => {
    // 01:00 must sort above 22:00, not below 06:00
    const oneAm = lastFoodMinutes(log({ date: 'd', last_food_time: '01:00' }))!;
    const tenPm = lastFoodMinutes(log({ date: 'd', last_food_time: '22:00' }))!;
    expect(oneAm).toBeGreaterThan(tenPm);
  });

  it('returns null for missing or malformed times', () => {
    expect(lastFoodMinutes(log({ date: 'd' }))).toBeNull();
    expect(lastFoodMinutes(log({ date: 'd', last_food_time: '99:99' }))).toBeNull();
  });
});

describe('date helpers', () => {
  it('advances a date across a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('identifies weekends', () => {
    expect(isWeekend('2026-09-26')).toBe(true);  // Saturday
    expect(isWeekend('2026-09-27')).toBe(true);  // Sunday
    expect(isWeekend('2026-09-28')).toBe(false); // Monday
  });
});

describe('mean / stdDev', () => {
  it('averages', () => expect(mean([1, 2, 3])).toBe(2));
  it('returns null for an empty set', () => expect(mean([])).toBeNull());
  it('needs two points for a standard deviation', () => expect(stdDev([5])).toBeNull());
  it('is zero for identical values', () => expect(stdDev([4, 4, 4])).toBe(0));
});

describe('doseResponse', () => {
  it('measures the outcome the day AFTER the intake', () => {
    const logs = [log({ date: '2026-09-01', alcohol_units: 0 })];
    // Only the following day has a value; a same-day lookup would find nothing.
    const m = new Map([['2026-09-02', metrics('2026-09-02', 50)]]);
    const dr = doseResponse(logs, m, l => l.alcohol_units, ALCOHOL_BUCKETS, HRV);
    expect(dr.buckets[0].value).toBe(50);
    expect(dr.buckets[0].n).toBe(1);
  });

  it('skips unlogged days instead of counting them as zero intake', () => {
    const logs = [log({ date: '2026-09-01' })]; // alcohol never recorded
    const m = new Map([['2026-09-02', metrics('2026-09-02', 50)]]);
    const dr = doseResponse(logs, m, l => l.alcohol_units, ALCOHOL_BUCKETS, HRV);
    expect(dr.n).toBe(0);
    expect(dr.buckets[0].n).toBe(0);
  });

  it('separates intake into bands and reports each delta from the baseline', () => {
    const logs = [
      log({ date: '2026-09-01', alcohol_units: 0 }),
      log({ date: '2026-09-03', alcohol_units: 0 }),
      log({ date: '2026-09-05', alcohol_units: 4 }),
    ];
    const m = new Map([
      ['2026-09-02', metrics('2026-09-02', 50)],
      ['2026-09-04', metrics('2026-09-04', 52)],
      ['2026-09-06', metrics('2026-09-06', 40)],
    ]);
    const dr = doseResponse(logs, m, l => l.alcohol_units, ALCOHOL_BUCKETS, HRV);
    expect(dr.buckets[0].value).toBe(51);      // baseline mean of 50 and 52
    expect(dr.buckets[0].delta).toBeNull();    // baseline has no delta
    const heavy = dr.buckets.find(b => b.label === '3–4 units')!;
    expect(heavy.value).toBe(40);
    expect(heavy.delta).toBe(-11);
  });

  it('flags a thin bucket as unreliable', () => {
    const logs = [log({ date: '2026-09-01', alcohol_units: 4 })];
    const m = new Map([['2026-09-02', metrics('2026-09-02', 40)]]);
    const dr = doseResponse(logs, m, l => l.alcohol_units, ALCOHOL_BUCKETS, HRV);
    const heavy = dr.buckets.find(b => b.label === '3–4 units')!;
    expect(heavy.n).toBeLessThan(MIN_BUCKET_N);
    expect(heavy.unreliable).toBe(true);
  });

  it('ignores days whose following day has no recovery data', () => {
    const logs = [log({ date: '2026-09-01', alcohol_units: 0 })];
    const dr = doseResponse(logs, new Map(), l => l.alcohol_units, ALCOHOL_BUCKETS, HRV);
    expect(dr.n).toBe(0);
  });
});

describe('effectSize', () => {
  const logs = [
    log({ date: '2026-09-01', alcohol_units: 0 }),
    log({ date: '2026-09-03', alcohol_units: 0 }),
    log({ date: '2026-09-05', alcohol_units: 3 }),
    log({ date: '2026-09-07', alcohol_units: 3 }),
  ];
  const m = new Map([
    ['2026-09-02', metrics('2026-09-02', 50)],
    ['2026-09-04', metrics('2026-09-04', 54)],
    ['2026-09-06', metrics('2026-09-06', 42)],
    ['2026-09-08', metrics('2026-09-08', 38)],
  ]);

  it('reports the difference between exposed and baseline days', () => {
    const e = effectSize(logs, m, 'Any alcohol', l => l.alcohol_units! > 0, HRV);
    expect(e.delta).toBe(-12);           // mean 40 vs mean 52
    expect(e.nExposed).toBe(2);
    expect(e.nBaseline).toBe(2);
  });

  it('marks lower HRV as the worse direction', () => {
    const e = effectSize(logs, m, 'Any alcohol', l => l.alcohol_units! > 0, HRV);
    expect(e.worse).toBe(true);
  });

  it('computes Cohens d in pooled standard deviations', () => {
    const e = effectSize(logs, m, 'Any alcohol', l => l.alcohol_units! > 0, HRV);
    // Both groups have SD ~2.83, so a 12-unit gap is a very large d.
    expect(Math.abs(e.d!)).toBeGreaterThan(2);
  });

  it('skips days where the exposure was never recorded', () => {
    const e = effectSize(
      [log({ date: '2026-09-01' })], m, 'Any alcohol',
      l => (l.alcohol_units == null ? null : l.alcohol_units > 0), HRV,
    );
    expect(e.nExposed).toBe(0);
    expect(e.nBaseline).toBe(0);
    expect(e.delta).toBeNull();
  });

  it('flags small samples as unreliable', () => {
    const e = effectSize(logs, m, 'Any alcohol', l => l.alcohol_units! > 0, HRV);
    expect(e.unreliable).toBe(true); // 2 per side, under MIN_BUCKET_N
  });
});

describe('weekendSplit', () => {
  it('reports weekday and weekend effects separately', () => {
    const logs = [
      log({ date: '2026-09-28', alcohol_units: 0 }), // Monday
      log({ date: '2026-09-26', alcohol_units: 3 }), // Saturday
    ];
    const m = new Map([
      ['2026-09-29', metrics('2026-09-29', 50)],
      ['2026-09-27', metrics('2026-09-27', 40)],
    ]);
    const s = weekendSplit(logs, m, l => l.alcohol_units! > 0, HRV);
    // Each side only has one group, so neither can produce a difference —
    // exactly the honest answer for this data.
    expect(s.weekday.nBaseline).toBe(1);
    expect(s.weekend.nExposed).toBe(1);
  });
});

describe('rankEffects', () => {
  it('orders by absolute effect size and drops pairs it cannot compute', () => {
    const logs = [
      log({ date: '2026-09-01', alcohol_units: 0, candy_portions: 0 }),
      log({ date: '2026-09-03', alcohol_units: 0, candy_portions: 0 }),
      log({ date: '2026-09-05', alcohol_units: 4, candy_portions: 4 }),
      log({ date: '2026-09-07', alcohol_units: 4, candy_portions: 4 }),
    ];
    const m = new Map([
      ['2026-09-02', metrics('2026-09-02', 50)],
      ['2026-09-04', metrics('2026-09-04', 52)],
      ['2026-09-06', metrics('2026-09-06', 40)],
      ['2026-09-08', metrics('2026-09-08', 38)],
    ]);
    const ranked = rankEffects(logs, m, STANDARD_EXPOSURES);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every(e => e.d != null)).toBe(true);
    for (let i = 1; i < ranked.length; i++) {
      expect(Math.abs(ranked[i - 1].d!)).toBeGreaterThanOrEqual(Math.abs(ranked[i].d!));
    }
  });

  it('returns nothing when there is no data to compare', () => {
    expect(rankEffects([], new Map(), STANDARD_EXPOSURES)).toEqual([]);
  });
});
