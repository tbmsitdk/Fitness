import { describe, it, expect } from 'vitest';
import { QUICK_LOG_SCHEMA, QUICK_LOG_SYSTEM, buildQuickLogPrompt, resolveQuickLog, unitsFor } from '@/lib/quick-log';
import { alcoholUnits } from '@/lib/nutrition';

const TODAY = '2026-11-15';

const meal = (over: Record<string, unknown> = {}) => ({
  date: TODAY, time: '19:30', description: 'Pasta bolognese', kcal: 650, protein_g: 32, carbs_g: 70, added_sugar_g: 4,
  fat_g: 24, fibre_g: 7, veg_fruit_portions: 1, ultra_processed: false, drinks: [], candy_portions: 0,
  savoury_snacks: 0, sugary_drinks: 0, caffeine: false, drink_only: false, ...over,
});
const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ understood: 'ok', questions: [], meals: [], day_statements: [], exercises: [], trips: [], ...over });
const resolve = (over: Record<string, unknown>) => resolveQuickLog(reply(over), TODAY);

describe('unitsFor', () => {
  it('matches the form\'s own arithmetic for a single drink', () => {
    expect(unitsFor([{ volume_ml: 750, abv_percent: 14, count: 1 }])).toBe(alcoholUnits(750, 14));
    expect(unitsFor([{ volume_ml: 330, abv_percent: 4.6, count: 1 }])).toBe(alcoholUnits(330, 4.6));
  });

  it('adds drinks before rounding, to the nearest half unit', () => {
    // 2 x 150 ml @ 13% = 30.8 g = 2.56 units → 2.5
    expect(unitsFor([{ volume_ml: 150, abv_percent: 13, count: 2 }])).toBe(2.5);
    expect(unitsFor([])).toBe(0);
  });
});

describe('resolveQuickLog — meals', () => {
  it('turns a meal into a diary entry with its estimates', () => {
    const p = resolve({ meals: [meal()] });
    expect(p.days).toHaveLength(1);
    const m = p.days[0].meals[0];
    expect(m).toMatchObject({ date: TODAY, time: '19:30', description: 'Pasta bolognese', kcal: 650, protein_g: 32, alcohol_g: 0, source: 'text' });
    expect(p.days[0].lines[0]).toBe('19:30 Pasta bolognese — ~650 kcal, 32 g protein, 4 g added sugar, 7 g fibre');
    expect(p.days[0].noAlcohol).toBe(false);
    expect(p.days[0].complete).toBe(false);
  });

  it('computes the alcohol in code from volume and strength', () => {
    const p = resolve({ meals: [meal({ description: '2 glasses of red', drink_only: true, kcal: 250, drinks: [{ description: 'red wine', volume_ml: 150, abv_percent: 13, count: 2 }] })] });
    expect(p.days[0].meals[0].alcohol_g).toBe(30.8);
    expect(p.days[0].lines[0]).toContain('2.5 alcohol units');
  });

  // Lesson 4: the model is never allowed to decide that a day had none of something.
  it('marks a day alcohol-free or complete ONLY when the person said so', () => {
    const silent = resolve({ meals: [meal()] });
    expect(silent.days[0].noAlcohol).toBe(false);
    expect(silent.days[0].complete).toBe(false);
    const said = resolve({ meals: [meal()], day_statements: [{ date: TODAY, no_alcohol: true, day_complete: true }] });
    expect(said.days[0].noAlcohol).toBe(true);
    expect(said.days[0].complete).toBe(true);
  });

  it('accepts a statement on its own, with no meal', () => {
    const p = resolve({ day_statements: [{ date: TODAY, no_alcohol: true, day_complete: false }] });
    expect(p.days).toEqual([{ date: TODAY, meals: [], lines: [], noAlcohol: true, complete: false }]);
    expect(resolve({ day_statements: [{ date: TODAY, no_alcohol: false, day_complete: false }] }).days).toEqual([]);
  });

  it('asks instead of guessing when "no alcohol" comes with a drink', () => {
    const p = resolve({
      meals: [meal({ drinks: [{ description: 'beer', volume_ml: 330, abv_percent: 4.6, count: 1 }] })],
      day_statements: [{ date: TODAY, no_alcohol: true, day_complete: false }],
    });
    expect(p.days[0].noAlcohol).toBe(false);
    expect(p.questions.join(' ')).toMatch(/no alcohol .* but also listed a drink/);
  });

  it('keeps an impossible estimate as unknown rather than zero, and ignores impossible drinks', () => {
    const p = resolve({ meals: [meal({ kcal: -50, protein_g: 'lots', time: '7pm', drinks: [{ description: 'x', volume_ml: -5, abv_percent: 13, count: 1 }, { description: 'y', volume_ml: 100, abv_percent: 400, count: 1 }] })] });
    const m = p.days[0].meals[0];
    expect(m.kcal).toBeNull();
    expect(m.protein_g).toBeNull();
    expect(m.time).toBeNull();
    expect(m.alcohol_g).toBe(0);
  });

  it('refuses dates in the future or too far back, and asks instead', () => {
    const p = resolve({ meals: [meal({ date: '2026-11-16' }), meal({ date: '2025-01-01' }), meal({ date: 'yesterday' })] });
    expect(p.days).toEqual([]);
    expect(p.questions).toHaveLength(3);
  });

  it('groups several meals by day, in date order, and marks photo entries', () => {
    const p = resolveQuickLog(reply({ meals: [meal(), meal({ date: '2026-11-14', description: 'Late kebab', time: '00:30' }), meal({ description: 'Lunch', time: '12:00' })] }), TODAY, 'photo');
    expect(p.days.map(d => [d.date, d.meals.length])).toEqual([['2026-11-14', 1], [TODAY, 2]]);
    expect(p.days[1].meals[0].source).toBe('photo');
  });

  it('drops an entry with no description', () => {
    expect(resolve({ meals: [meal({ description: '  ' })] }).days).toEqual([]);
  });
});

