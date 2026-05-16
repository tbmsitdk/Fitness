'use client';
import { useMemo, useState } from 'react';
import { Activity, WellnessRecord } from '@/types';
import { computeWeeklyVolume, computeTrainingLoad, computeHRZoneDistribution, computePersonalBests, computeConsistency, computePeriodSummary } from '@/lib/training-load';
import WeeklyVolumeChart from './charts/WeeklyVolumeChart';
import FitnessTrendChart, { WellnessMetric } from './charts/FitnessTrendChart';
import TrainingLoadChart from './charts/TrainingLoadChart';
import HRZoneChart from './charts/HRZoneChart';
import ConsistencyChart from './charts/ConsistencyChart';
import PersonalBests from './charts/PersonalBests';
import StepsChart from './charts/StepsChart';
import PowerChart from './charts/PowerChart';
import PowerZonesChart from './charts/PowerZonesChart';
import CaloriesChart from './charts/CaloriesChart';
import CadenceChart from './charts/CadenceChart';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { UserSettings, getAge, getMaxHR, getThresholdHR, DEFAULT_SETTINGS } from '@/lib/settings';
import ExpandableCard from '@/components/ExpandableCard';

interface Props {
  activities: Activity[];
  allActivities: Activity[];   // full history for CTL/ATL EWMA accuracy
  wellness: WellnessRecord[];
  allWellness: WellnessRecord[]; // full history for weight lookup
  cutoff: Date;                  // start of the selected period
  settings?: UserSettings;
}

function StatCard({ label, value, sub, accent, hint }: { label: string; value: string; sub?: string; accent: string; hint?: string }) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card space-y-1">
      <p className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold font-mono tracking-tight leading-none" style={{ color: accent }}>{value}</p>
      </div>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      {hint && <p className="text-[10px] text-muted-foreground/60 italic">{hint}</p>}
    </div>
  );
}

function periodLabel(cutoff: Date): string {
  const days = Math.round((Date.now() - cutoff.getTime()) / 86400000);
  if (days <= 8)   return '7d';
  if (days <= 32)  return '30d';
  if (days <= 95)  return '90d';
  if (days <= 185) return '6M';
  if (days <= 370) return '1Y';
  if (cutoff.getFullYear() === new Date().getFullYear()) return 'YTD';
  return 'All';
}

