/**
 * Does crossing timezones show up in recovery data?
 *
 * The method, and why it differs from the food & drink analysis:
 *
 * 1. PER-TRIP BASELINE. Absolute HRV drifts over a year with fitness and
 *    season, so comparing a January trip's numbers against an August trip's
 *    would measure the calendar. Each circadian event is scored against the
 *    14 days immediately before it, and only DEVIATIONS are pooled.
 *
 * 2. ALIGNED ON ARRIVAL. Every trip is indexed by days-since-arrival, so the
 *    shape of the dip and the return to baseline is visible. A single
 *    before/after average would hide exactly the thing being looked for.
 *
 * 3. SPLIT BY DIRECTION. East and west are different physiology and must never
 *    be pooled — doing so cancels them out and shows "no effect".
 *
 * As with the nutrition analysis: observational, n-of-1, association not proof,
 * and every number carries its sample size.
 */

import {
  type TravelLog, type CircadianEvent, type ShiftDirection,
  circadianEvents, addDays, daysBetween,
} from './travel';
import type { DayMetrics, OutcomeDef } from './nutrition-analysis';
import { mean, stdDev, MIN_BUCKET_N } from './nutrition-analysis';

export { MIN_BUCKET_N };

/** Days before departure used as that trip's own reference level. */
export const BASELINE_DAYS = 14;

/** Offsets charted around arrival: three days before, two weeks after. */
export const CURVE_FROM = -3;
export const CURVE_TO = 14;

/**
 * Mean of an outcome over the days before an event — that trip's own normal.
 * Null when too little data exists to establish one, in which case the trip is
 * excluded rather than scored against a guess.
 */
export function baselineBefore(
  eventDate: string,
  metricsByDate: Map<string, DayMetrics>,
  outcome: OutcomeDef,
  days = BASELINE_DAYS,
): number | null {
  const values: number[] = [];
  for (let i = 1; i <= days; i++) {
    const v = metricsByDate.get(addDays(eventDate, -i))?.[outcome.key];
    if (v != null) values.push(v);
  }
  // Fewer than 4 readings is not a baseline, it is noise.
  return values.length >= 4 ? mean(values) : null;
}

export interface CurvePoint {
  offset: number;          // days since arrival; 0 = arrival day
  deviation: number | null; // mean deviation from each trip's own baseline
  n: number;
  unreliable: boolean;
}

export interface RecoveryCurve {
  direction: ShiftDirection;
  outcome: OutcomeDef;
  points: CurvePoint[];
  trips: number;
  /** Mean signed zones across contributing events, for labelling. */
  avgZones: number | null;
}

/**
 * Average deviation-from-baseline at each day relative to arrival, pooled
 * across every event in one direction.
 */
export function recoveryCurve(
  events: CircadianEvent[],
  metricsByDate: Map<string, DayMetrics>,
  outcome: OutcomeDef,
  direction: ShiftDirection,
): RecoveryCurve {
  const matching = events.filter(e => e.direction === direction);
  const buckets = new Map<number, number[]>();
  let contributing = 0;
  const zonesList: number[] = [];

  for (const e of matching) {
    const base = baselineBefore(e.date, metricsByDate, outcome);
    if (base == null) continue;        // no reference level — skip, never guess
    contributing++;
    zonesList.push(e.zones);

    for (let off = CURVE_FROM; off <= CURVE_TO; off++) {
      const v = metricsByDate.get(addDays(e.date, off))?.[outcome.key];
      if (v == null) continue;
      const arr = buckets.get(off) ?? [];
      arr.push(v - base);
      buckets.set(off, arr);
    }
  }

  const points: CurvePoint[] = [];
  for (let off = CURVE_FROM; off <= CURVE_TO; off++) {
    const arr = buckets.get(off) ?? [];
    points.push({
      offset: off,
      deviation: arr.length ? mean(arr) : null,
      n: arr.length,
      unreliable: arr.length > 0 && arr.length < MIN_BUCKET_N,
    });
  }

  return {
    direction,
    outcome,
    points,
    trips: contributing,
    avgZones: zonesList.length ? mean(zonesList) : null,
  };
}

