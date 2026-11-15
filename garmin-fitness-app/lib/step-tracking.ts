// How the person tracks against the step goal over a period: totals, the weeks
// and months that made them, which days of the week are the gap, and how far
// the goal was missed when it was missed.
//
// Same rules as lib/step-coach.ts (tasks/lessons.md 4, 22, 26): only finished
// days (before today) count, and a day with no count is unknown, never zero.
// Every average is over the days that HAVE a count, so a gap in the sync can
// not drag a week or a month down.

import type { WellnessRecord } from '@/types';

/** A week with fewer counted days than this is drawn as partial, not as a result. */
export const MIN_DAYS_FOR_WEEK = 4;
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export interface Band { label: string; n: number; share: number; reachesGoal: boolean }
export interface WeekStat { start: string; days: number; avg: number; hits: number; partial: boolean }
export interface MonthStat { month: string; days: number; avg: number; hits: number; hitRate: number }
export interface WeekdayStat { weekday: number; name: string; n: number; mean: number | null; hits: number; hitRate: number | null; gap: number | null }

export interface StepTracking {
  goal: number;
  /** First and last day with a count in the period. */
  from: string | null;
  to: string | null;
  /** Days with a count. */
  days: number;
  /** Calendar days between first and last count that have no count at all. */
  missing: number;
  total: number;
  avg: number | null;
  median: number | null;
  /** Average minus the goal; negative = below it. */
  avgGap: number | null;
  hits: number;
  hitRate: number | null;
  best: { date: string; steps: number } | null;
  /** What the goal would have added up to over the counted days. */
  targetTotal: number;
  /** total − targetTotal; negative = behind target. */
  vsTarget: number;
  vsTargetPct: number | null;
  streak: { current: number; longest: { days: number; end: string } | null };
  last4weeks: { avg: number | null; days: number; previousAvg: number | null; change: number | null };
  bands: Band[];
  weeks: WeekStat[];
  months: MonthStat[];
  weekdays: WeekdayStat[];
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayDiff = (from: string, to: string) =>
  Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000);