describe('resolveQuickLog — exercises', () => {
  const ex = (over: Record<string, unknown> = {}) => ({
    date: TODAY, exercise_key: 'dead_hang', sets: null, reps: null, duration_seconds: null, load_kg: null,
    vital_capacity_l: null, inspiratory_strength: null, expiratory_strength: null, ...over,
  });

  it('groups entries by day in the shape the exercise API takes', () => {
    const p = resolve({ exercises: [ex({ sets: 2, duration_seconds: 20 }), ex({ exercise_key: 'grip_strength_press', load_kg: 10, reps: 100 })] });
    expect(p.exercises).toHaveLength(1);
    expect(p.exercises[0].entries).toEqual([
      { exercise_key: 'dead_hang', sets: 2, duration_seconds: 20 },
      { exercise_key: 'grip_strength_press', reps: 100, load_kg: 10 },
    ]);
    expect(p.exercises[0].lines[0]).toBe('Dead hang: 2 sets, 20 s');
  });

  it('drops unknown exercises, and asks when only a set count was given', () => {
    const p = resolve({ exercises: [ex({ exercise_key: 'bench_press', load_kg: 80 }), ex({ sets: 3 })] });
    expect(p.exercises).toEqual([]);
    expect(p.questions).toEqual(['How long or how much for Dead hang?']);
  });
});