export interface TripImpact {
  event: CircadianEvent;
  baseline: number | null;
  /** Largest adverse deviation in the days after arrival. */
  worstDeviation: number | null;
  worstOffset: number | null;
  /** First offset at which the metric returned within 5% of baseline. */
  recoveredAfterDays: number | null;
}

/**
 * Per-trip summary: how far the metric moved, and when it came back.
 *
 * "Recovered" means within 5% of that trip's own baseline, sustained — a single
 * day touching baseline during an otherwise disrupted week is noise, so the
 * next day must hold too.
 */
export function tripImpact(
  event: CircadianEvent,
  metricsByDate: Map<string, DayMetrics>,
  outcome: OutcomeDef,
  /**
   * Date of the next circadian event, if one falls inside this window. Trips
   * closer together than CURVE_TO days otherwise overlap, and the later trip's
   * dip gets attributed to the earlier one as well — inflating small trips and
   * flattening any dose-response. The window stops the day before the next shift.
   */
  nextEventDate?: string | null,
): TripImpact {
  const base = baselineBefore(event.date, metricsByDate, outcome);
  if (base == null) {
    return { event, baseline: null, worstDeviation: null, worstOffset: null, recoveredAfterDays: null };
  }

  const limit = nextEventDate
    ? Math.min(CURVE_TO, Math.max(0, daysBetween(event.date, nextEventDate) - 1))
    : CURVE_TO;

  const adverse = (d: number) => (outcome.higherIsBetter ? -d : d);
  let worst: number | null = null;
  let worstOffset: number | null = null;
  const within: Record<number, boolean> = {};

  for (let off = 0; off <= limit; off++) {
    const v = metricsByDate.get(addDays(event.date, off))?.[outcome.key];
    if (v == null) continue;
    const dev = v - base;
    if (worst == null || adverse(dev) > adverse(worst)) { worst = dev; worstOffset = off; }
    within[off] = Math.abs(dev) <= Math.abs(base) * 0.05;
  }

  let recovered: number | null = null;
  for (let off = 1; off < limit; off++) {
    if (within[off] && within[off + 1]) { recovered = off; break; }
  }

  return { event, baseline: base, worstDeviation: worst, worstOffset, recoveredAfterDays: recovered };
}

/**
 * Impacts for a whole set of events, each window truncated at the next shift.
 * Always prefer this over calling tripImpact directly on a list — otherwise
 * back-to-back trips contaminate each other.
 */
export function tripImpacts(
  events: CircadianEvent[],
  metricsByDate: Map<string, DayMetrics>,
  outcome: OutcomeDef,
): TripImpact[] {
  const ordered = [...events].sort((a, b) => a.date.localeCompare(b.date));
  return ordered.map((e, i) => tripImpact(e, metricsByDate, outcome, ordered[i + 1]?.date ?? null));
}

export interface ZoneDoseBucket {
  label: string;
  direction: ShiftDirection;
  n: number;
  meanWorstDeviation: number | null;
  meanRecoveryDays: number | null;
  unreliable: boolean;
}

/**
 * Dose-response on zones crossed, kept separate by direction. Pooling the two
 * would let an eastward dip cancel a westward one and report nothing.
 */
export function zoneDoseResponse(
  events: CircadianEvent[],
  metricsByDate: Map<string, DayMetrics>,
  outcome: OutcomeDef,
): ZoneDoseBucket[] {
  const bands: { label: string; min: number; max: number }[] = [
    { label: '1–2', min: 1, max: 2 },
    { label: '3–5', min: 3, max: 5 },
    { label: '6+',  min: 6, max: Infinity },
  ];
  const out: ZoneDoseBucket[] = [];

  for (const direction of ['east', 'west'] as const) {
    for (const band of bands) {
      const matching = events.filter(e => {
        const m = Math.abs(e.zones);
        return e.direction === direction && m >= band.min && m <= band.max;
      });
      const matchKeys = new Set(matching.map(e => `${e.date}|${e.leg}`));
      const impacts = tripImpacts(events, metricsByDate, outcome)
        .filter(i => matchKeys.has(`${i.event.date}|${i.event.leg}`) && i.baseline != null);
      const devs = impacts.map(i => i.worstDeviation).filter((v): v is number => v != null);
      const recs = impacts.map(i => i.recoveredAfterDays).filter((v): v is number => v != null);

      if (impacts.length === 0) continue;
      out.push({
        label: `${band.label} ${direction}`,
        direction,
        n: impacts.length,
        meanWorstDeviation: devs.length ? mean(devs) : null,
        meanRecoveryDays: recs.length ? mean(recs) : null,
        unreliable: impacts.length < MIN_BUCKET_N,
      });
    }
  }
  return out;
}

