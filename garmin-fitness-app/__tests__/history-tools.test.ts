import { describe, it, expect } from 'vitest';
import { buildHistoryTables, parseCsv, runHistoryTool, MAX_ROWS_RETURNED, HISTORY_TOOL_DEFS } from '@/lib/history-tools';
import type { Activity, WellnessRecord } from '@/types';

const wellness = (date: string, over: Partial<WellnessRecord> = {}): WellnessRecord => ({
  id: 1, date, steps: null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null,
  body_fat_pct: null, muscle_mass_kg: null, bone_mass_kg: null, body_water_pct: null, visceral_fat: null,
  metabolic_age: null, stress_score: null, body_battery: null, weight_kg: null, vo2max: null,
  fitness_age: null, flights_climbed: null, respiratory_rate: null, walking_asymmetry_pct: null,
  walking_speed: null, walking_double_support_pct: null, oxygen_saturation: null, mindful_minutes: null,
  ...over,
});
const activity = (date: string, over: Partial<Activity> = {}): Activity => ({
  id: 1, garmin_id: 'g', activity_type: 'cycling', date, title: 'Ride', distance_km: 30,
  duration_seconds: 3600, calories: 600, avg_hr: 130, max_hr: 160, training_effect: null,
  avg_cadence: null, avg_speed_kmh: null, tss: 55, avg_power: 180, max_power: null,
  elevation_gain: null, normalized_power: null, ftp: null, ...over,
});

const tables = buildHistoryTables({
  wellness: [
    wellness('2024-03-01T00:00:00.000Z', { resting_hr: 55, sleep_score: 70 }),
    wellness('2024-03-02T00:00:00.000Z', { resting_hr: 53 }),                    // sleep_score not recorded
    wellness('2025-06-10T00:00:00.000Z', { resting_hr: 49, sleep_score: 82 }),
    wellness('2026-11-14T00:00:00.000Z', { resting_hr: 50, sleep_score: 76 }),
  ],
  activities: [
    activity('2024-05-04T09:00:00Z', { title: 'Zwift, "Alpe" climb', avg_power: 231, normalized_power: 240 }),
    activity('2025-08-20T16:00:00Z', { avg_power: 205 }),
    activity('2026-02-11T16:00:00Z', { activity_type: 'running', title: 'Easy run', avg_power: null }),
  ],
});

describe('parseCsv', () => {
  it('round-trips quoted cells with commas and quotes', () => {
    const t = parseCsv('a,b\n"x, y","say ""hi"""\n1,');
    expect(t.columns).toEqual(['a', 'b']);
    expect(t.rows).toEqual([['x, y', 'say "hi"'], ['1', '']]);
  });
});

describe('aggregate_history', () => {
  it('finds a personal best and the row it came from', () => {
    const out = runHistoryTool(tables, 'aggregate_history', { table: 'activities', column: 'avg_power', fn: 'max' });
    expect(out).toContain('max(avg_power) = 231 (n=2)');
    expect(out).toContain('date=2024-05-04');
  });

  // Lesson 4: the whole reason these are code and not model arithmetic.
  it('leaves unrecorded values out instead of counting them as zero', () => {
    const out = runHistoryTool(tables, 'aggregate_history', { table: 'wellness', column: 'sleep_score', fn: 'avg' });
    expect(out).toContain('avg(sleep_score) = 76 (n=3)'); // (70+82+76)/3, not /4
    expect(out).toMatch(/1 rows had no recorded value/);
    const min = runHistoryTool(tables, 'aggregate_history', { table: 'wellness', column: 'sleep_score', fn: 'min' });
    expect(min).toContain('min(sleep_score) = 70');
  });

  it('counts recorded values only', () => {
    expect(runHistoryTool(tables, 'aggregate_history', { table: 'wellness', column: 'sleep_score', fn: 'count' })).toContain('= 3 (n=3)');
  });

  it('groups by year and respects a date range and a filter', () => {
    const byYear = runHistoryTool(tables, 'aggregate_history', { table: 'wellness', column: 'resting_hr', fn: 'avg', group_by: 'year' });
    expect(byYear).toContain('2024: avg(resting_hr) = 54 (n=2)');
    expect(byYear).toContain('2025: avg(resting_hr) = 49 (n=1)');
    const ranged = runHistoryTool(tables, 'aggregate_history', { table: 'wellness', column: 'resting_hr', fn: 'min', from: '2026-01-01' });
    expect(ranged).toContain('= 50 (n=1)');
    const rides = runHistoryTool(tables, 'aggregate_history', { table: 'activities', column: 'duration_min', fn: 'sum', filter: { column: 'type', op: '=', value: 'cycling' } });
    expect(rides).toContain('sum(duration_min) = 120 (n=2)');
  });

  it('says so when a selection has no recorded values', () => {
    const out = runHistoryTool(tables, 'aggregate_history', { table: 'wellness', column: 'hrv_rmssd', fn: 'avg' });
    expect(out).toMatch(/No recorded values/);
  });
});