describe('resolveQuickLog — trips', () => {
  const trip = (over: Record<string, unknown> = {}) => ({
    depart_date: '2026-11-02', return_date: '2026-11-08', travel_mode: 'flight', purpose: 'work',
    stops: [
      { destination: 'Delhi', timezone: 'Asia/Kolkata', arrive_date: '2026-11-03' },
      { destination: 'Singapore', timezone: 'Asia/Singapore', arrive_date: '2026-11-05' },
    ],
    ...over,
  });

  it('keeps every stop and computes the offsets in code, for the dates travelled', () => {
    const p = resolve({ trips: [trip()] });
    const body = p.trips[0].payload;
    expect(body.destination).toBe('Delhi');
    expect(body.home_utc_offset).toBe(1);     // Copenhagen in November: CET
    expect(body.dest_utc_offset).toBe(5.5);
    expect(body.dest_timezone).toBe('Asia/Kolkata');
    expect(body.stops).toHaveLength(2);
    expect(p.trips[0].line).toContain('Delhi (from 2026-11-03) → Singapore (from 2026-11-05)');
  });

  // Lesson 5: DST per zone, on the date itself.
  it('uses summer time for a summer trip', () => {
    const p = resolve({ trips: [trip({ depart_date: '2026-07-01', return_date: '2026-07-05', stops: [{ destination: 'New York', timezone: 'America/New_York', arrive_date: '2026-07-01' }] })] });
    expect(p.trips[0].payload.home_utc_offset).toBe(2);
    expect(p.trips[0].payload.dest_utc_offset).toBe(-4);
  });

  it('rejects a time zone the runtime does not know, and asks', () => {
    const p = resolve({ trips: [trip({ stops: [{ destination: 'Atlantis', timezone: 'Atlantic/Atlantis', arrive_date: '2026-11-03' }] })] });
    expect(p.trips).toEqual([]);
    expect(p.questions.join(' ')).toMatch(/Atlantis/);
  });

  it('rejects stops out of order or outside the trip', () => {
    const backwards = trip({ stops: [{ destination: 'A', timezone: 'Asia/Kolkata', arrive_date: '2026-11-05' }, { destination: 'B', timezone: 'Asia/Singapore', arrive_date: '2026-11-03' }] });
    const before = trip({ stops: [{ destination: 'A', timezone: 'Asia/Kolkata', arrive_date: '2026-10-30' }] });
    expect(resolve({ trips: [backwards, before, trip({ stops: [] })] }).trips).toEqual([]);
  });

  it('leaves the return open and the purpose empty when they were not given', () => {
    const p = resolve({ trips: [trip({ return_date: '', purpose: 'not_mentioned' })] });
    expect(p.trips[0].payload.return_date).toBeNull();
    expect(p.trips[0].payload.purpose).toBeNull();
  });
});

describe('resolveQuickLog — the reply itself', () => {
  it('throws on a reply that is not JSON', () => {
    expect(() => resolveQuickLog('Logged 2 beers for you!', TODAY)).toThrow(/not JSON/);
  });

  it('survives a reply with missing sections', () => {
    const p = resolveQuickLog('{}', TODAY);
    expect(p).toEqual({ understood: '', questions: [], days: [], exercises: [], trips: [] });
  });
});

describe('prompt and schema', () => {
  it('tells the model never to infer "none", and carries the form\'s own definitions', () => {
    expect(QUICK_LOG_SYSTEM).toMatch(/not mentioned and none are different facts/);
    expect(QUICK_LOG_SYSTEM).toContain('dead_hang = Dead hang');
    expect(QUICK_LOG_SYSTEM).toMatch(/Does not count:/);
    expect(QUICK_LOG_SYSTEM).not.toMatch(/meal.quality/i);
  });

  it('wraps the note, gives the time, and shows what is already in the diary', () => {
    const existing = resolve({ meals: [meal()] }).days[0].meals;
    const p = buildQuickLogPrompt({ text: 'two beers', today: TODAY, weekday: 'Sunday', nowTime: '20:15', recentMeals: existing, hasImages: false });
    expect(p).toContain('<note>\ntwo beers\n</note>');
    expect(p).toContain('it is now 20:15');
    expect(p).toContain('2026-11-15 19:30 Pasta bolognese');
  });

  it('has closed objects with every property required, at every level', () => {
    const walk = (o: unknown, path: string) => {
      if (!o || typeof o !== 'object') return;
      const s = o as { type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; items?: unknown; anyOf?: unknown[] };
      if (s.type === 'object') {
        expect(s.additionalProperties, path).toBe(false);
        expect([...(s.required ?? [])].sort(), path).toEqual(Object.keys(s.properties ?? {}).sort());
        for (const [k, v] of Object.entries(s.properties ?? {})) walk(v, `${path}.${k}`);
      }
      if (s.items) walk(s.items, `${path}[]`);
    };
    walk(QUICK_LOG_SCHEMA, 'root');
  });
});