export interface TravelKpis {
  trips: number;
  daysAway: number;
  daysAwayPct: number;
  totalZonesCrossed: number;
  maxZones: number;
  eastTrips: number;
  westTrips: number;
  /** Days estimated to have been spent mid-adaptation. */
  daysInTransition: number;
  workTrips: number;
}

/**
 * Headline numbers for the period. daysInTransition uses the expected
 * adaptation window per event, capped at the next event so overlapping trips
 * are never double-counted.
 */
export function travelKpis(
  trips: TravelLog[],
  periodStart: string,
  today: string,
): TravelKpis {
  const inPeriod = trips.filter(t => (t.return_date ?? today) >= periodStart);
  const periodDays = Math.max(1, daysBetween(periodStart, today) + 1);

  const awayDates = new Set<string>();
  for (const t of inPeriod) {
    const end = t.return_date ?? today;
    const n = daysBetween(t.depart_date, end);
    for (let i = 0; i <= n; i++) {
      const d = addDays(t.depart_date, i);
      if (d >= periodStart && d <= today) awayDates.add(d);
    }
  }

  const events = inPeriod.flatMap(circadianEvents)
    .filter(e => e.date >= periodStart && e.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const transition = new Set<string>();
  events.forEach((e, i) => {
    const next = events[i + 1];
    const span = Math.ceil(e.adaptationDays);
    for (let off = 0; off < span; off++) {
      const d = addDays(e.date, off);
      if (next && d >= next.date) break;     // next shift takes over
      if (d >= periodStart && d <= today) transition.add(d);
    }
  });

  const zoneMagnitudes = events.map(e => Math.abs(e.zones));

  return {
    trips: inPeriod.length,
    daysAway: awayDates.size,
    daysAwayPct: Math.round((awayDates.size / periodDays) * 100),
    totalZonesCrossed: zoneMagnitudes.reduce((s, v) => s + v, 0),
    maxZones: zoneMagnitudes.length ? Math.max(...zoneMagnitudes) : 0,
    eastTrips: events.filter(e => e.direction === 'east' && e.leg === 'outbound').length,
    westTrips: events.filter(e => e.direction === 'west' && e.leg === 'outbound').length,
    daysInTransition: transition.size,
    workTrips: inPeriod.filter(t => t.purpose === 'work').length,
  };
}

/**
 * Pearson correlation. Null when there is no variance on either side (a
 * constant series correlates with nothing) or fewer than 3 pairs.
 */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n))!;
  const my = mean(ys.slice(0, n))!;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/**
 * Two-sided significance of a correlation, via the t approximation
 * t = r * sqrt((n-2)/(1-r^2)) with n-2 degrees of freedom.
 *
 * Returned as a coarse band rather than an exact p-value: with a handful of
 * trips, a precise-looking p would imply far more confidence than the data
 * supports. The bands are what actually changes a decision.
 */
export type Significance = 'likely real' | 'suggestive' | 'not distinguishable from chance';