describe('query_history', () => {
  it('returns chosen columns for a date range', () => {
    const out = runHistoryTool(tables, 'query_history', { table: 'wellness', from: '2024-01-01', to: '2024-12-31', columns: ['date', 'resting_hr'] });
    expect(out).toBe('date,resting_hr\n2024-03-01,55\n2024-03-02,53');
  });

  it('sorts with empty cells last and applies a limit', () => {
    const out = runHistoryTool(tables, 'query_history', { table: 'wellness', columns: ['date', 'sleep_score'], sort_by: 'sleep_score', limit: 2 });
    expect(out.split('\n').slice(0, 3)).toEqual(['date,sleep_score', '2025-06-10,82', '2026-11-14,76']);
    expect(out).toMatch(/2 more rows match/);
  });

  it('keeps quoted text intact and filters by text', () => {
    const out = runHistoryTool(tables, 'query_history', { table: 'activities', columns: ['date', 'title'], filter: { column: 'title', op: 'contains', value: 'alpe' } });
    expect(out).toBe('date,title\n2024-05-04,"Zwift, ""Alpe"" climb"');
  });

  it('never matches an empty cell in a numeric comparison', () => {
    const out = runHistoryTool(tables, 'query_history', { table: 'activities', columns: ['date'], filter: { column: 'avg_power', op: '<', value: '500' } });
    expect(out.split('\n')).toHaveLength(3); // header + 2 rides; the run has no power
  });

  it('caps the rows returned', () => {
    const many = buildHistoryTables({ activities: [], wellness: Array.from({ length: 200 }, (_, i) => wellness(`2025-01-${String((i % 28) + 1).padStart(2, '0')}`, { resting_hr: 50 })) });
    const out = runHistoryTool(many, 'query_history', { table: 'wellness', columns: ['date'], limit: 5000 });
    expect(out.split('\n')).toHaveLength(MAX_ROWS_RETURNED + 2);
  });
});

describe('bad input', () => {
  it('answers with an error string, never an exception', () => {
    const cases: [string, unknown][] = [
      ['query_history', { table: 'users' }],
      ['query_history', { table: 'wellness', columns: ['password'] }],
      ['query_history', { table: 'wellness', from: "2024-01-01'; DROP TABLE wellness;--" }],
      ['query_history', { table: 'wellness', filter: { column: 'resting_hr', op: 'LIKE', value: '5' } }],
      ['query_history', { table: 'wellness', filter: { column: 'resting_hr', op: '>=', value: 'high' } }],
      ['query_history', { table: 'wellness', sort_by: 'nope' }],
      ['aggregate_history', { table: 'wellness', column: 'nope', fn: 'avg' }],
      ['aggregate_history', { table: 'wellness', column: 'resting_hr', fn: 'median' }],
      ['aggregate_history', { table: 'wellness', column: 'resting_hr', fn: 'avg', group_by: 'decade' }],
      ['aggregate_history', { table: 'travel', column: 'x', fn: 'avg' }],
      ['run_sql', { query: 'select 1' }],
      ['query_history', null],
    ];
    for (const [name, args] of cases) {
      expect(runHistoryTool(tables, name, args), `${name} ${JSON.stringify(args)}`).toMatch(/^Error/);
    }
  });

  it('lists the tables with their ranges', () => {
    const out = runHistoryTool(tables, 'list_history_tables', {});
    expect(out).toContain('wellness (4 rows, 2024-03-01 to 2026-11-14)');
    expect(out).toContain('activities (3 rows');
  });
});

describe('tool definitions', () => {
  it('are closed schemas', () => {
    for (const def of HISTORY_TOOL_DEFS) expect(def.inputSchema.additionalProperties, def.name).toBe(false);
  });
});
