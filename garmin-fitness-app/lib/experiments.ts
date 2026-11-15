// Personal experiments: change one habit for a set period, then compare.
// Pure logic — storage is in lib/experiments-db.ts.
//
// Rules this enforces (tasks/lessons.md):
//   4. A day with no log is UNKNOWN, never "compliant" and never "broken".
//   6. The comparison is weekday-matched: weekend nights against weekend
//      nights, so a habit that lives at weekends is not credited with the lie-in.
//   3. Each outcome carries its own direction.

import type { WellnessRecord } from '@/types';
import type { NutritionLog } from '@/lib/nutrition';
import { dateOnly } from '@/lib/raw-data';

export type RuleType = 'max_per_day' | 'last_food_before' | 'no_late_caffeine' | 'manual';
export type RuleField = 'alcohol_units' | 'candy_portions' | 'savoury_snacks' | 'sugary_drinks' | 'added_sugar_g';
export const RULE_FIELDS: RuleField[] = ['alcohol_units', 'candy_portions', 'savoury_snacks', 'sugary_drinks', 'added_sugar_g'];
export const RULE_FIELD_LABEL: Record<RuleField, string> = {
  alcohol_units: 'alcohol units', candy_portions: 'candy portions',
  savoury_snacks: 'savoury snacks', sugary_drinks: 'sugary drinks', added_sugar_g: 'g of added sugar',
};

export interface ExperimentRule {
  type: RuleType;
  /** max_per_day: which nutrition field, and the most allowed per day (0 = none). */
  field?: RuleField;
  value?: number;
  /** last_food_before: 'HH:MM'. */
  time?: string;
}

export type ExperimentStatus = 'active' | 'completed' | 'abandoned';

export interface Experiment {
  id: number;
  title: string;
  hypothesis: string;
  rule: ExperimentRule;
  /** First and last day the rule applies, inclusive. */
  start_date: string;
  end_date: string;
  status: ExperimentStatus;
  /** Manual yes/no per day, for rules the logs cannot check. */
  checkins: Record<string, boolean>;
  created_at: string;
}

export const MIN_EXPERIMENT_DAYS = 7;
export const MAX_EXPERIMENT_DAYS = 60;
/** Mornings needed in each period, per stratum, before a difference is reported. */
export const MIN_STRATUM_N = 3;
/** Below this many standard deviations a difference is called "no clear change". */
export const CLEAR_CHANGE_SD = 0.3;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000);
}
/** Friday and Saturday nights are followed by a free morning. */
function isWeekendNight(day: string): boolean {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow === 5 || dow === 6;
}

/** Validates a rule from the client or the model. Returns null if it is not usable. */
export function cleanRule(raw: unknown): ExperimentRule | null {
  const r = raw as Partial<ExperimentRule> | null;
  if (!r || typeof r !== 'object') return null;
  switch (r.type) {
    case 'max_per_day': {
      if (!RULE_FIELDS.includes(r.field as RuleField)) return null;
      const value = Number(r.value);
      // Grams of sugar run far higher than a count of drinks or portions.
      if (!Number.isFinite(value) || value < 0 || value > (r.field === 'added_sugar_g' ? 300 : 40)) return null;
      return { type: 'max_per_day', field: r.field, value };
    }
    case 'last_food_before': {
      if (typeof r.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) return null;
      return { type: 'last_food_before', time: r.time };
    }
    case 'no_late_caffeine': return { type: 'no_late_caffeine' };
    case 'manual': return { type: 'manual' };
    default: return null;
  }
}

export function describeRule(rule: ExperimentRule): string {
  switch (rule.type) {
    case 'max_per_day':
      return rule.value === 0 ? `No ${RULE_FIELD_LABEL[rule.field!]}` : `At most ${rule.value} ${RULE_FIELD_LABEL[rule.field!]} a day`;
    case 'last_food_before': return `Last food before ${rule.time}`;
    case 'no_late_caffeine': return 'No caffeine after 14:00';
    case 'manual': return 'Checked off by hand each day';
  }
}

/**
 * Was the rule kept on one day? true / false, or NULL when it cannot be known:
 * no log for the day, or the relevant field left blank.
 */
export function dayCompliance(rule: ExperimentRule, log: NutritionLog | undefined, checkin: boolean | undefined): boolean | null {
  if (rule.type === 'manual') return checkin ?? null;
  if (!log) return null;
  switch (rule.type) {
    case 'max_per_day': {
      const v = log[rule.field!];
      return v == null ? null : v <= (rule.value ?? 0);
    }
    case 'last_food_before': {
      if (!log.last_food_time) return null;
      // Eating after midnight is logged as an early-morning time; that is late, not early.
      const late = log.last_food_time < '05:00';
      return !late && log.last_food_time <= rule.time!;
    }
    case 'no_late_caffeine':
      return log.caffeine_after_14 == null ? null : !log.caffeine_after_14;
  }
}