export default function Dashboard({ activities, allActivities, wellness, allWellness, cutoff, settings = DEFAULT_SETTINGS }: Props) {
  const [volMetric, setVolMetric] = useState<'km' | 'hours'>('km');
  const [wellMetric, setWellMetric] = useState<WellnessMetric>('rhr');
  const [cadenceSport, setCadenceSport] = useState<'running' | 'cycling'>('running');

  const age        = getAge(settings);
  const maxHR      = getMaxHR(settings);
  const thresholdHR = getThresholdHR(settings);

  const weeklyVolume = useMemo(() => computeWeeklyVolume(activities, thresholdHR), [activities, thresholdHR]);
  // Training load uses full history so EWMA starts warm, then sliced to selected period
  const trainingLoad = useMemo(() => {
    const all = computeTrainingLoad(allActivities, thresholdHR);
    return all.filter(d => new Date(d.date) >= cutoff);
  }, [allActivities, cutoff, thresholdHR]);
  const hrZones = useMemo(() => computeHRZoneDistribution(activities, maxHR), [activities, maxHR]);
  const personalBests = useMemo(() => computePersonalBests(activities), [activities]);
  const consistency = useMemo(() => computeConsistency(activities), [activities]);
  const summary = useMemo(() => computePeriodSummary(activities, cutoff, thresholdHR), [activities, cutoff, thresholdHR]);
  const sortedWellness = useMemo(() => [...wellness].sort((a,b) => a.date.localeCompare(b.date)), [wellness]);

  // Weight priority:
  // 1. Most recent Garmin-synced weight that is less than 3 months old (most accurate, device-measured)
  // 2. Settings weight (manual entry, used when Garmin data is stale or absent)
  // 3. Any Garmin-synced weight regardless of age (last resort)
  const weightKg = useMemo(() => {
    const threeMonthsAgo = Date.now() - 90 * 86400000;
    const allSorted = [...allWellness].sort((a, b) => a.date.localeCompare(b.date));
    // Search newest-first for a recent Garmin weight
    for (let i = allSorted.length - 1; i >= 0; i--) {
      const w = allSorted[i];
      if (w.weight_kg != null && new Date(w.date).getTime() >= threeMonthsAgo) {
        return w.weight_kg as number;
      }
    }
    // No recent Garmin weight — use settings
    if (settings.weightKg && settings.weightKg > 0) return settings.weightKg;
    // Fall back to any Garmin weight, however old
    for (let i = allSorted.length - 1; i >= 0; i--) {
      if (allSorted[i].weight_kg != null) return allSorted[i].weight_kg as number;
    }
    return null;
  }, [allWellness, settings.weightKg]);

  // FTP from most recent cycling activity that has one
  const latestFtp = useMemo(() => {
    const cycling = activities.filter(a => a.activity_type === 'cycling' && a.ftp && a.ftp > 0);
    if (!cycling.length) return null;
    return cycling.reduce((best, a) => (a.date > (best?.date ?? '') ? a : best), null as Activity | null)?.ftp ?? null;
  }, [activities]);

  // trainingLoad is already sliced to the selected period (but computed from full history for EWMA warmup)
  const firstLoad = trainingLoad[0];
  const latestLoad = trainingLoad[trainingLoad.length - 1];

  // CTL delta: how much fitness changed from the start to the end of the period
  const ctlDelta = firstLoad && latestLoad && firstLoad !== latestLoad
    ? Math.round(latestLoad.ctl - firstLoad.ctl)
    : null;
  // TSB delta: form change over the period
  const tsbDelta = firstLoad && latestLoad && firstLoad !== latestLoad
    ? parseFloat((latestLoad.tsb - firstLoad.tsb).toFixed(1))
    : null;

  const formBadge = latestLoad
    ? latestLoad.tsb > 5 ? { label: 'Fresh', variant: 'fresh' as const }
    : latestLoad.tsb < -10 ? { label: 'Fatigued', variant: 'fatigued' as const }
    : { label: 'Neutral', variant: 'neutral' as const }
    : null;

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <StatCard label={`Runs ${periodLabel(cutoff)}`} value={`${summary.running.count}`} sub={`${summary.running.km} km`} accent="#3B82F6" />
        <StatCard label={`Rides ${periodLabel(cutoff)}`} value={`${summary.cycling.count}`} sub={`${summary.cycling.km} km`} accent="#22C55E" />
        <StatCard label={`Walks ${periodLabel(cutoff)}`} value={`${summary.walking.count}`} sub={`${summary.walking.km} km`} accent="#F59E0B" />
        <StatCard
          label="Fitness (CTL)"
          value={latestLoad ? `${latestLoad.ctl.toFixed(0)}` : '—'}
          sub={ctlDelta != null ? `${ctlDelta >= 0 ? '+' : ''}${ctlDelta} over period` : 'current'}
          hint="Chronic Training Load — current fitness level (42-day avg). Delta = change across the selected period."
          accent="hsl(0 0% 98%)"
        />
        <StatCard
          label={`Load ${periodLabel(cutoff)} (TSS)`}
          value={`${summary.period_tss}`}
          sub={`~${summary.avg_weekly_tss} TSS/week avg`}
          hint="Total Training Stress Score for the selected period. Higher = more training volume & intensity."
          accent="hsl(0 0% 98%)"
        />
        <div className="p-4 rounded-lg border border-border bg-card space-y-1">
          <p className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Form (TSB)</p>
          <p className="text-2xl font-bold font-mono tracking-tight leading-none">{latestLoad ? latestLoad.tsb.toFixed(1) : '—'}</p>
          {formBadge && <Badge variant={formBadge.variant}>{formBadge.label}</Badge>}
          <p className="text-[10px] text-muted-foreground/60 italic">
            Training Stress Balance — fitness minus fatigue. Positive = fresh, negative = fatigued.
            {tsbDelta != null && ` ${tsbDelta >= 0 ? '+' : ''}${tsbDelta} over period.`}
          </p>
        </div>
      </div>

      {/* Weekly volume */}
      <ExpandableCard
        title="Weekly Volume"
        headerRight={
          <div className="flex gap-1">
            {(['km','hours'] as const).map(m => (
              <Button key={m} variant={volMetric === m ? 'default' : 'ghost'} size="sm" onClick={() => setVolMetric(m)}>{m}</Button>
            ))}
          </div>
        }
      >
        {(expanded) => <WeeklyVolumeChart data={weeklyVolume} metric={volMetric} height={expanded ? 520 : undefined} />}
      </ExpandableCard>

      {/* Training load + HR zones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExpandableCard title="Training Load">
          {(expanded) => (
            <>
              <TrainingLoadChart data={trainingLoad} height={expanded ? 500 : undefined} />
              <div className="flex flex-col gap-1 mt-2 text-[10px] text-muted-foreground">
                <span><span className="text-blue-400 font-semibold">CTL</span> — Chronic Training Load (fitness): 42-day rolling average of daily stress. Higher = more base fitness.</span>
                <span><span className="text-red-400 font-semibold">ATL</span> — Acute Training Load (fatigue): 7-day rolling average. Spikes when you train hard.</span>
                <span><span className="text-green-400 font-semibold">TSB</span> — Training Stress Balance (form): CTL minus ATL. Positive = fresh &amp; ready to race. Negative = fatigued but building fitness.</span>
              </div>
            </>
          )}
        </ExpandableCard>
        <ExpandableCard title="HR Zone Distribution">
          {(expanded) => <HRZoneChart data={hrZones} height={expanded ? 360 : undefined} />}
        </ExpandableCard>
      </div>

      {/* Wellness */}
      <ExpandableCard
        title="Wellness Trends"
        headerRight={
          <div className="flex flex-wrap gap-1">
            {([
              { id: 'rhr',         label: 'Resting HR' },
              { id: 'hrv',         label: 'HRV' },
              { id: 'sleep',       label: 'Sleep h' },
              { id: 'score',       label: 'Sleep Score' },
              { id: 'stress',      label: 'Stress' },
              { id: 'battery',     label: 'Body Battery' },
              { id: 'vo2max',      label: 'VO₂ Max' },
              { id: 'fitness_age', label: 'Fitness Age' },
            ] as const).map(m => (
              <Button key={m.id} variant={wellMetric === m.id ? 'default' : 'ghost'} size="sm" onClick={() => setWellMetric(m.id)}>{m.label}</Button>
            ))}
          </div>
        }
      >
        {(expanded) => <FitnessTrendChart wellness={sortedWellness} metric={wellMetric} age={age} height={expanded ? 500 : undefined} />}
      </ExpandableCard>

      {/* Consistency + Steps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExpandableCard title="Monthly Consistency">
          {(expanded) => <ConsistencyChart data={consistency} height={expanded ? 480 : undefined} />}
        </ExpandableCard>
        <ExpandableCard title="Daily Steps">
          {(expanded) => <StepsChart wellness={sortedWellness} age={age} stepsGoal={settings.dailyStepsGoal} height={expanded ? 460 : undefined} />}
        </ExpandableCard>
      </div>

      {/* Power & Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExpandableCard title="Cycling Power">
          {(expanded) => <PowerChart activities={activities} weightKg={weightKg} height={expanded ? 480 : undefined} />}
        </ExpandableCard>
        <ExpandableCard title="Weekly Calories">
          {(expanded) => <CaloriesChart activities={activities} height={expanded ? 480 : undefined} />}
        </ExpandableCard>
      </div>

      {/* Power Zones + HR Zones */}
      {latestFtp && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ExpandableCard title="Power Zone Distribution">
            {(expanded) => <PowerZonesChart activities={activities} ftp={latestFtp} height={expanded ? 480 : undefined} />}
          </ExpandableCard>
          <ExpandableCard title="HR Zone Distribution">
            {(expanded) => <HRZoneChart data={hrZones} height={expanded ? 480 : undefined} />}
          </ExpandableCard>
        </div>
      )}

      {/* Cadence */}
      <ExpandableCard
        title="Cadence"
        headerRight={
          <div className="flex gap-1">
            {(['running', 'cycling'] as const).map(s => (
              <Button key={s} variant={cadenceSport === s ? 'default' : 'ghost'} size="sm"
                onClick={() => setCadenceSport(s)} className="capitalize">{s}</Button>
            ))}
          </div>
        }
      >
        {(expanded) => <CadenceChart activities={activities} sport={cadenceSport} height={expanded ? 480 : undefined} />}
      </ExpandableCard>

      {/* Personal bests */}
      <Card>
        <CardHeader className="pb-2"><CardTitle>Personal Bests</CardTitle></CardHeader>
        <CardContent><PersonalBests data={personalBests} /></CardContent>
      </Card>
    </div>
  );
}
