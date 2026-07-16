import { Activity, TrainingLoad, WeeklyVolume, HRZoneData, PersonalBest, ConsistencyData } from '@/types';
import { format, startOfWeek, eachWeekOfInterval, subDays, parseISO, isValid } from 'date-fns';

// Drop cycling activities whose avg power is below the user's recovery-ride threshold,
// so they don't drag down power curve / EF / power zones / FTP progression / power PRs.
// Non-cycling activities and rides without a threshold are always kept.
export function filterCyclingByPower(activities: Activity[], minCyclingPower: number | null | undefined): Activity[] {
  if (minCyclingPower == null || minCyclingPower <= 0) return activities;
  return activities.filter(a => a.activity_type !== 'cycling' || (a.avg_power ?? 0) >= minCyclingPower);
}

// A genuine training session that adds fatigue — a non-walking activity of at
// least 20 minutes. Casual walks (any length or pace) and trivially short
// sessions are recovery/movement, not training stress. Shared by the training
// heatmap and the daily suggestion so "training" means the same thing everywhere.
export function isTrainingSession(a: Activity): boolean {
  if (a.activity_type === 'walking') return false;
  return (a.duration_seconds ?? 0) >= 1200;
}

// Estimate TSS when not provided by Garmin
export function estimateTSS(activity: Activity, thresholdHR = 165): number {
  if (activity.tss != null && activity.tss > 0) return activity.tss;
  const durationHours = activity.duration_seconds / 3600;
  if (durationHours === 0) return 0;

  // Rough intensity factor based on activity type and HR
  const avgHr = activity.avg_hr ?? 140;
  const hrFraction = avgHr / thresholdHR;
  const intensityFactor = Math.min(hrFraction * 0.9, 1.15);

  return durationHours * intensityFactor * intensityFactor * 100;
}

export function computeTrainingLoad(activities: Activity[], thresholdHR = 165): TrainingLoad[] {
  if (activities.length === 0) return [];

  const sorted = [...activities].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const earliest = parseISO(sorted[0].date);
  const latest = new Date();

  // Build daily TSS map
  const dailyTSS = new Map<string, number>();
  for (const a of sorted) {
    const dateStr = new Date(a.date).toISOString().split('T')[0];
    const tss = estimateTSS(a, thresholdHR);
    dailyTSS.set(dateStr, (dailyTSS.get(dateStr) ?? 0) + tss);
  }

  const result: TrainingLoad[] = [];
  const atl_k = 2 / (7 + 1);   // 7-day EWMA
  const ctl_k = 2 / (42 + 1);  // 42-day EWMA

  let atl = 0;
  let ctl = 0;

  // Iterate from 90 days before first activity to today
  const start = subDays(earliest, 14);
  const current = new Date(start);

  while (current <= latest) {
    const dateStr = format(current, 'yyyy-MM-dd');
    const tss = dailyTSS.get(dateStr) ?? 0;

    atl = atl + atl_k * (tss - atl);
    ctl = ctl + ctl_k * (tss - ctl);

    result.push({
      date: dateStr,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
      daily_tss: Math.round(tss),
    });

    current.setDate(current.getDate() + 1);
  }

  return result;
}