export function significanceOf(r: number | null, n: number): Significance {
  if (r == null || n < 3) return 'not distinguishable from chance';
  const r2 = r * r;
  if (r2 >= 1) return 'likely real';
  const t = Math.abs(r) * Math.sqrt((n - 2) / (1 - r2));
  // Critical t at ~0.05 and ~0.10 two-sided, interpolated conservatively for
  // the small samples this will realistically see.
  const df = n - 2;
  const t05 = df <= 2 ? 4.30 : df <= 4 ? 2.78 : df <= 8 ? 2.31 : df <= 15 ? 2.13 : 2.0;
  const t10 = df <= 2 ? 2.92 : df <= 4 ? 2.13 : df <= 8 ? 1.86 : df <= 15 ? 1.75 : 1.67;
  if (t >= t05) return 'likely real';
  if (t >= t10) return 'suggestive';
  return 'not distinguishable from chance';
}

export interface ZoneCorrelation {
  outcome: OutcomeDef;
  direction: ShiftDirection | 'all';
  /** r between zones crossed and the adverse deviation on that trip. */
  r: number | null;
  significance: Significance;
  n: number;
  /** Slope: outcome units of damage per extra zone crossed. */
  perZone: number | null;
}

/**
 * Does crossing MORE zones hurt more? Correlates zone count against each trip's
 * worst adverse deviation.
 *
 * Deviation is converted to "damage" (positive = worse) first, so a positive r
 * always reads as "more zones, more harm" regardless of whether the underlying
 * metric is better high or better low.
 *
 * Direction is held constant where asked, because east and west are different
 * physiology; pooling them puts two different slopes through one line.
 */
export function zoneCorrelation(
  events: CircadianEvent[],
  metricsByDate: Map<string, DayMetrics>,
  outcome: OutcomeDef,
  direction: ShiftDirection | 'all' = 'all',
): ZoneCorrelation {
  const matching = direction === 'all'
    ? events.filter(e => e.direction !== 'none')
    : events.filter(e => e.direction === direction);

  const matchKeys = new Set(matching.map(e => `${e.date}|${e.leg}`));
  const zones: number[] = [];
  const damage: number[] = [];
  // Truncation is computed against EVERY event, so a nearby trip that is not
  // part of this direction still correctly ends the window.
  for (const impact of tripImpacts(events, metricsByDate, outcome)) {
    if (!matchKeys.has(`${impact.event.date}|${impact.event.leg}`)) continue;
    if (impact.worstDeviation == null) continue;
    zones.push(Math.abs(impact.event.zones));
    damage.push(outcome.higherIsBetter ? -impact.worstDeviation : impact.worstDeviation);
  }

  const r = pearson(zones, damage);
  // Least-squares slope in outcome units per zone — the actionable number.
  let perZone: number | null = null;
  if (r != null) {
    const mz = mean(zones)!, md = mean(damage)!;
    let num = 0, den = 0;
    for (let i = 0; i < zones.length; i++) {
      num += (zones[i] - mz) * (damage[i] - md);
      den += (zones[i] - mz) ** 2;
    }
    if (den > 0) perZone = num / den;
  }

  return { outcome, direction, r, significance: significanceOf(r, zones.length), n: zones.length, perZone };
}

/**
 * Overall cost of travel on one metric: mean deviation across all post-arrival
 * days within the expected adaptation window, versus each trip's own baseline.
 */
export function travelEffect(
  events: CircadianEvent[],
  metricsByDate: Map<string, DayMetrics>,
  outcome: OutcomeDef,
  direction?: ShiftDirection,
): { delta: number | null; d: number | null; n: number; unreliable: boolean } {
  const matching = direction ? events.filter(e => e.direction === direction) : events;
  const deviations: number[] = [];

  for (const e of matching) {
    const base = baselineBefore(e.date, metricsByDate, outcome);
    if (base == null) continue;
    const span = Math.max(1, Math.ceil(e.adaptationDays));
    for (let off = 0; off < span; off++) {
      const v = metricsByDate.get(addDays(e.date, off))?.[outcome.key];
      if (v != null) deviations.push(v - base);
    }
  }

  const delta = deviations.length ? mean(deviations) : null;
  const sd = stdDev(deviations);
  return {
    delta,
    d: delta != null && sd != null && sd > 0 ? delta / sd : null,
    n: deviations.length,
    unreliable: deviations.length < MIN_BUCKET_N,
  };
}
