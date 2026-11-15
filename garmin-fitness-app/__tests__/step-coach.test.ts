import { describe, it, expect } from 'vitest';
import { stepCoach, STEPS_PER_MINUTE } from '@/lib/step-coach';
import type { WellnessRecord } from '@/types';

// 2026-11-16 is a Monday.
const TODAY = '2026-11-16';

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

/** One row per day for `weeks` weeks before today, steps chosen by weekday (0 = Sunday). */
function history(weeks: number, byWeekday: (wd: number) => number | null, shape: 'bare' | 'iso' = 'iso'): WellnessRecord[] {
  const rows: WellnessRecord[] = [];
  for (let k = 1; k <= weeks * 7; k++) {
    const day = addDays(TODAY, -k);
    rows.push(row(shape === 'iso' ? `${day}T00:00:00.000Z` : day, byWeekday(new Date(`${day}T12:00:00Z`).getUTCDay())));
  }
  return rows;
}

// The user's real pattern: weekdays around 6,600, weekends around 11,200, goal 8,750.
const realistic = (wd: number) => (wd === 0 || wd === 6 ? 11_200 : 6_600);

describe('stepCoach — what counts as a day', () => {
  // Lesson 22: the 04:00 sync also reads today, a few hours into the day.
  it('never uses today, whose count is only a few hours old', () => {
    const rows = [...history(4, realistic), row(`${TODAY}T00:00:00.000Z`, 940)];
    const c = stepCoach({ wellness: rows, goal: 8750, today: TODAY });
    expect(c.asOf).toBe(addDays(TODAY, -1));
    expect(c.latest!.steps).toBe(11_200); // Sunday, not today's 940
  });

  // Lesson 4
  it('treats a day with no count as unknown: not a miss, and it ends a streak', () => {
    const rows = history(3, () => 9_000).filter(r => r.date.slice(0, 10) !== addDays(TODAY, -2));
    const c = stepCoach({ wellness: rows, goal: 8750, today: TODAY });
    expect(c.streak).toBe(1);                 // yesterday only; the missing day stops it, it is not counted as a miss
    expect(c.last7.n).toBe(6);
    expect(c.last7.hits).toBe(6);
  });

  it('ignores a zero and an impossible count', () => {
    const rows = [row(`${addDays(TODAY, -1)}`, 0), row(addDays(TODAY, -2), 250_000), row(addDays(TODAY, -3), 7_000)];
    const c = stepCoach({ wellness: rows, goal: 8750, today: TODAY });
    expect(c.asOf).toBe(addDays(TODAY, -3));
  });

  it('gives the same answer for bare dates and ISO timestamps', () => {
    const a = stepCoach({ wellness: history(5, realistic, 'iso'), goal: 8750, today: TODAY });
    const b = stepCoach({ wellness: history(5, realistic, 'bare'), goal: 8750, today: TODAY });
    expect(a).toEqual(b);
  });

  it('says so when there is no history at all', () => {
    const c = stepCoach({ wellness: [], goal: 8750, today: TODAY });
    expect(c.latest).toBeNull();
    expect(c.asOf).toBeNull();
    expect(c.nudge).toMatch(/no step history/);
  });
});