export interface Adherence {
  /** Days of the experiment that have happened so far (up to today or the end). */
  daysElapsed: number;
  daysTotal: number;
  kept: number;
  broken: number;
  /** Days with nothing to judge by. */
  unknown: number;
  /** kept / (kept + broken), 0-100. Null until at least one day is known. */
  percent: number | null;
  /** The days that were not logged, for a reminder. */
  unknownDays: string[];
}

export function adherence(exp: Experiment, logs: NutritionLog[], today: string): Adherence {
  const byDay = new Map(logs.map(l => [dateOnly(l.date), l]));
  const last = today < exp.end_date ? today : exp.end_date;
  const daysTotal = daysBetween(exp.start_date, exp.end_date) + 1;
  let kept = 0, broken = 0;
  const unknownDays: string[] = [];
  for (let day = exp.start_date; day <= last; day = addDays(day, 1)) {
    const c = dayCompliance(exp.rule, byDay.get(day), exp.checkins[day]);
    if (c === true) kept++; else if (c === false) broken++; else unknownDays.push(day);
  }
  const known = kept + broken;
  return {
    daysElapsed: last < exp.start_date ? 0 : daysBetween(exp.start_date, last) + 1,
    daysTotal, kept, broken, unknown: unknownDays.length,
    percent: known > 0 ? Math.round((kept / known) * 100) : null,
    unknownDays,
  };
}

export interface ExperimentOutcomeDef {
  key: 'resting_hr' | 'stress_score' | 'sleep_score' | 'sleep_hours' | 'body_battery';
  label: string;
  unit: string;
  higherIsBetter: boolean;
}

export const EXPERIMENT_OUTCOMES: ExperimentOutcomeDef[] = [
  { key: 'sleep_score',  label: 'Sleep score',  unit: '',    higherIsBetter: true },
  { key: 'sleep_hours',  label: 'Sleep',        unit: 'h',   higherIsBetter: true },
  { key: 'resting_hr',   label: 'Resting HR',   unit: 'bpm', higherIsBetter: false },
  { key: 'stress_score', label: 'Stress',       unit: '',    higherIsBetter: false },
  { key: 'body_battery', label: 'Body battery', unit: '',    higherIsBetter: true },
];

export type OutcomeVerdict = 'better' | 'worse' | 'no clear change' | 'not enough data';

export interface OutcomeComparison {
  key: ExperimentOutcomeDef['key'];
  label: string;
  unit: string;
  /** Weekday-matched means. Null when there was not enough data. */
  before: number | null;
  during: number | null;
  /** during − before, in the metric's own units and its own sign. */
  change: number | null;
  verdict: OutcomeVerdict;
  nBefore: number;
  nDuring: number;
  /** True when only weekday nights or only weekend nights could be compared. */
  singleStratum: boolean;
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const sd = (v: number[]) => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};

/**
 * Before/during comparison for each recovery outcome.
 *
 * A habit on day D shows up the morning of D+1, so the experiment's mornings
 * run from start+1 to end+1. The baseline is the same number of mornings (at
 * least 14) immediately before. Weekend nights and weekday nights are compared
 * separately and then averaged, so the mix of days cannot drive the result.
 */
export function experimentOutcomes(exp: Experiment, wellness: WellnessRecord[], today: string): OutcomeComparison[] {
  const byDay = new Map(wellness.map(w => [dateOnly(w.date), w]));
  const length = daysBetween(exp.start_date, exp.end_date) + 1;
  const baselineLength = Math.max(14, length);
  const lastNight = today < exp.end_date ? addDays(today, -1) : exp.end_date;

  const nights = (from: string, to: string) => {
    const out: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  };
  const duringNights = lastNight >= exp.start_date ? nights(exp.start_date, lastNight) : [];
  const beforeNights = nights(addDays(exp.start_date, -baselineLength), addDays(exp.start_date, -1));

  return EXPERIMENT_OUTCOMES.map(def => {
    const values = (ns: string[], weekend: boolean) => ns
      .filter(n => isWeekendNight(n) === weekend)
      .map(n => byDay.get(addDays(n, 1))?.[def.key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    const strata = [false, true].map(weekend => ({ before: values(beforeNights, weekend), during: values(duringNights, weekend) }));
    const usable = strata.filter(s => s.before.length >= MIN_STRATUM_N && s.during.length >= MIN_STRATUM_N);
    const nBefore = strata.reduce((s, x) => s + x.before.length, 0);
    const nDuring = strata.reduce((s, x) => s + x.during.length, 0);

    if (usable.length === 0) {
      return { key: def.key, label: def.label, unit: def.unit, before: null, during: null, change: null,
               verdict: 'not enough data' as const, nBefore, nDuring, singleStratum: false };
    }

    // Each stratum counts equally, however many nights it holds.
    const before = mean(usable.map(s => mean(s.before)));
    const during = mean(usable.map(s => mean(s.during)));
    const change = during - before;
    const spread = sd(usable.flatMap(s => s.before));
    const improved = def.higherIsBetter ? change > 0 : change < 0;
    const clear = spread > 0 ? Math.abs(change) / spread >= CLEAR_CHANGE_SD : change !== 0;
    const round = (v: number) => Math.round(v * 100) / 100;

    return {
      key: def.key, label: def.label, unit: def.unit,
      before: round(before), during: round(during), change: round(change),
      verdict: !clear ? 'no clear change' as const : improved ? 'better' as const : 'worse' as const,
      nBefore, nDuring, singleStratum: usable.length === 1,
    };
  });
}

/** Schema for the model's proposals. */
export const PROPOSALS_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title:      { type: 'string', description: 'Short name, e.g. "Two dry weeks".' },
          hypothesis: { type: 'string', description: 'What is expected to change, and by roughly how much.' },
          why:        { type: 'string', description: 'What in the data suggests this is worth testing, with numbers.' },
          rule_type:  { type: 'string', enum: ['max_per_day', 'last_food_before', 'no_late_caffeine', 'manual'] },
          rule_field: { type: 'string', enum: ['alcohol_units', 'candy_portions', 'savoury_snacks', 'sugary_drinks', 'added_sugar_g', 'none'] },
          rule_value: { type: 'number', description: 'max_per_day only: most allowed per day, 0 for none. Otherwise 0.' },
          rule_time:  { type: 'string', description: 'last_food_before only: HH:MM. Otherwise empty.' },
          duration_days: { type: 'integer', description: 'Between 14 and 28 unless there is a reason.' },
        },
        required: ['title', 'hypothesis', 'why', 'rule_type', 'rule_field', 'rule_value', 'rule_time', 'duration_days'],
        additionalProperties: false,
      },
    },
  },
  required: ['proposals'],
  additionalProperties: false,
} as const;

