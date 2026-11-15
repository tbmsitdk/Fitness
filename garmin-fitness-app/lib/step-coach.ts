// Step-goal coaching, worked out from the person's own history.
//
// Plain code, not a model call: the same answer every time, explainable, and
// testable. The morning brief (lib/daily-brief.ts) only words it.
//
// Rules this keeps (tasks/lessons.md):
//   4.  A day with no step count is UNKNOWN, never zero and never a miss.
//   22. A day is only counted once it is over. The Garmin sync runs overnight
//       and also reads "today", so today's count is a few hours old at best;
//       judging it against the goal would call every morning a failure. Only
//       days BEFORE today are used.

import type { WellnessRecord } from '@/types';

/** A brisk walk is about this many steps a minute. A planning figure, stated wherever it is used. */
export const STEPS_PER_MINUTE = 100;
/** How far back the weekday pattern looks: eight full weeks. */
export const PROFILE_DAYS = 56;
/** A weekday needs this many days of history before it is called out. */
export const MIN_WEEKDAY_SAMPLES = 4;
/** Share of the goal that is a sensible pace at each checkpoint — a rule of thumb, not a measurement. */
export const CHECKPOINTS: { time: string; share: number }[] = [
  { time: '12:00', share: 0.30 }, { time: '15:00', share: 0.60 }, { time: '18:00', share: 0.85 },
];

const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday first, the order people read a week in. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export interface WeekdayStats {
  weekday: number;        // 0 = Sunday
  name: string;
  n: number;              // days with a count
  mean: number | null;
  hits: number;           // days at or above the goal
}

export interface LatestDay { date: string; steps: number; hit: boolean; gap: number }

