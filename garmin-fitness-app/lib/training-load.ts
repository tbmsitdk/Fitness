import { Activity, TrainingLoad, WeeklyVolume, HRZoneData, PersonalBest, ConsistencyData } from '@/types';
import { format, startOfWeek, eachWeekOfInterval, subDays, parseISO, isValid } from 'date-fns';

// Estimate TSS when not provided by Garmin
function estimateTSS(activity: Activity, thresholdHR = 165): number {
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
const HR_ZONES = [
  { zone: 'Zone 1 (Recovery)', minPct: 0, maxPct: 0.60 },
  { zone: 'Zone 2 (Aerobic)', minPct: 0.60, maxPct: 0.70 },
  { zone: 'Zone 3 (Tempo)', minPct: 0.70, maxPct: 0.80 },
  { zone: 'Zone 4 (Threshold)', minPct: 0.80, maxPct: 0.90 },
  { zone: 'Zone 5 (VO2max)', minPct: 0.90, maxPct: 1.10 },
];

export function computeHRZoneDistribution(activities: Activity[], maxHR: number = 190): HRZoneData[] {
  // We can only estimate zone from avg HR — real zone computation needs HR stream data
  // We approximate by placing the entire session in the zone matching avg HR
  const zoneMins = new Array(5).fill(0);

  for (const a of activities) {
    if (!a.avg_hr || a.duration_seconds === 0) continue;
    const pct = a.avg_hr / maxHR;
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

export function computePersonalBests(activities: Activity[]): PersonalBest[] {
  const bests: PersonalBest[] = [];
  const runs = activities.filter(a => a.activity_type === 'running' && a.distance_km > 0);
  const rides = activities.filter(a => a.activity_type === 'cycling' && a.distance_km > 0);

  // Fastest 5K (paced run ≥ 5km)
  const sub5ks = runs.filter(a => a.distance_km >= 4.8 && a.distance_km <= 5.5);
  if (sub5ks.length > 0) {
    const fastest = sub5ks.reduce((best, a) => {
      const pace = a.duration_seconds / a.distance_km;
      const bestPace = best.duration_seconds / best.distance_km;
      return pace < bestPace ? a : best;
    });
    const paceStr = formatPace(fastest.duration_seconds / fastest.distance_km);
    bests.push({ label: 'Fastest 5K pace', value: paceStr + '/km', date: new Date(fastest.date).toISOString().split('T')[0], activity_type: 'running' });
  }

  // Fastest 10K
  const sub10ks = runs.filter(a => a.distance_km >= 9.5 && a.distance_km <= 11);
  if (sub10ks.length > 0) {
    const fastest = sub10ks.reduce((best, a) => {
      const pace = a.duration_seconds / a.distance_km;
      return pace < best.duration_seconds / best.distance_km ? a : best;
    });
    const paceStr = formatPace(fastest.duration_seconds / fastest.distance_km);
    bests.push({ label: 'Fastest 10K pace', value: paceStr + '/km', date: new Date(fastest.date).toISOString().split('T')[0], activity_type: 'running' });
  }

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
  const withPower = rides.filter(a => (a.avg_power ?? 0) > 0);
  if (withPower.length > 0) {
    const strongest = withPower.reduce((best, a) => (a.avg_power ?? 0) > (best.avg_power ?? 0) ? a : best);
    bests.push({ label: 'Peak avg power (ride)', value: `${strongest.avg_power} W`, date: new Date(strongest.date).toISOString().split('T')[0], activity_type: 'cycling' });
  }

  // Highest calorie burn
  const withCal = activities.filter(a => (a.calories ?? 0) > 0);
  if (withCal.length > 0) {
    const max = withCal.reduce((best, a) => (a.calories ?? 0) > (best.calories ?? 0) ? a : best);
    bests.push({ label: 'Most calories burned', value: `${max.calories} kcal`, date: new Date(max.date).toISOString().split('T')[0], activity_type: max.activity_type });
  }

  return bests.slice(0, 8);
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
