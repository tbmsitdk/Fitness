import { describe, it, expect } from 'vitest';
import {
  coerceNutritionLog, hasAnyEntry, lastFoodMinutes,
  MEAL_QUALITY_LEVELS, NUTRITION_FIELDS, alcoholUnits, ALCOHOL_REFERENCE, type NutritionLog,
} from '@/lib/nutrition';
import {
  addDays, isWeekend, mean, stdDev, doseResponse, effectSize, rankEffects,
  weekendSplit, ALCOHOL_BUCKETS, CANDY_BUCKETS, OUTCOMES, MIN_BUCKET_N, STANDARD_EXPOSURES,
  availableOutcomes, stressStandsInForHrv, combinedImpact, stratifiedEffect,
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
           bodyBattery: null, stress: null };
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
  const metrics = new Map([['2026-09-02', {
    date: '2026-09-02', hrv: 50, restingHr: null, sleepHours: null,
    sleepScore: null, bodyBattery: null, stress: null, tss: null,
  }]]);

  it('counts an explicit 0 as a usable baseline day', () => {
    const dr = doseResponse(
      [log({ date: '2026-09-01', alcohol_units: 0 })],
      metrics, l => l.alcohol_units, ALCOHOL_BUCKETS, HRV,
    );
    expect(dr.buckets[0].n).toBe(1);
  });

  it('does not count a blank as a zero', () => {
    const dr = doseResponse(
      [log({ date: '2026-09-01' })],
      metrics, l => l.alcohol_units, ALCOHOL_BUCKETS, HRV,
    );
    expect(dr.buckets[0].n).toBe(0);
  });

  it('decides per field — a 0 for alcohol works even when candy is blank', () => {
    const day = [log({ date: '2026-09-01', alcohol_units: 0 })];  // candy never entered
    expect(doseResponse(day, metrics, l => l.alcohol_units, ALCOHOL_BUCKETS, HRV).buckets[0].n).toBe(1);
    expect(doseResponse(day, metrics, l => l.candy_portions, CANDY_BUCKETS, HRV).buckets[0].n).toBe(0);
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

describe('availableOutcomes', () => {
  const day = (over: Partial<DayMetrics>): DayMetrics => ({
    date: '2026-09-01', hrv: null, restingHr: null, sleepHours: null,
    sleepScore: null, bodyBattery: null, stress: null, ...over,
  });

  it('drops outcomes the device never records', () => {
    // A Vivosmart 5 exports no RMSSD, only a stress score.
    const m = new Map([['2026-09-01', day({ stress: 30, restingHr: 54 })]]);
    const keys = availableOutcomes(m).map(o => o.key);
    expect(keys).not.toContain('hrv');
    expect(keys).toContain('stress');
    expect(keys).toContain('restingHr');
  });

  it('keeps an outcome that has even one reading', () => {
    const m = new Map([
      ['2026-09-01', day({})],
      ['2026-09-02', day({ hrv: 50 })],
    ]);
    expect(availableOutcomes(m).map(o => o.key)).toContain('hrv');
  });

  it('returns nothing when there is no data at all', () => {
    expect(availableOutcomes(new Map())).toEqual([]);
  });

  it('detects when stress is standing in for HRV', () => {
    const noHrv = new Map([['2026-09-01', day({ stress: 30 })]]);
    const withHrv = new Map([['2026-09-01', day({ hrv: 50, stress: 30 })]]);
    expect(stressStandsInForHrv(noHrv)).toBe(true);
    expect(stressStandsInForHrv(withHrv)).toBe(false);
  });

  it('points every outcome in the right direction', () => {
    // Getting one of these backwards silently inverts every verdict the cards
    // draw, so each is asserted by name rather than by rule.
    const dir = Object.fromEntries(OUTCOMES.map(o => [o.key, o.higherIsBetter]));
    expect(dir.hrv).toBe(true);          // more heart-rate variability is better
    expect(dir.sleepScore).toBe(true);   // a higher sleep SCORE is better
    expect(dir.sleepHours).toBe(true);   // more sleep is better
    expect(dir.bodyBattery).toBe(true);  // more charge is better
    expect(dir.restingHr).toBe(false);   // a lower resting pulse is better
    expect(dir.stress).toBe(false);      // less stress is better
  });

  it('no longer offers next-day load — it records a choice, not an outcome', () => {
    expect(OUTCOMES.map(o => o.key)).not.toContain('tss');
  });

  it('never silently swaps stress in for HRV — they run opposite directions', () => {
    // Substituting one for the other would invert every conclusion, so the
    // directions must stay distinct.
    const hrv = OUTCOMES.find(o => o.key === 'hrv')!;
    const stress = OUTCOMES.find(o => o.key === 'stress')!;
    expect(hrv.higherIsBetter).toBe(true);
    expect(stress.higherIsBetter).toBe(false);
  });
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

describe('combinedImpact', () => {
  // Outcome day is always the day AFTER the log date.
  const m = (pairs: [string, number][]) => new Map(pairs.map(([d, hrv]) => [d, metrics(d, hrv)]));

  it('splits days four ways and measures each against clean days', () => {
    const logs = [
      log({ date: '2026-09-01', alcohol_units: 0, candy_portions: 0 }),  // neither
      log({ date: '2026-09-03', alcohol_units: 3, candy_portions: 0 }),  // alcohol only
      log({ date: '2026-09-05', alcohol_units: 0, candy_portions: 2 }),  // sugar only
      log({ date: '2026-09-07', alcohol_units: 3, candy_portions: 2 }),  // both
    ];
    const r = combinedImpact(logs, m([
      ['2026-09-02', 50], ['2026-09-04', 44], ['2026-09-06', 46], ['2026-09-08', 36],
    ]), HRV);

    expect(r.cells.neither.value).toBe(50);
    expect(r.cells.alcoholOnly.delta).toBe(-6);
    expect(r.cells.sugarOnly.delta).toBe(-4);
    expect(r.cells.both.delta).toBe(-14);
  });

  it('calls it compounding when the pair costs more than the parts added up', () => {
    const logs = [
      log({ date: '2026-09-01', alcohol_units: 0, candy_portions: 0 }),
      log({ date: '2026-09-03', alcohol_units: 3, candy_portions: 0 }),
      log({ date: '2026-09-05', alcohol_units: 0, candy_portions: 2 }),
      log({ date: '2026-09-07', alcohol_units: 3, candy_portions: 2 }),
    ];
    // -6 and -4 separately would predict -10; observed -14.
    const r = combinedImpact(logs, m([
      ['2026-09-02', 50], ['2026-09-04', 44], ['2026-09-06', 46], ['2026-09-08', 36],
    ]), HRV);
    expect(r.interaction).toBe(-4);
    expect(r.interactionLabel).toBe('compounding');
  });

  it('calls it additive when the pair costs what the parts predict', () => {
    const logs = [
      log({ date: '2026-09-01', alcohol_units: 0, candy_portions: 0 }),
      log({ date: '2026-09-03', alcohol_units: 3, candy_portions: 0 }),
      log({ date: '2026-09-05', alcohol_units: 0, candy_portions: 2 }),
      log({ date: '2026-09-07', alcohol_units: 3, candy_portions: 2 }),
    ];
    const r = combinedImpact(logs, m([
      ['2026-09-02', 50], ['2026-09-04', 44], ['2026-09-06', 46], ['2026-09-08', 40],
    ]), HRV);
    expect(r.interactionLabel).toBe('additive');
  });

  it('judges direction by the metric — a RISE in stress is the bad way', () => {
    const stress = OUTCOMES.find(o => o.key === 'stress')!;
    const withStress = (d: string, v: number): [string, DayMetrics] => [d, {
      date: d, hrv: null, restingHr: null, sleepHours: null, sleepScore: null,
      bodyBattery: null, stress: v,
    }];
    const logs = [
      log({ date: '2026-09-01', alcohol_units: 0, candy_portions: 0 }),
      log({ date: '2026-09-03', alcohol_units: 3, candy_portions: 0 }),
      log({ date: '2026-09-05', alcohol_units: 0, candy_portions: 2 }),
      log({ date: '2026-09-07', alcohol_units: 3, candy_portions: 2 }),
    ];
    // Stress RISES, and rising further than additive is compounding.
    const r = combinedImpact(logs, new Map([
      withStress('2026-09-02', 20), withStress('2026-09-04', 26),
      withStress('2026-09-06', 24), withStress('2026-09-08', 36),
    ]), stress);
    expect(r.cells.both.delta).toBe(16);          // worse
    expect(r.interactionLabel).toBe('compounding');
  });

  it('counts a day as sugar when only drinks were logged', () => {
    const logs = [log({ date: '2026-09-01', alcohol_units: 0, sugary_drinks: 2 })];
    const r = combinedImpact(logs, m([['2026-09-02', 40]]), HRV);
    expect(r.cells.sugarOnly.n).toBe(1);
  });

  it('refuses to place a day when only one of the two was recorded', () => {
    // Alcohol logged, sugar blank: could be "alcohol only" OR "both". Guessing
    // would move real "both" days into "alcohol only" and flatten the interaction.
    const logs = [log({ date: '2026-09-01', alcohol_units: 3 })];
    const r = combinedImpact(logs, m([['2026-09-02', 40]]), HRV);
    expect(r.cells.alcoholOnly.n).toBe(0);
    expect(r.cells.both.n).toBe(0);
    expect(r.unclassified).toBe(1);
  });

  it('does not report an interaction when a group is missing', () => {
    const logs = [
      log({ date: '2026-09-01', alcohol_units: 0, candy_portions: 0 }),
      log({ date: '2026-09-03', alcohol_units: 3, candy_portions: 0 }),
    ];
    const r = combinedImpact(logs, m([['2026-09-02', 50], ['2026-09-04', 44]]), HRV);
    expect(r.interaction).toBeNull();
    expect(r.interactionLabel).toBeNull();
    expect(r.unreliable).toBe(true);
  });

  it('treats crisps as neither — they are savoury, not sugar', () => {
    const logs = [log({ date: '2026-09-01', alcohol_units: 0, candy_portions: 0, savoury_snacks: 4 })];
    const r = combinedImpact(logs, m([['2026-09-02', 50]]), HRV);
    expect(r.cells.neither.n).toBe(1);
    expect(r.cells.sugarOnly.n).toBe(0);
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

describe('stratifiedEffect — the weekend confound', () => {
  const SLEEP = OUTCOMES.find(o => o.key === 'sleepHours')!;
  const night = (d: string, hours: number): [string, DayMetrics] => [d, {
    date: d, hrv: null, restingHr: null, sleepHours: hours, sleepScore: null,
    bodyBattery: null, stress: null,
  }];

  it('does not credit alcohol with the weekend lie-in', () => {
    // Drinking happens on Saturdays, which is also when the long sleeps happen.
    // Within each day type sleep is IDENTICAL, so the true effect is zero — but
    // a naive pooled comparison sees 9h drinking nights vs 7h sober ones.
    const logs = [
      // Saturdays, with alcohol -> 9h
      log({ date: '2026-09-05', alcohol_units: 3 }),
      log({ date: '2026-09-12', alcohol_units: 3 }),
      log({ date: '2026-09-19', alcohol_units: 3 }),
      // Saturdays, without -> also 9h
      log({ date: '2026-09-26', alcohol_units: 0 }),
      log({ date: '2026-10-03', alcohol_units: 0 }),
      // Weekdays, without -> 7h
      log({ date: '2026-09-07', alcohol_units: 0 }),
      log({ date: '2026-09-08', alcohol_units: 0 }),
      log({ date: '2026-09-09', alcohol_units: 0 }),
      // Weekdays, with -> also 7h
      log({ date: '2026-09-10', alcohol_units: 3 }),
      log({ date: '2026-09-11', alcohol_units: 3 }),
    ];
    const m = new Map([
      night('2026-09-06', 9), night('2026-09-13', 9), night('2026-09-20', 9),
      night('2026-09-27', 9), night('2026-10-04', 9),
      night('2026-09-08', 7), night('2026-09-09', 7), night('2026-09-10', 7),
      night('2026-09-11', 7), night('2026-09-12', 7),
    ]);
    const isDrinking = (l: typeof logs[number]) =>
      l.alcohol_units == null ? null : l.alcohol_units > 0;

    const naive = effectSize(logs, m, 'Any alcohol', isDrinking, SLEEP);
    const matched = stratifiedEffect(logs, m, 'Any alcohol', isDrinking, SLEEP);

    // Pooled, alcohol looks like it buys extra sleep purely from the mix of
    // day types; matched, the effect is exactly zero, which is the truth here.
    expect(naive.delta!).toBeGreaterThan(0.3);        // the confounded answer
    expect(matched.delta!).toBeCloseTo(0, 5);         // the honest one
    expect(matched.singleStratum).toBe(false);
  });

  it('flags an estimate that could only be made in one day type', () => {
    const logs = [
      log({ date: '2026-09-05', alcohol_units: 3 }),   // Saturday
      log({ date: '2026-09-12', alcohol_units: 0 }),   // Saturday
    ];
    const m = new Map([night('2026-09-06', 9), night('2026-09-13', 7)]);
    const r = stratifiedEffect(logs, m, 'Any alcohol',
      l => (l.alcohol_units == null ? null : l.alcohol_units > 0), SLEEP);
    expect(r.singleStratum).toBe(true);
    expect(r.weekdayDelta).toBeNull();
    // Still ranked: d falls back to the pooled estimate so the row survives.
    expect(r.delta).not.toBeNull();
  });

  it('keeps the real sample sizes — the estimate is stratified, not the data', () => {
    const logs = [
      log({ date: '2026-09-05', alcohol_units: 3 }),
      log({ date: '2026-09-07', alcohol_units: 3 }),
      log({ date: '2026-09-08', alcohol_units: 0 }),
      log({ date: '2026-09-12', alcohol_units: 0 }),
    ];
    const m = new Map([
      night('2026-09-06', 8), night('2026-09-08', 7),
      night('2026-09-09', 7), night('2026-09-13', 8),
    ]);
    const r = stratifiedEffect(logs, m, 'Any alcohol',
      l => (l.alcohol_units == null ? null : l.alcohol_units > 0), SLEEP);
    expect(r.nExposed + r.nBaseline).toBe(4);
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

// ── Regression tests backfilled for bugs that were fixed without one ────────
// Each of these shipped as a UI change; the logic is pulled out here so the
// bug cannot return silently. See tasks/lessons.md.

describe('worst-group selection', () => {
  // BUG: the tile sorted every group and took one end, so on a metric where
  // everything beat the baseline it reported the SMALLEST IMPROVEMENT as the
  // worst — sleep score +6.5 was labelled worst while +12.3 and +21.3 sat
  // above it.
  const worstOf = (
    groups: { label: string; delta: number | null }[],
    higherIsBetter: boolean,
  ) => {
    const isWorse = (d: number) => (higherIsBetter ? d < 0 : d > 0);
    const harmed = groups.filter(g => g.delta != null && isWorse(g.delta));
    return harmed.sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))[0] ?? null;
  };

  it('returns nothing when no group is actually worse than the baseline', () => {
    const groups = [
      { label: 'Alcohol only', delta: 12.3 },
      { label: 'Sugar only', delta: 21.3 },
      { label: 'Both', delta: 6.5 },
    ];
    expect(worstOf(groups, true)).toBeNull();
  });

  it('picks the biggest genuine harm, not the smallest gain', () => {
    const groups = [
      { label: 'Alcohol only', delta: -3 },
      { label: 'Sugar only', delta: 10 },
      { label: 'Both', delta: -9 },
    ];
    expect(worstOf(groups, true)!.label).toBe('Both');
  });

  it('reads direction from the metric — a RISE in stress is the harm', () => {
    const groups = [
      { label: 'Alcohol only', delta: 8 },
      { label: 'Sugar only', delta: -2 },
    ];
    expect(worstOf(groups, false)!.label).toBe('Alcohol only');
  });
});

describe('baseline labelling', () => {
  // BUG: every row with a null delta printed "baseline", so with no clean days
  // logged, Alcohol only / Sugar only / Both ALL claimed to be the baseline.
  const labelFor = (isBaselineRow: boolean, delta: number | null, hasBaseline: boolean) =>
    delta != null ? 'value' : isBaselineRow ? 'baseline' : hasBaseline ? '—' : 'no baseline';

  it('labels only the baseline row as the baseline', () => {
    expect(labelFor(true, null, true)).toBe('baseline');
  });

  it('says "no baseline" on other rows when none exists', () => {
    expect(labelFor(false, null, false)).toBe('no baseline');
  });

  it('never calls a non-baseline row the baseline', () => {
    for (const hasBaseline of [true, false]) {
      expect(labelFor(false, null, hasBaseline)).not.toBe('baseline');
    }
  });
});
