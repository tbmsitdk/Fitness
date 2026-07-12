export type MaxHrLookup = (date: string | Date) => number;

// Minimal shape — anything with a date and a recorded max HR works (full
// Activity objects or bare {date, max_hr} rows from a slim SQL query).
export interface HrReading {
  date: string;
  max_hr: number | null;
}

const YEAR_MS = 365 * 86400 * 1000;

/**
 * Rolling measured max HR — the same formula Settings uses for "measured max HR"
 * (average of the 3 highest recorded activity heart rates in the last year),
 * but evaluated at any point in time: for a given date, only the 365 days
 * BEFORE that date count. This makes HR zones age with you instead of applying
 * today's max HR to years-old workouts.
 *
 * Falls back to `fallback` (settings/age-derived max HR) when a date has no
 * plausible readings in its window.
 */
export function buildMaxHrLookup(allActivities: HrReading[], fallback: number): MaxHrLookup {
  const readings = allActivities
    .filter(a => a.max_hr != null && a.max_hr > 100 && a.max_hr < 230)
    .map(a => ({ t: new Date(a.date).getTime(), hr: a.max_hr as number }))
    .sort((a, b) => a.t - b.t);

  return (date) => {
    const t = (date instanceof Date ? date : new Date(date)).getTime();
    if (!isFinite(t) || readings.length === 0) return fallback;
    const lo = t - YEAR_MS;

    // Top 3 readings within (t - 1y, t] — kept as a sorted-ascending triple
    const top: number[] = [];
    for (const r of readings) {
      if (r.t > t) break;
      if (r.t <= lo) continue;
      if (top.length < 3) {
        top.push(r.hr);
        top.sort((a, b) => a - b);
      } else if (r.hr > top[0]) {
        top[0] = r.hr;
        top.sort((a, b) => a - b);
      }
    }
    if (top.length === 0) return fallback;
    return Math.round(top.reduce((s, v) => s + v, 0) / top.length);
  };
}
