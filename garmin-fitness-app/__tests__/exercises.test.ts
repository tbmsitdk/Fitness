import { describe, it, expect } from 'vitest';
import {
  EXERCISES, EXERCISE_BY_KEY, exercisesByCategory, primaryValue, primaryUnit,
  estimatedSeconds, estimateExerciseTss, coerceExerciseLog, type ExerciseLog,
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

  it('gives every rep-based exercise a secondsPerRep so duration can be estimated', () => {
    for (const e of EXERCISES) {
      if (e.primaryMetric === 'reps') expect(e.secondsPerRep, e.key).toBeGreaterThan(0);
    }
  });
});

describe('primaryValue', () => {
  it('multiplies reps by sets', () => {
    expect(primaryValue(log({ exercise_key: 'squats', reps: 10, sets: 3 }))).toBe(30);
  });

  it('treats a missing set count as a single set', () => {
    expect(primaryValue(log({ exercise_key: 'squats', reps: 12 }))).toBe(12);
  });

  it('multiplies hold-time by sets for duration exercises', () => {
    expect(primaryValue(log({ exercise_key: 'dead_hang', duration_seconds: 30, sets: 2 }))).toBe(60);
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
    expect(primaryUnit('squats')).toBe('reps');
    expect(primaryUnit('dead_hang')).toBe('s');
    expect(primaryUnit('grip_strength_press')).toBe('kg');
    expect(primaryUnit('airofit')).toBe('min');
  });
});

describe('estimatedSeconds', () => {
  it('uses explicit duration when recorded', () => {
    expect(estimatedSeconds(log({ exercise_key: 'dead_hang', duration_seconds: 45, sets: 2 }))).toBe(90);
  });

  it('estimates from reps x secondsPerRep when no timer was recorded', () => {
    // squats: 3s per rep
    expect(estimatedSeconds(log({ exercise_key: 'squats', reps: 20 }))).toBe(60);
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
      log({ exercise_key: 'squats', reps: 60 }),
      log({ exercise_key: 'dead_hang', duration_seconds: 120 }),
      log({ exercise_key: 'trunk_twists', reps: 100 }),
    ]);
    expect(tss).toBeGreaterThan(0);
    expect(tss).toBeLessThan(30);
  });

  it('ignores unknown exercise keys rather than throwing', () => {
    expect(estimateExerciseTss([log({ exercise_key: 'not_a_real_exercise', reps: 10 })])).toBe(0);
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