export interface StepCoach {
  goal: number;
  /** Newest finished day that has a count. Null when there is none. */
  asOf: string | null;
  /** The newest count is older than yesterday, so the sync has fallen behind. */
  stale: boolean;
  latest: LatestDay | null;
  last7: { n: number; hits: number; avg: number | null };
  previous7: { n: number; avg: number | null };
  trend: 'up' | 'down' | 'flat' | null;
  /** Consecutive finished days at or above the goal, counting back from yesterday. */
  streak: number;
  /** Median steps short of the goal on the days it was missed, over the last 28 days. */
  medianShortfall: number | null;
  weekdays: WeekdayStats[];
  weekdayAvg: { weekdays: number | null; weekend: number | null };
  /** The weekday with the lowest average, if it has enough history. */
  weakest: WeekdayStats | null;
  today: {
    date: string;
    name: string;
    usual: number | null;
    hitsOnThisWeekday: number;
    samples: number;
    extraNeeded: number | null;
    walkMinutes: number | null;
    checkpoints: { time: string; steps: number }[];
  };
  /** The last 14 finished days, oldest first. steps is null for a day with no count. */
  recent: { date: string; steps: number | null }[];
  /** One short paragraph, ready to show or to hand to the brief. */
  nudge: string;
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
const round = (v: number, to = 1) => Math.round(v / to) * to;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function stepCoach(input: { wellness: WellnessRecord[]; goal: number; today: string }): StepCoach {
  const goal = Number.isFinite(input.goal) && input.goal > 0 ? Math.round(input.goal) : 10000;
  const today = input.today;

  // Finished days only, with a real count. Both date shapes are accepted.
  const steps = new Map<string, number>();
  for (const w of input.wellness) {
    const day = String(w.date).slice(0, 10);
    const v = w.steps;
    if (day < today && typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 100_000) steps.set(day, v);
  }
  const days = [...steps.keys()].sort();
  const asOf = days.length ? days[days.length - 1] : null;
  const yesterday = addDays(today, -1);

  const inWindow = (from: number, to: number) => {
    // `from`/`to` count days back from today: (1, 7) is yesterday back to seven days ago.
    const out: { day: string; steps: number }[] = [];
    for (let k = from; k <= to; k++) {
      const day = addDays(today, -k);
      const v = steps.get(day);
      if (v !== undefined) out.push({ day, steps: v });
    }
    return out;
  };

  const w7 = inWindow(1, 7);
  const p7 = inWindow(8, 14);
  const last7 = { n: w7.length, hits: w7.filter(d => d.steps >= goal).length, avg: mean(w7.map(d => d.steps)) };
  const previous7 = { n: p7.length, avg: mean(p7.map(d => d.steps)) };
  let trend: StepCoach['trend'] = null;
  if (last7.avg != null && previous7.avg != null && last7.n >= 4 && previous7.n >= 4) {
    const change = (last7.avg - previous7.avg) / previous7.avg;
    trend = change >= 0.1 ? 'up' : change <= -0.1 ? 'down' : 'flat';
  }

  let streak = 0;
  for (let k = 1; ; k++) {
    const v = steps.get(addDays(today, -k));
    if (v === undefined || v < goal) break;
    streak++;
  }

  const w28 = inWindow(1, 28);
  const shortfalls = w28.filter(d => d.steps < goal).map(d => goal - d.steps);
  const medianShortfall = median(shortfalls);

  const profile = inWindow(1, PROFILE_DAYS);
  const weekdays: WeekdayStats[] = WEEK_ORDER.map(wd => {
    const mine = profile.filter(d => weekdayOf(d.day) === wd);
    const m = mean(mine.map(d => d.steps));
    return { weekday: wd, name: NAMES[wd], n: mine.length, mean: m == null ? null : Math.round(m), hits: mine.filter(d => d.steps >= goal).length };
  });
  const avgOf = (pick: (wd: number) => boolean) => {
    const m = mean(profile.filter(d => pick(weekdayOf(d.day))).map(d => d.steps));
    return m == null ? null : Math.round(m);
  };
  const weekdayAvg = { weekdays: avgOf(wd => wd >= 1 && wd <= 5), weekend: avgOf(wd => wd === 0 || wd === 6) };
  const eligible = weekdays.filter(w => w.n >= MIN_WEEKDAY_SAMPLES && w.mean != null);
  const weakest = eligible.length ? eligible.reduce((a, b) => (b.mean! < a.mean! ? b : a)) : null;

  const todayWd = weekdayOf(today);
  const mine = weekdays.find(w => w.weekday === todayWd)!;
  const usual = mine.n >= MIN_WEEKDAY_SAMPLES ? mine.mean : null;
  const extraNeeded = usual == null ? null : Math.max(0, goal - usual);
  const walkMinutes = extraNeeded == null ? null : extraNeeded === 0 ? 0 : Math.max(5, round(extraNeeded / STEPS_PER_MINUTE, 5));
  const todayBlock: StepCoach['today'] = {
    date: today, name: NAMES[todayWd], usual, hitsOnThisWeekday: mine.hits, samples: mine.n, extraNeeded, walkMinutes,
    checkpoints: CHECKPOINTS.map(c => ({ time: c.time, steps: round(goal * c.share, 100) })),
  };

  const latest: LatestDay | null = asOf ? { date: asOf, steps: steps.get(asOf)!, hit: steps.get(asOf)! >= goal, gap: goal - steps.get(asOf)! } : null;
  const stale = asOf != null && asOf < yesterday;

  // ── The nudge: facts first, one concrete thing to do ──
  const parts: string[] = [];
  if (!latest) {
    parts.push('There is no step history yet, so there is nothing to coach from.');
  } else {
    const when = latest.date === yesterday ? 'Yesterday' : `On ${latest.date}`;
    parts.push(latest.hit
      ? `${when} you reached the goal with ${fmt(latest.steps)} steps.`
      : `${when} you did ${fmt(latest.steps)} steps, ${fmt(latest.gap)} short of ${fmt(goal)}.`);
    if (stale) parts.push(`That is the newest count, so the sync is behind; what follows rests on your usual pattern.`);
  }
  if (streak >= 3) parts.push(`That is ${streak} days in a row at or above the goal.`);
  if (usual != null) {
    if (usual >= goal) {
      parts.push(`${todayBlock.name}s are usually fine for you (about ${fmt(usual)} steps): keep your routine.`);
    } else {
      parts.push(
        `${todayBlock.name}s are harder: you average ${fmt(usual)} and reached the goal ${mine.hits} of the last ${mine.n}. ` +
        `About ${walkMinutes} minutes of brisk walking on top of your usual day (roughly ${fmt(extraNeeded!)} steps) gets you there.`);
    }
  }
  if (weekdayAvg.weekdays != null && weekdayAvg.weekend != null && weekdayAvg.weekdays < goal && weekdayAvg.weekend >= goal) {
    parts.push(`Your weekends clear the goal (${fmt(weekdayAvg.weekend)} on average) and your weekdays do not (${fmt(weekdayAvg.weekdays)}): the gap is a weekday habit, not a fitness limit.`);
  }

  return {
    goal, asOf, stale, latest, last7, previous7, trend, streak, medianShortfall, weekdays, weekdayAvg, weakest,
    today: todayBlock,
    recent: Array.from({ length: 14 }, (_, i) => { const date = addDays(today, -(14 - i)); return { date, steps: steps.get(date) ?? null }; }),
    nudge: parts.join(' '),
  };
}
