import { describe, it, expect } from 'vitest';
import { QUICK_LOG_SCHEMA, QUICK_LOG_SYSTEM, buildQuickLogPrompt, resolveQuickLog, unitsFor } from '@/lib/quick-log';
import { alcoholUnits, type NutritionLog } from '@/lib/nutrition';

const TODAY = '2026-11-15';

const log = (date: string, over: Partial<NutritionLog> = {}): NutritionLog => ({
  date, alcohol_units: null, candy_portions: null, savoury_snacks: null, sugary_drinks: null,
  last_food_time: null, caffeine_after_14: null, meal_quality: null, notes: null, ...over,
});

const day = (over: Record<string, unknown> = {}) => ({
  date: TODAY, is_day_total: false, drinks: [], no_alcohol: false, candy_portions: null, savoury_snacks: null,
  sugary_drinks: null, last_food_time: '', caffeine_after_14: 'not_mentioned', meal_quality: null, ...over,
});
const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ understood: 'ok', questions: [], nutrition: [], exercises: [], trips: [], ...over });
const resolve = (over: Record<string, unknown>, existing: NutritionLog[] = []) => resolveQuickLog(reply(over), existing, TODAY);

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

describe('resolveQuickLog — nutrition', () => {
  // Lesson 4, and the reason this feature has a confirmation step at all.
  it('leaves every field nobody mentioned exactly as it was — never a zero', () => {
    const p = resolve({ nutrition: [day({ drinks: [{ description: 'red wine', volume_ml: 150, abv_percent: 13, count: 2 }] })] });
    const row = p.nutrition[0].row;
    expect(row.alcohol_units).toBe(2.5);
    expect(row.candy_portions).toBeNull();
    expect(row.savoury_snacks).toBeNull();
    expect(row.sugary_drinks).toBeNull();
    expect(row.caffeine_after_14).toBeNull();
    expect(row.last_food_time).toBeNull();
    expect(p.nutrition[0].changes).toEqual([{ label: 'Alcohol units', from: 'not logged', to: '2.5' }]);
  });

  it('adds to what is already logged for the day', () => {
    const p = resolve(
      { nutrition: [day({ drinks: [{ description: 'beer', volume_ml: 330, abv_percent: 4.6, count: 1 }], candy_portions: 1 })] },
      [log(TODAY, { alcohol_units: 2, candy_portions: 1, savoury_snacks: 2, notes: 'dinner out' })],
    );
    const row = p.nutrition[0].row;
    expect(row.alcohol_units).toBe(3);
    expect(row.candy_portions).toBe(2);
    expect(row.savoury_snacks).toBe(2);   // untouched
    expect(row.notes).toBe('dinner out'); // untouched
  });

  it('replaces the day when the person gave totals', () => {
    const p = resolve(
      { nutrition: [day({ is_day_total: true, drinks: [{ description: 'beer', volume_ml: 330, abv_percent: 4.6, count: 1 }] })] },
      [log(TODAY, { alcohol_units: 4 })],
    );
    expect(p.nutrition[0].row.alcohol_units).toBe(1);
  });

  it('logs an explicit "no alcohol" as 0, but only when it was said', () => {
    expect(resolve({ nutrition: [day({ no_alcohol: true })] }).nutrition[0].row.alcohol_units).toBe(0);
    // Nothing said about alcohol, something said about candy: alcohol stays unlogged.
    expect(resolve({ nutrition: [day({ candy_portions: 1 })] }).nutrition[0].row.alcohol_units).toBeNull();
  });

  it('does not let "no alcohol" wipe drinks already logged when adding', () => {
    const p = resolve({ nutrition: [day({ no_alcohol: true, candy_portions: 1 })] }, [log(TODAY, { alcohol_units: 2 })]);
    expect(p.nutrition[0].row.alcohol_units).toBe(2);
  });

  it('does not let "no caffeine" undo a late coffee already logged when adding', () => {
    const p = resolve({ nutrition: [day({ caffeine_after_14: 'no', candy_portions: 1 })] }, [log(TODAY, { caffeine_after_14: true })]);
    expect(p.nutrition[0].row.caffeine_after_14).toBe(true);
    expect(resolve({ nutrition: [day({ caffeine_after_14: 'no' })] }).nutrition[0].row.caffeine_after_14).toBe(false);
  });

  it('proposes nothing when the reading changes nothing', () => {
    expect(resolve({ nutrition: [day()] }).nutrition).toEqual([]);
  });

  it('ignores impossible drinks and values', () => {
    const p = resolve({ nutrition: [day({
      drinks: [{ description: 'x', volume_ml: -5, abv_percent: 13, count: 1 }, { description: 'y', volume_ml: 100, abv_percent: 400, count: 1 }],
      candy_portions: -3, meal_quality: 9, last_food_time: '27:00',
    })] });
    expect(p.nutrition).toEqual([]);
  });

  it('refuses dates in the future or too far back, and asks instead', () => {
    const p = resolve({ nutrition: [day({ date: '2026-11-16', candy_portions: 1 }), day({ date: '2025-01-01', candy_portions: 1 }), day({ date: 'yesterday', candy_portions: 1 })] });
    expect(p.nutrition).toEqual([]);
    expect(p.questions).toHaveLength(3);
  });

  it('matches an existing day stored as an ISO timestamp', () => {
    const p = resolve({ nutrition: [day({ candy_portions: 1 })] }, [log(`${TODAY}T00:00:00.000Z`, { candy_portions: 2 })]);
    expect(p.nutrition[0].row.candy_portions).toBe(3);
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
    expect(() => resolveQuickLog('Logged 2 beers for you!', [], TODAY)).toThrow(/not JSON/);
  });

  it('survives a reply with missing sections', () => {
    const p = resolveQuickLog('{}', [], TODAY);
    expect(p).toEqual({ understood: '', questions: [], nutrition: [], exercises: [], trips: [] });
  });
});

describe('prompt and schema', () => {
  it('tells the model never to fill in a zero, and carries the form\'s own definitions', () => {
    expect(QUICK_LOG_SYSTEM).toMatch(/Never fill in a zero/);
    expect(QUICK_LOG_SYSTEM).toContain('dead_hang = Dead hang');
    expect(QUICK_LOG_SYSTEM).toMatch(/Does not count:/);
  });

  it('wraps the note and shows what is already logged', () => {
    const p = buildQuickLogPrompt({ text: 'two beers', today: TODAY, weekday: 'Sunday', recentLogs: [log(TODAY, { alcohol_units: 1 })], hasImages: false });
    expect(p).toContain('<note>\ntwo beers\n</note>');
    expect(p).toContain('2026-11-15: alcohol 1, candy —');
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
