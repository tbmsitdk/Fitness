import { describe, it, expect } from 'vitest';
import {
  EXERCISES, EXERCISE_BY_KEY, exercisesByCategory, primaryValue, primaryUnit,
  estimatedSeconds, estimateExerciseTss, coerceExerciseLog, defaultDraft,
  currentStreak, totalSeconds, CATEGORY_COLOR, CATEGORY_ORDER, type ExerciseLog,
} from '@/lib/exercises';

function log(overrides: Partial<ExerciseLog> & { exercise_key: string }): ExerciseLog {
  return {
    id: 1, date: '2026-08-01',
    sets: null, reps: null, duration_seconds: null, load_kg: null,
    vital_capacity_l: null, inspiratory_strength: null, expiratory_strength: null,
    notes: null,
    ...overrides,
  };
}

describe('exercise catalog', () => {
  it('contains all 19 exercises with unique keys', () => {
    expect(EXERCISES).toHaveLength(19);
    expect(new Set(EXERCISES.map(e => e.key)).size).toBe(19);
  });

  it('groups every exercise into exactly one category', () => {
    const grouped = exercisesByCategory().flatMap(g => g.exercises);
    expect(grouped).toHaveLength(EXERCISES.length);
  });

  it('times everything in seconds except grip strength (kg) and Airofit', () => {
    for (const e of EXERCISES) {
      if (e.key === 'grip_strength_press') expect(e.primaryMetric).toBe('load');
      else if (e.key === 'airofit')        expect(e.primaryMetric).toBe('airofit');
      else                                  expect(e.primaryMetric, e.key).toBe('duration');
    }
  });

  it('gives grip strength a secondsPerRep so its work time can still be estimated', () => {
    expect(EXERCISE_BY_KEY.grip_strength_press.secondsPerRep).toBeGreaterThan(0);
  });
});

describe('primaryValue', () => {
  it('multiplies hold-time by sets', () => {
    expect(primaryValue(log({ exercise_key: 'squats', duration_seconds: 30, sets: 3 }))).toBe(90);
  });

  it('treats a missing set count as a single set', () => {
    expect(primaryValue(log({ exercise_key: 'squats', duration_seconds: 45 }))).toBe(45);
  });

  it('multiplies hold-time by sets for every timed exercise', () => {
    expect(primaryValue(log({ exercise_key: 'dead_hang', duration_seconds: 30, sets: 2 }))).toBe(60);
    expect(primaryValue(log({ exercise_key: 'marches', duration_seconds: 60, sets: 2 }))).toBe(120);
  });

  it('never multiplies a grip-strength reading by sets — it is a peak value', () => {
    expect(primaryValue(log({ exercise_key: 'grip_strength_press', load_kg: 45, sets: 3 }))).toBe(45);
  });

  it('reports Airofit in whole minutes', () => {
    expect(primaryValue(log({ exercise_key: 'airofit', duration_seconds: 600 }))).toBe(10);
  });

  it('returns null when the primary metric was not recorded', () => {
    expect(primaryValue(log({ exercise_key: 'squats' }))).toBeNull();
  });
});

describe('primaryUnit', () => {
  it('maps each metric type to its unit', () => {
    expect(primaryUnit('squats')).toBe('s');
    expect(primaryUnit('dead_hang')).toBe('s');
    expect(primaryUnit('trunk_twists')).toBe('s');
    expect(primaryUnit('grip_strength_press')).toBe('kg');
    expect(primaryUnit('airofit')).toBe('min');
  });
});

describe('estimatedSeconds', () => {
  it('uses explicit duration when recorded', () => {
    expect(estimatedSeconds(log({ exercise_key: 'dead_hang', duration_seconds: 45, sets: 2 }))).toBe(90);
  });

  it('estimates grip work from reps x secondsPerRep when no timer was recorded', () => {
    // grip_strength_press: 3s per squeeze
    expect(estimatedSeconds(log({ exercise_key: 'grip_strength_press', reps: 20 }))).toBe(60);
  });

  it('returns 0 when neither duration nor reps exist', () => {
    expect(estimatedSeconds(log({ exercise_key: 'squats' }))).toBe(0);
  });
});

describe('estimateExerciseTss', () => {
  it('is zero for an empty log', () => {
    expect(estimateExerciseTss([])).toBe(0);
  });

  it('scores strength work higher than mobility work for the same duration', () => {
    const strength = estimateExerciseTss([log({ exercise_key: 'horseback_stands', duration_seconds: 600 })]);
    const mobility = estimateExerciseTss([log({ exercise_key: 'foam_roller_thoracic', duration_seconds: 600 })]);
    expect(strength).toBeGreaterThan(mobility);
  });

  it('stays conservative — a full 30-minute routine is a modest TSS', () => {
    const tss = estimateExerciseTss([
      log({ exercise_key: 'squats', duration_seconds: 180 }),
      log({ exercise_key: 'dead_hang', duration_seconds: 120 }),
      log({ exercise_key: 'trunk_twists', duration_seconds: 200 }),
      log({ exercise_key: 'marches', duration_seconds: 300 }),
    ]);
    expect(tss).toBeGreaterThan(0);
    expect(tss).toBeLessThan(30);
  });

  it('counts each set of a timed hold', () => {
    const single = estimateExerciseTss([log({ exercise_key: 'squats', duration_seconds: 60 })]);
    const triple = estimateExerciseTss([log({ exercise_key: 'squats', duration_seconds: 60, sets: 3 })]);
    expect(triple).toBeCloseTo(single * 3, 5);
  });

  it('ignores unknown exercise keys rather than throwing', () => {
    expect(estimateExerciseTss([log({ exercise_key: 'not_a_real_exercise', duration_seconds: 60 })])).toBe(0);
  });
});