describe('stepCoach — the pattern', () => {
  const c = stepCoach({ wellness: history(8, realistic), goal: 8750, today: TODAY });

  it('finds the weekday/weekend gap', () => {
    expect(c.weekdayAvg).toEqual({ weekdays: 6_600, weekend: 11_200 });
    expect(c.nudge).toMatch(/weekends clear the goal/);
    expect(c.nudge).toMatch(/weekday habit/);
  });

  it('lists Monday first, with hit counts per weekday', () => {
    expect(c.weekdays.map(w => w.name)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    expect(c.weekdays[0]).toMatchObject({ n: 8, mean: 6_600, hits: 0 });
    expect(c.weekdays[6]).toMatchObject({ n: 8, mean: 11_200, hits: 8 });
  });

  it('names the weakest weekday only with enough history', () => {
    expect(c.weakest!.mean).toBe(6_600);
    const thin = stepCoach({ wellness: history(3, realistic), goal: 8750, today: TODAY });
    expect(thin.weakest).toBeNull(); // 3 of each weekday is under the 4 needed
  });

  it('plans today from today\'s own weekday, in minutes of walking', () => {
    // Monday: usual 6,600, so 2,150 extra, about 20 minutes at 100 steps a minute
    expect(c.today.name).toBe('Monday');
    expect(c.today).toMatchObject({ usual: 6_600, extraNeeded: 2_150, walkMinutes: 20, hitsOnThisWeekday: 0, samples: 8 });
    expect(c.nudge).toContain('Mondays are harder');
    expect(c.nudge).toContain('20 minutes of brisk walking');
    expect(STEPS_PER_MINUTE).toBe(100);
  });

  it('leaves a day that is usually fine alone', () => {
    const sunday = stepCoach({ wellness: history(8, realistic), goal: 8750, today: '2026-11-15' });
    expect(sunday.today.walkMinutes).toBe(0);
    expect(sunday.nudge).toContain('Sundays are usually fine');
  });

  it('gives no plan for a weekday it has too little history on', () => {
    const thin = stepCoach({ wellness: history(2, realistic), goal: 8750, today: TODAY });
    expect(thin.today.usual).toBeNull();
    expect(thin.today.walkMinutes).toBeNull();
  });

  it('sets checkpoints as shares of the goal, rounded to 100', () => {
    expect(c.today.checkpoints).toEqual([
      { time: '12:00', steps: 2_600 }, { time: '15:00', steps: 5_300 }, { time: '18:00', steps: 7_400 },
    ]);
  });

  it('reports the typical shortfall on missed days', () => {
    // 5 weekdays at 6,600 miss by 2,150; 2 weekend days hit: the median miss is 2,150
    expect(c.medianShortfall).toBe(2_150);
  });
});

describe('stepCoach — streak, trend and freshness', () => {
  it('counts consecutive days at or above the goal, back from yesterday', () => {
    const rows = [row(addDays(TODAY, -1), 9_000), row(addDays(TODAY, -2), 8_750), row(addDays(TODAY, -3), 10_000), row(addDays(TODAY, -4), 8_749)];
    expect(stepCoach({ wellness: rows, goal: 8750, today: TODAY }).streak).toBe(3);
    expect(stepCoach({ wellness: rows, goal: 8750, today: TODAY }).nudge).toContain('3 days in a row');
  });

  it('reads the week against the one before', () => {
    const rows = history(2, wd => wd).map((r, i) => ({ ...r, steps: i < 7 ? 4_000 : 8_000 }));
    expect(stepCoach({ wellness: rows, goal: 8750, today: TODAY }).trend).toBe('down');
    const flat = history(2, () => 7_000);
    expect(stepCoach({ wellness: flat, goal: 8750, today: TODAY }).trend).toBe('flat');
    expect(stepCoach({ wellness: history(1, () => 7_000), goal: 8750, today: TODAY }).trend).toBeNull();
  });

  it('flags a stale sync and still coaches from the pattern', () => {
    const old = history(8, realistic).filter(r => r.date.slice(0, 10) <= addDays(TODAY, -4));
    const c = stepCoach({ wellness: old, goal: 8750, today: TODAY });
    expect(c.stale).toBe(true);
    expect(c.asOf).toBe(addDays(TODAY, -4));
    expect(c.nudge).toMatch(/sync is behind/);
  });

  it('words a missed and a reached day differently', () => {
    expect(stepCoach({ wellness: [row(addDays(TODAY, -1), 5_310)], goal: 8750, today: TODAY }).nudge)
      .toContain('Yesterday you did 5,310 steps, 3,440 short of 8,750');
    expect(stepCoach({ wellness: [row(addDays(TODAY, -1), 12_000)], goal: 8750, today: TODAY }).nudge)
      .toContain('Yesterday you reached the goal with 12,000 steps');
  });

  it('falls back to a sane goal when given nonsense', () => {
    expect(stepCoach({ wellness: [], goal: NaN, today: TODAY }).goal).toBe(10_000);
    expect(stepCoach({ wellness: [], goal: 0, today: TODAY }).goal).toBe(10_000);
  });
});

describe('stepCoach — the recent series', () => {
  it('lists the last 14 finished days oldest first, with null where nothing was counted', () => {
    const rows = history(3, () => 7_000).filter(r => r.date.slice(0, 10) !== addDays(TODAY, -3));
    const c = stepCoach({ wellness: rows, goal: 8750, today: TODAY });
    expect(c.recent).toHaveLength(14);
    expect(c.recent[0].date).toBe(addDays(TODAY, -14));
    expect(c.recent[13].date).toBe(addDays(TODAY, -1));
    expect(c.recent.find(d => d.date === addDays(TODAY, -3))!.steps).toBeNull(); // unknown, not zero
    expect(c.recent[13].steps).toBe(7_000);
  });
});