const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const roundTo = (v: number, to: number) => Math.round(v / to) * to;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function stepTracking(input: { wellness: WellnessRecord[]; goal: number; today: string }): StepTracking {
  const goal = Number.isFinite(input.goal) && input.goal > 0 ? Math.round(input.goal) : 10000;
  const today = input.today;

  const steps = new Map<string, number>();
  for (const w of input.wellness) {
    const day = String(w.date).slice(0, 10);
    const v = w.steps;
    if (day < today && typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 100_000) steps.set(day, v);
  }
  const days = [...steps.keys()].sort();
  const values = days.map(d => steps.get(d)!);
  const n = days.length;
  const total = values.reduce((s, v) => s + v, 0);
  const hits = values.filter(v => v >= goal).length;
  const avg = n ? total / n : null;

  const from = n ? days[0] : null;
  const to = n ? days[n - 1] : null;
  const best = n ? days.reduce((b, d) => (steps.get(d)! > b.steps ? { date: d, steps: steps.get(d)! } : b), { date: days[0], steps: steps.get(days[0])! }) : null;
  const targetTotal = goal * n;

  // Streaks over consecutive calendar days at or above the goal.
  let longest: StepTracking['streak']['longest'] = null;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    const hit = steps.get(d)! >= goal;
    if (hit) { run = prev !== null && dayDiff(prev, d) === 1 && run > 0 ? run + 1 : 1; } else run = 0;
    if (hit && (!longest || run > longest.days)) longest = { days: run, end: d };
    prev = d;
  }
  let current = 0;
  for (let k = 1; ; k++) {
    const v = steps.get(addDays(today, -k));
    if (v === undefined || v < goal) break;
    current++;
  }

  // The last four weeks against the four before, anchored on today, not on the period.
  const windowAvg = (a: number, b: number) => {
    const vals: number[] = [];
    for (let k = a; k <= b; k++) { const v = steps.get(addDays(today, -k)); if (v !== undefined) vals.push(v); }
    return { avg: mean(vals), days: vals.length };
  };
  const recent = windowAvg(1, 28);
  const earlier = windowAvg(29, 56);
  const last4weeks = {
    avg: recent.avg == null ? null : Math.round(recent.avg), days: recent.days,
    previousAvg: earlier.avg == null ? null : Math.round(earlier.avg),
    change: recent.avg != null && earlier.avg != null && recent.days >= 14 && earlier.days >= 14 ? Math.round(recent.avg - earlier.avg) : null,
  };

  // Bands are shares of the goal, with labels in plain steps.
  const edges = [0.5, 0.75, 1, 1.25].map(f => goal * f);
  const label = (i: number) => {
    const r = (x: number) => fmt(roundTo(x, 100));
    return i === 0 ? `Under ${r(edges[0])}` : i === 4 ? `${fmt(edges[3] === goal * 1.25 ? roundTo(edges[3], 100) : edges[3])} or more`
      : `${i === 3 ? fmt(goal) : r(edges[i - 1])} to ${i === 2 ? fmt(goal) : r(edges[i])}`;
  };
  const bandOf = (v: number) => (v < edges[0] ? 0 : v < edges[1] ? 1 : v < edges[2] ? 2 : v < edges[3] ? 3 : 4);
  const counts = [0, 0, 0, 0, 0];
  for (const v of values) counts[bandOf(v)]++;
  const bands: Band[] = counts.map((c, i) => ({ label: label(i), n: c, share: n ? Math.round((c / n) * 100) : 0, reachesGoal: i >= 3 }));

  // Weeks start on Monday. Averages are over counted days only.
  const weekMap = new Map<string, number[]>();
  for (const d of days) {
    const start = addDays(d, -((weekdayOf(d) + 6) % 7));
    weekMap.set(start, [...(weekMap.get(start) ?? []), steps.get(d)!]);
  }
  const weeks: WeekStat[] = [...weekMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([start, v]) => ({
    start, days: v.length, avg: Math.round(mean(v)!), hits: v.filter(x => x >= goal).length, partial: v.length < MIN_DAYS_FOR_WEEK,
  }));

  const monthMap = new Map<string, number[]>();
  for (const d of days) monthMap.set(d.slice(0, 7), [...(monthMap.get(d.slice(0, 7)) ?? []), steps.get(d)!]);
  const months: MonthStat[] = [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => {
    const h = v.filter(x => x >= goal).length;
    return { month, days: v.length, avg: Math.round(mean(v)!), hits: h, hitRate: Math.round((h / v.length) * 100) };
  });

  const weekdays: WeekdayStat[] = WEEK_ORDER.map(wd => {
    const mine = days.filter(d => weekdayOf(d) === wd).map(d => steps.get(d)!);
    const m = mean(mine);
    const h = mine.filter(v => v >= goal).length;
    return {
      weekday: wd, name: NAMES[wd], n: mine.length, mean: m == null ? null : Math.round(m), hits: h,
      hitRate: mine.length ? Math.round((h / mine.length) * 100) : null, gap: m == null ? null : Math.round(m - goal),
    };
  });

  return {
    goal, from, to, days: n, missing: from && to ? Math.max(0, dayDiff(from, to) + 1 - n) : 0,
    total, avg: avg == null ? null : Math.round(avg), median: median(values) == null ? null : Math.round(median(values)!),
    avgGap: avg == null ? null : Math.round(avg - goal), hits, hitRate: n ? Math.round((hits / n) * 100) : null, best,
    targetTotal, vsTarget: total - targetTotal, vsTargetPct: targetTotal ? Math.round((total / targetTotal) * 100) : null,
    streak: { current, longest }, last4weeks, bands, weeks, months, weekdays,
  };
}