describe('coerceExerciseLog', () => {
  it('converts Postgres DECIMAL strings to numbers', () => {
    const row = coerceExerciseLog({
      id: 1, date: '2026-08-01', exercise_key: 'grip_strength_press',
      sets: null, reps: null, duration_seconds: null, load_kg: '45.50',
      vital_capacity_l: '4.20', inspiratory_strength: null, expiratory_strength: null, notes: null,
    });
    expect(row.load_kg).toBe(45.5);
    expect(row.vital_capacity_l).toBe(4.2);
    expect(typeof row.load_kg).toBe('number');
  });

  it('normalises a Date object to a YYYY-MM-DD string', () => {
    const row = coerceExerciseLog({
      id: 1, date: new Date('2026-08-01T00:00:00Z'), exercise_key: 'squats',
      sets: null, reps: 10, duration_seconds: null, load_kg: null,
      vital_capacity_l: null, inspiratory_strength: null, expiratory_strength: null, notes: null,
    });
    expect(row.date).toBe('2026-08-01');
  });
});

describe('catalog integrity', () => {
  it('EXERCISE_BY_KEY resolves every catalog entry', () => {
    for (const e of EXERCISES) expect(EXERCISE_BY_KEY[e.key]).toBe(e);
  });
});

describe('defaultDraft', () => {
  it('pre-fills the prescribed routine', () => {
    const d = defaultDraft();
    expect(d.squats).toEqual({ sets: '1', duration_seconds: '30' });
    expect(d.doorway_press).toEqual({ sets: '1', duration_seconds: '120' });
    expect(d.dead_hang).toEqual({ sets: '2', duration_seconds: '10' });
    expect(d.foam_roller_thoracic).toEqual({ sets: '1', duration_seconds: '180' });
  });

  it('gives grip strength kg + reps and no sets', () => {
    expect(defaultDraft().grip_strength_press).toEqual({ load_kg: '5', reps: '100' });
  });

  it('omits Airofit so it is only logged when actually used', () => {
    expect(defaultDraft().airofit).toBeUndefined();
  });

  it('produces values the save path treats as real entries, not blanks', () => {
    // Every default must carry something other than "sets", or the API would
    // discard it as an untouched row.
    for (const [key, fields] of Object.entries(defaultDraft())) {
      const meaningful = Object.keys(fields).filter(f => f !== 'sets');
      expect(meaningful.length, key).toBeGreaterThan(0);
    }
  });
});

describe('currentStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(currentStreak(['2026-08-20', '2026-08-21', '2026-08-22'], '2026-08-22')).toBe(3);
  });

  it('still counts when today is not logged yet but yesterday was', () => {
    expect(currentStreak(['2026-08-20', '2026-08-21'], '2026-08-22')).toBe(2);
  });

  it('is broken once the last log is older than yesterday', () => {
    expect(currentStreak(['2026-08-18', '2026-08-19'], '2026-08-22')).toBe(0);
  });

  it('ignores gaps before the current run', () => {
    expect(currentStreak(['2026-08-01', '2026-08-21', '2026-08-22'], '2026-08-22')).toBe(2);
  });

  it('is 0 with no logs', () => {
    expect(currentStreak([], '2026-08-22')).toBe(0);
  });

  it('de-duplicates multiple entries on the same day', () => {
    expect(currentStreak(['2026-08-22', '2026-08-22', '2026-08-21'], '2026-08-22')).toBe(2);
  });
});

describe('totalSeconds', () => {
  it('sums estimated work across entries', () => {
    expect(totalSeconds([
      log({ exercise_key: 'squats', duration_seconds: 30, sets: 2 }),
      log({ exercise_key: 'dead_hang', duration_seconds: 10 }),
    ])).toBe(70);
  });
});

describe('category palette', () => {
  it('assigns a distinct validated colour to every category', () => {
    const colors = CATEGORY_ORDER.map(c => CATEGORY_COLOR[c]);
    expect(new Set(colors).size).toBe(CATEGORY_ORDER.length);
  });

  it('no longer uses the purple/blue pair that failed CVD validation', () => {
    const colors = Object.values(CATEGORY_COLOR).map(c => c.toLowerCase());
    expect(colors).not.toContain('#a78bfa');
    expect(colors).not.toContain('#3b82f6');
  });
});