export interface ExperimentProposal {
  title: string;
  hypothesis: string;
  why: string;
  rule: ExperimentRule;
  duration_days: number;
}

/** Turns the model's reply into usable proposals; drops any with an invalid rule. */
export function parseProposals(text: string): ExperimentProposal[] {
  let o: { proposals?: unknown };
  try { o = JSON.parse(text); } catch { throw new Error(`Proposals are not JSON: "${text.slice(0, 120)}"`); }
  const out: ExperimentProposal[] = [];
  for (const p of Array.isArray(o?.proposals) ? o.proposals : []) {
    const x = p as Record<string, unknown>;
    const rule = cleanRule({ type: x.rule_type, field: x.rule_field, value: x.rule_value, time: x.rule_time });
    if (!rule || typeof x.title !== 'string' || !x.title.trim()) continue;
    const days = Number(x.duration_days);
    out.push({
      title: x.title.trim().slice(0, 80),
      hypothesis: typeof x.hypothesis === 'string' ? x.hypothesis.slice(0, 400) : '',
      why: typeof x.why === 'string' ? x.why.slice(0, 600) : '',
      rule,
      duration_days: Number.isFinite(days) ? Math.min(MAX_EXPERIMENT_DAYS, Math.max(MIN_EXPERIMENT_DAYS, Math.round(days))) : 14,
    });
  }
  return out.slice(0, 4);
}

/** What the coach should know about experiments, as a prompt section. Empty when there are none. */
export function experimentsPromptSection(list: { exp: Experiment; adherence: Adherence }[], today: string): string {
  const active = list.filter(x => x.exp.status === 'active');
  const recent = list.filter(x => x.exp.status === 'completed').slice(0, 2);
  if (active.length + recent.length === 0) return '';
  const line = ({ exp, adherence: a }: { exp: Experiment; adherence: Adherence }) => {
    const dayNo = Math.min(a.daysTotal, Math.max(0, daysBetween(exp.start_date, today) + 1));
    const state = exp.status === 'active' ? `day ${dayNo} of ${a.daysTotal}` : `finished ${exp.end_date}`;
    const kept = a.percent === null ? 'no days logged yet' : `rule kept on ${a.kept} of ${a.kept + a.broken} logged days`;
    return `- "${exp.title}" (${describeRule(exp.rule)}; ${exp.start_date} to ${exp.end_date}; ${state}; ${kept}${a.unknown ? `; ${a.unknown} days not logged` : ''}). Hypothesis: ${exp.hypothesis}`;
  };
  return `<experiments>\nPersonal experiments the person is running or has just finished. Encourage logging on the days that are missing, and do not judge the result before the end.\n${[...active, ...recent].map(line).join('\n')}\n</experiments>`;
}

/** The question handed to the deep analysis when an experiment ends. */
export function experimentAnalysisQuestion(exp: Experiment): string {
  return `I ran an experiment called "${exp.title}" from ${exp.start_date} to ${exp.end_date}: ${describeRule(exp.rule)}. My hypothesis: ${exp.hypothesis} Did it work? Compare my recovery during it with the weeks before, matching weekdays, and allow for travel and training load. Check from nutrition.csv how well I kept to the rule.`.slice(0, 600);
}
