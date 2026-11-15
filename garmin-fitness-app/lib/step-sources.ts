// Which device's step count wins.
//
//   1. GARMIN is the master. Whatever the Garmin band recorded stands.
//   2. The iPHONE fills in only where Garmin recorded nothing: the band was on
//      its charger, or not worn. Steps are never added up across devices — that
//      counted one walk two or three times and read 10,762 a day against
//      Garmin's own 8,030 (tasks/lessons.md 27).
//   3. Anything else that writes steps into Apple Health (an Apple Watch, other
//      apps) is ignored.
//
// Two places apply the rule:
//   - Inside an Apple Health export, per 15-minute slice (mergeDaySteps): the
//     Garmin records (Garmin Connect writes into Health) are the master and the
//     iPhone fills the slices Garmin left empty.
//   - Across imports, per day (deriveSteps): the Garmin sync's total outranks the
//     export's, whichever arrived first.

export type SourceClass = 'garmin' | 'phone' | 'other';

// Garmin Connect writes into Health under the name "Connect"; devices may also
// appear under their own names.
const GARMIN = /garmin|^connect$|vivo|vívo|forerunner|fenix|venu|instinct/i;
const PHONE = /iphone/i;

export function classifySource(name: string): SourceClass {
  if (GARMIN.test(name)) return 'garmin';
  if (PHONE.test(name)) return 'phone';
  return 'other';
}

export const SLICE_MINUTES = 15;
export const SLICES_PER_DAY = 96;

/** One step record from an export, placed on its day as minutes after midnight. */
export interface StepRecord {
  source: string;
  startMin: number;
  endMin: number;
  value: number;
}

/** Spreads a record's steps over the 15-minute slices it covers, in proportion to the overlap. */
function spread(into: number[], r: StepRecord): void {
  if (!(r.value > 0)) return;
  const start = Math.min(1440, Math.max(0, r.startMin));
  const end = Math.min(1440, Math.max(0, r.endMin));
  if (end <= start) {
    into[Math.min(SLICES_PER_DAY - 1, Math.floor(start / SLICE_MINUTES))] += r.value;
    return;
  }
  const span = end - start;
  for (let s = Math.floor(start / SLICE_MINUTES); s < SLICES_PER_DAY && s * SLICE_MINUTES < end; s++) {
    const overlap = Math.min(end, (s + 1) * SLICE_MINUTES) - Math.max(start, s * SLICE_MINUTES);
    if (overlap > 0) into[s] += (r.value * overlap) / span;
  }
}

export interface DaySteps {
  /** The day's steps from the export alone: Garmin's, plus the phone's in Garmin's gaps. Null if neither recorded any. */
  merged: number | null;
  /**
   * Phone steps in slices where Garmin recorded nothing. Null when the export
   * has no Garmin records for the day, because then there is no map of where
   * the gaps are.
   */
  fill: number | null;
  /** Garmin's total inside the export: the reference the gaps were found against. */
  garminInHealth: number | null;
}

/** Resolves one day's step records into a single figure under the rule above. */
export function mergeDaySteps(records: StepRecord[]): DaySteps {
  const garmin = new Array<number>(SLICES_PER_DAY).fill(0);
  const phone = new Array<number>(SLICES_PER_DAY).fill(0);
  for (const r of records) {
    const cls = classifySource(r.source);
    if (cls === 'garmin') spread(garmin, r);
    else if (cls === 'phone') spread(phone, r);
  }
  const g = garmin.reduce((s, v) => s + v, 0);
  const p = phone.reduce((s, v) => s + v, 0);

  if (g > 0) {
    // Garmin is the master. The phone counts only where Garmin has nothing at all.
    const gap = phone.reduce((s, v, i) => (garmin[i] <= 0 ? s + v : s), 0);
    return { merged: Math.round(g + gap), fill: Math.round(gap), garminInHealth: Math.round(g) };
  }
  if (p > 0) return { merged: Math.round(p), fill: null, garminInHealth: null };
  return { merged: null, fill: null, garminInHealth: null };
}

/**
 * The fill is trusted only if Garmin's two accounts of the day agree. The
 * export's Garmin records are the map of where the gaps are; if their total is
 * far from the Garmin sync's own total, the map is incomplete and "gaps" may
 * hold steps Garmin did record, which the phone's would then count again.
 */
export const FILL_TOLERANCE = 0.2;

export interface StepParts {
  /** Garmin's own total for the day (the sync, or a Garmin export). */
  garmin: number | null;
  /** The Apple Health export's figure: used only when Garmin has nothing. */
  apple: number | null;
  /** Phone steps in Garmin's gaps, from the export. */
  fill: number | null;
  /** Garmin's total as the export saw it. */
  fillRef: number | null;
}

/** The day's step count. The SQL in lib/wellness-upsert.ts must say exactly the same. */
export function deriveSteps(p: StepParts): number | null {
  if (p.garmin != null) {
    const consistent = p.fill != null && p.fillRef != null && Math.abs(p.garmin - p.fillRef) <= FILL_TOLERANCE * p.garmin;
    return p.garmin + (consistent ? (p.fill as number) : 0);
  }
  return p.apple;
}