export function computeWeeklyVolume(activities: Activity[], thresholdHR = 165): WeeklyVolume[] {
  if (activities.length === 0) return [];

  const sorted = [...activities].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const earliest = parseISO(sorted[0].date);
  const weeks = eachWeekOfInterval({ start: earliest, end: new Date() }, { weekStartsOn: 1 });

  const weekMap = new Map<string, WeeklyVolume>();
  for (const w of weeks) {
    const key = format(w, 'yyyy-MM-dd');
    weekMap.set(key, {
      week: key,
      running_km: 0, cycling_km: 0, walking_km: 0,
      running_hours: 0, cycling_hours: 0, walking_hours: 0,
      total_tss: 0,
    });
  }

  for (const a of sorted) {
    const weekStart = format(startOfWeek(parseISO(a.date), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const entry = weekMap.get(weekStart);
    if (!entry) continue;
    const hours = a.duration_seconds / 3600;
    const km = a.distance_km;
    const tss = estimateTSS(a, thresholdHR);
    if (a.activity_type === 'running') {
      entry.running_km += km;
      entry.running_hours += hours;
    } else if (a.activity_type === 'cycling') {
      entry.cycling_km += km;
      entry.cycling_hours += hours;
    } else if (a.activity_type === 'walking') {
      entry.walking_km += km;
      entry.walking_hours += hours;
    }
    entry.total_tss += tss;
  }

  return Array.from(weekMap.values()).map(w => ({
    ...w,
    running_km: Math.round(w.running_km * 10) / 10,
    cycling_km: Math.round(w.cycling_km * 10) / 10,
    walking_km: Math.round(w.walking_km * 10) / 10,
    running_hours: Math.round(w.running_hours * 10) / 10,
    cycling_hours: Math.round(w.cycling_hours * 10) / 10,
    walking_hours: Math.round(w.walking_hours * 10) / 10,
    total_tss: Math.round(w.total_tss),
  }));
}

// Garmin 5-zone HR model using % of max HR
export const HR_ZONES = [
  { zone: 'Zone 1 (Recovery)', minPct: 0, maxPct: 0.60 },
  { zone: 'Zone 2 (Aerobic)', minPct: 0.60, maxPct: 0.70 },
  { zone: 'Zone 3 (Tempo)', minPct: 0.70, maxPct: 0.80 },
  { zone: 'Zone 4 (Threshold)', minPct: 0.80, maxPct: 0.90 },
  { zone: 'Zone 5 (VO2max)', minPct: 0.90, maxPct: 1.10 },
];

// maxHR can be a constant or a per-date lookup (rolling measured max HR from
// lib/hr-zones.ts) so zones reflect what your max HR was when the workout happened.
export function computeHRZoneDistribution(
  activities: Activity[],
  maxHR: number | ((date: string) => number) = 190,
): HRZoneData[] {
  // We can only estimate zone from avg HR — real zone computation needs HR stream data
  // We approximate by placing the entire session in the zone matching avg HR
  const zoneMins = new Array(5).fill(0);
  const maxHrFor = typeof maxHR === 'function' ? maxHR : () => maxHR;

  for (const a of activities) {
    if (!a.avg_hr || a.duration_seconds === 0) continue;
    const pct = a.avg_hr / maxHrFor(a.date);
    const mins = a.duration_seconds / 60;
    // Distribution assumption: bell around avg HR spreading ±10% across adjacent zones
    for (let i = 0; i < 5; i++) {
      const zone = HR_ZONES[i];
      if (pct >= zone.minPct && pct < zone.maxPct) {
        // Put 70% in this zone, spread 15% each to neighbours
        zoneMins[i] += mins * 0.70;
        if (i > 0) zoneMins[i - 1] += mins * 0.15;
        if (i < 4) zoneMins[i + 1] += mins * 0.15;
        break;
      }
    }
  }

  const total = zoneMins.reduce((s, v) => s + v, 0) || 1;
  return HR_ZONES.map((z, i) => ({
    zone: z.zone,
    minutes: Math.round(zoneMins[i]),
    percentage: Math.round((zoneMins[i] / total) * 100),
  }));
}

export function computePersonalBests(activities: Activity[], minCyclingPower: number | null = null): PersonalBest[] {
  const bests: PersonalBest[] = [];
  const runs = activities.filter(a => a.activity_type === 'running' && a.distance_km > 0);
  const rides = activities.filter(a => a.activity_type === 'cycling' && a.distance_km > 0);
  // Recovery rides (avg power below threshold) don't count toward power-based PRs
  const powerRides = minCyclingPower != null && minCyclingPower > 0
    ? rides.filter(a => (a.avg_power ?? 0) >= minCyclingPower)
    : rides;

  // Fastest pace for a given target distance (±tolerance), e.g. 1K/5K/10K/Half/Marathon
  function fastestPaceBest(label: string, minKm: number, maxKm: number) {
    const candidates = runs.filter(a => a.distance_km >= minKm && a.distance_km <= maxKm);
    if (candidates.length === 0) return;
    const fastest = candidates.reduce((best, a) => {
      const pace = a.duration_seconds / a.distance_km;
      const bestPace = best.duration_seconds / best.distance_km;
      return pace < bestPace ? a : best;
    });
    const paceStr = formatPace(fastest.duration_seconds / fastest.distance_km);
    bests.push({ label, value: paceStr + '/km', date: new Date(fastest.date).toISOString().split('T')[0], activity_type: 'running' });
  }

  fastestPaceBest('Fastest 1K pace',     0.9,  1.15);
  fastestPaceBest('Fastest 5K pace',     4.8,  5.5);
  fastestPaceBest('Fastest 10K pace',    9.5,  11);
  fastestPaceBest('Fastest Half Marathon pace', 20.5, 22.5);
  fastestPaceBest('Fastest Marathon pace',      40.5, 44);

  // Longest run
  if (runs.length > 0) {
    const longest = runs.reduce((best, a) => a.distance_km > best.distance_km ? a : best);
    bests.push({ label: 'Longest run', value: `${longest.distance_km.toFixed(1)} km`, date: new Date(longest.date).toISOString().split('T')[0], activity_type: 'running' });
  }

  // Longest ride
  if (rides.length > 0) {
    const longest = rides.reduce((best, a) => a.distance_km > best.distance_km ? a : best);
    bests.push({ label: 'Longest ride', value: `${longest.distance_km.toFixed(1)} km`, date: new Date(longest.date).toISOString().split('T')[0], activity_type: 'cycling' });
  }

  // Most elevation in a single activity
  const withElev = activities.filter(a => (a.elevation_gain ?? 0) > 0);
  if (withElev.length > 0) {
    const most = withElev.reduce((best, a) => (a.elevation_gain ?? 0) > (best.elevation_gain ?? 0) ? a : best);
    bests.push({ label: 'Most elevation', value: `${most.elevation_gain?.toFixed(0)} m`, date: new Date(most.date).toISOString().split('T')[0], activity_type: most.activity_type });
  }

  // Highest single-ride avg power
  const withPower = powerRides.filter(a => (a.avg_power ?? 0) > 0);
  if (withPower.length > 0) {
    const strongest = withPower.reduce((best, a) => (a.avg_power ?? 0) > (best.avg_power ?? 0) ? a : best);
    bests.push({ label: 'Peak avg power (ride)', value: `${strongest.avg_power} W`, date: new Date(strongest.date).toISOString().split('T')[0], activity_type: 'cycling' });
  }

  // Highest normalized power (rides ≥ 20 min — short enough efforts skew NP)
  const withNP = powerRides.filter(a => (a.normalized_power ?? 0) > 0 && a.duration_seconds >= 1200);
  if (withNP.length > 0) {
    const strongest = withNP.reduce((best, a) => (a.normalized_power ?? 0) > (best.normalized_power ?? 0) ? a : best);
    bests.push({ label: 'Peak normalized power', value: `${strongest.normalized_power} W`, date: new Date(strongest.date).toISOString().split('T')[0], activity_type: 'cycling' });
  }

  // Best ~1hr effort — highest normalized power among rides 50-70 min (proxy for FTP-style effort)
  const hourRides = powerRides.filter(a => (a.normalized_power ?? 0) > 0 && a.duration_seconds >= 3000 && a.duration_seconds <= 4200);
  if (hourRides.length > 0) {
    const strongest = hourRides.reduce((best, a) => (a.normalized_power ?? 0) > (best.normalized_power ?? 0) ? a : best);
    bests.push({ label: 'Best ~1hr power', value: `${strongest.normalized_power} W`, date: new Date(strongest.date).toISOString().split('T')[0], activity_type: 'cycling' });
  }

  // Highest avg speed for a substantial ride
  const fastRides = rides.filter(a => a.distance_km >= 20 && (a.avg_speed_kmh ?? 0) > 0);
  if (fastRides.length > 0) {
    const fastest = fastRides.reduce((best, a) => (a.avg_speed_kmh ?? 0) > (best.avg_speed_kmh ?? 0) ? a : best);
    bests.push({ label: 'Fastest avg speed (≥20km)', value: `${fastest.avg_speed_kmh?.toFixed(1)} km/h`, date: new Date(fastest.date).toISOString().split('T')[0], activity_type: 'cycling' });
  }

  // Highest calorie burn
  const withCal = activities.filter(a => (a.calories ?? 0) > 0);
  if (withCal.length > 0) {
    const max = withCal.reduce((best, a) => (a.calories ?? 0) > (best.calories ?? 0) ? a : best);
    bests.push({ label: 'Most calories burned', value: `${max.calories} kcal`, date: new Date(max.date).toISOString().split('T')[0], activity_type: max.activity_type });
  }

  return bests;
}

function formatPace(secsPerKm: number): string {
  const mins = Math.floor(secsPerKm / 60);
  const secs = Math.round(secsPerKm % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function computeConsistency(activities: Activity[]): ConsistencyData[] {
  const monthMap = new Map<string, ConsistencyData>();
  const activeDates = new Set<string>();

  for (const a of activities) {
    const d = parseISO(a.date);
    if (!isValid(d)) continue;
    const month = format(d, 'yyyy-MM');
    const dateStr = format(d, 'yyyy-MM-dd');
    activeDates.add(dateStr);

    if (!monthMap.has(month)) {
      monthMap.set(month, { month, active_days: 0, total_days: 0, running_days: 0, cycling_days: 0, walking_days: 0 });
    }
  }

  // Count unique active days per month
  for (const dateStr of activeDates) {
    const d = parseISO(dateStr);
    const month = format(d, 'yyyy-MM');
    const entry = monthMap.get(month);
    if (!entry) continue;
    entry.active_days++;
  }

  // Count total days in month
  for (const [month, entry] of monthMap) {
    const d = parseISO(month + '-01');
    entry.total_days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  }

  // Per-sport active days
  for (const a of activities) {
    const d = parseISO(a.date);
    if (!isValid(d)) continue;
    const month = format(d, 'yyyy-MM');
    const entry = monthMap.get(month);
    if (!entry) continue;
    if (a.activity_type === 'running') entry.running_days = Math.min(entry.running_days + 1, entry.total_days);
    if (a.activity_type === 'cycling') entry.cycling_days = Math.min(entry.cycling_days + 1, entry.total_days);
    if (a.activity_type === 'walking') entry.walking_days = Math.min(entry.walking_days + 1, entry.total_days);
  }

  return Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));
}

export function computePeriodSummary(activities: Activity[], cutoff: Date, thresholdHR = 165) {
  // activities are already filtered to the selected period — no internal re-filter needed
  const period_days = Math.max(1, Math.round((Date.now() - cutoff.getTime()) / 86400000));
  const period_weeks = Math.max(1, period_days / 7);

  const byType = (type: string) => activities.filter(a => a.activity_type === type);
  const totalKm = (acts: Activity[]) => acts.reduce((s, a) => s + a.distance_km, 0);
  const totalHours = (acts: Activity[]) => acts.reduce((s, a) => s + a.duration_seconds / 3600, 0);
  const avgHr = (acts: Activity[]) => {
    const with_hr = acts.filter(a => a.avg_hr != null);
    if (!with_hr.length) return null;
    return Math.round(with_hr.reduce((s, a) => s + (a.avg_hr ?? 0), 0) / with_hr.length);
  };

  const runs = byType('running');
  const rides = byType('cycling');
  const walks = byType('walking');

  const weeklyLoads = computeWeeklyVolume(activities, thresholdHR);
  // Total TSS across the whole period (uses estimated TSS where Garmin didn't provide one)
  const period_tss = Math.round(weeklyLoads.reduce((s, w) => s + w.total_tss, 0));
  const avg_weekly_tss = weeklyLoads.length > 0 ? Math.round(period_tss / weeklyLoads.length) : 0;

  return {
    period_days,
    total_activities: activities.length,
    running: { count: runs.length, km: Math.round(totalKm(runs) * 10) / 10, hours: Math.round(totalHours(runs) * 10) / 10, avg_hr: avgHr(runs) },
    cycling: { count: rides.length, km: Math.round(totalKm(rides) * 10) / 10, hours: Math.round(totalHours(rides) * 10) / 10, avg_hr: avgHr(rides) },
    walking: { count: walks.length, km: Math.round(totalKm(walks) * 10) / 10, hours: Math.round(totalHours(walks) * 10) / 10, avg_hr: avgHr(walks) },
    period_tss,
    avg_weekly_tss,
    avg_weekly_km_run: Math.round((totalKm(runs) / period_weeks) * 10) / 10,
    avg_weekly_km_ride: Math.round((totalKm(rides) / period_weeks) * 10) / 10,
  };
}

/** @deprecated use computePeriodSummary */
export const compute90DaySummary = (activities: Activity[]) =>
  computePeriodSummary(activities, new Date(Date.now() - 90 * 86400000));

export interface EfficiencyFactorPoint {
  date: string;
  ef: number;
  sport: string;
  title: string;
}

export function computeEfficiencyFactor(activities: Activity[]): EfficiencyFactorPoint[] {
  return activities
    .filter(a => {
      if (!a.avg_hr || a.avg_hr < 80) return false;
      if (a.activity_type === 'running') {
        return a.distance_km > 0.5 && a.duration_seconds > 300;
      }
      if (a.activity_type === 'cycling') {
        return (a.avg_power != null || a.normalized_power != null) && a.duration_seconds > 300;
      }
      return false;
    })
    .map(a => {
      let ef: number;
      if (a.activity_type === 'running') {
        // EF = speed (km/min) / avg HR — higher = more aerobically efficient
        const speedKmMin = a.distance_km / (a.duration_seconds / 60);
        ef = speedKmMin / (a.avg_hr as number);
      } else {
        // Cycling EF = normalized power (or avg power) / avg HR
        const power = a.normalized_power ?? a.avg_power ?? 0;
        ef = power / (a.avg_hr as number);
      }
      return {
        date: new Date(a.date).toISOString().split('T')[0],
        ef: Math.round(ef * 10000) / 10000,
        sport: a.activity_type,
        title: a.title || a.activity_type,
      };
    })
    .filter(p => p.ef > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface TrainingLoadForecast extends TrainingLoad {
  projected: boolean;
}

export function computeTrainingLoadWithForecast(
  activities: Activity[],
  thresholdHR = 165,
  forecastDays = 14
): TrainingLoadForecast[] {
  const historical = computeTrainingLoad(activities, thresholdHR);
  if (historical.length === 0) return [];

  // Average daily TSS over the last 7 calendar days (including rest days as 0)
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
  let recentTSS = 0;
  for (const a of activities) {
    if (new Date(a.date) >= sevenDaysAgo) {
      recentTSS += estimateTSS(a, thresholdHR);
    }
  }
  const avgDailyTSS = recentTSS / 7; // per calendar day, not per active day

  const atl_k = 2 / (7 + 1);
  const ctl_k = 2 / (42 + 1);
  let { atl, ctl } = historical[historical.length - 1];

  const result: TrainingLoadForecast[] = historical.map(d => ({ ...d, projected: false }));

  for (let i = 1; i <= forecastDays; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    const dateStr = format(date, 'yyyy-MM-dd');

    atl = atl + atl_k * (avgDailyTSS - atl);
    ctl = ctl + ctl_k * (avgDailyTSS - ctl);
    const tsb = ctl - atl;

    result.push({
      date: dateStr,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      daily_tss: Math.round(avgDailyTSS),
      projected: true,
    });
  }

  return result;
}
