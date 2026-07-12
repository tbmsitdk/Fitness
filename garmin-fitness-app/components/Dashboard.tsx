'use client';
import { useMemo, useState } from 'react';
import { Activity, WellnessRecord, FtpEntry } from '@/types';
import { computeWeeklyVolume, computeTrainingLoadWithForecast, computeEfficiencyFactor, computeHRZoneDistribution, computePersonalBests, computeConsistency, computePeriodSummary, filterCyclingByPower, TrainingLoadForecast, EfficiencyFactorPoint } from '@/lib/training-load';
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
import EfficiencyFactorChart from './charts/EfficiencyFactorChart';
import WeightChart from './charts/WeightChart';
import TrainingHeatmap from './charts/TrainingHeatmap';
import SleepPerformanceChart from './charts/SleepPerformanceChart';
import HeartRateChart from './charts/HeartRateChart';
import HRVReadinessCard from './charts/HRVReadinessCard';
import ReadinessScore from './charts/ReadinessScore';
import HRVTrainingLoadChart from './charts/HRVTrainingLoadChart';
import RacePredictor from './charts/RacePredictor';
import TrainingMonotony from './charts/TrainingMonotony';
import OptimalTrainingDays from './charts/OptimalTrainingDays';
import CardiovascularAge from './charts/CardiovascularAge';
import SleepDebtChart from './charts/SleepDebtChart';
import BodyBatteryChart from './charts/BodyBatteryChart';
import BodyCompositionChart from './charts/BodyCompositionChart';
import PowerCurveChart from './charts/PowerCurveChart';
import FTPProgressionChart from './charts/FTPProgressionChart';
import FtpHistoryChart from './charts/FtpHistoryChart';
import WkgZonesChart from './charts/WkgZonesChart';
import WalkingChart from './charts/WalkingChart';
import AppleHealthVitals from './charts/AppleHealthVitals';
import ChartErrorBoundary from './ChartErrorBoundary';
import dynamic from 'next/dynamic';
const WeeklyReport        = dynamic(() => import('./charts/WeeklyReport'),        { ssr: false });
const DailySuggestion     = dynamic(() => import('./charts/DailySuggestion'),     { ssr: false });
const TrainingPlanGenerator = dynamic(() => import('./charts/TrainingPlanGenerator'), { ssr: false });
const LongevityScore      = dynamic(() => import('./charts/LongevityScore'),      { ssr: false });
const CorrelationExplorer = dynamic(() => import('./charts/CorrelationExplorer'), { ssr: false });
const InjuryRiskScore     = dynamic(() => import('./charts/InjuryRiskScore'),     { ssr: false });
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { UserSettings, getAge, getMaxHR, getThresholdHR, DEFAULT_SETTINGS } from '@/lib/settings';
import { buildMaxHrLookup } from '@/lib/hr-zones';
import ExpandableCard from '@/components/ExpandableCard';
import ActivityDetail from '@/components/ActivityDetail';
import ActivitiesBrowser from '@/components/ActivitiesBrowser';
import { subDays, parseISO, format } from 'date-fns';

interface Props {
  activities: Activity[];
  allActivities: Activity[];   // full history for CTL/ATL EWMA accuracy
  wellness: WellnessRecord[];
  allWellness: WellnessRecord[]; // full history for weight lookup
  cutoff: Date;                  // start of the selected period
  settings?: UserSettings;
  ftpEntries?: FtpEntry[];
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

export default function Dashboard({ activities, allActivities, wellness, allWellness, cutoff, settings = DEFAULT_SETTINGS, ftpEntries = [] }: Props) {
  const [subTab, setSubTab] = useState<'home' | 'running' | 'cycling' | 'health' | 'training'>('home');
  const [volMetric, setVolMetric] = useState<'km' | 'hours'>('km');
  const [wellMetric, setWellMetric] = useState<WellnessMetric>('rhr');
  const [cadenceSport, setCadenceSport] = useState<'running' | 'cycling'>('running');
  const [efSport, setEfSport] = useState<'running' | 'cycling'>('running');
  const [showYoY, setShowYoY] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);

  const age        = getAge(settings);
  const maxHR      = getMaxHR(settings);
  const thresholdHR = getThresholdHR(settings);

  const weeklyVolume = useMemo(() => computeWeeklyVolume(activities, thresholdHR), [activities, thresholdHR]);

  // Training load uses full history so EWMA starts warm, then sliced to selected period
  const trainingLoad = useMemo((): TrainingLoadForecast[] => {
    const all = computeTrainingLoadWithForecast(allActivities, thresholdHR);
    return all.filter(d => new Date(d.date) >= cutoff);
  }, [allActivities, cutoff, thresholdHR]);

  // Rolling measured max HR (avg of top-3 recorded HRs in the 365 days before each
  // date) so zone classification matches what your max HR was at the time.
  const maxHrAt = useMemo(() => buildMaxHrLookup(allActivities, maxHR), [allActivities, maxHR]);
  const hrZones = useMemo(() => computeHRZoneDistribution(activities, maxHrAt), [activities, maxHrAt]);
  // All-time records — independent of the selected period filter
  const personalBests = useMemo(() => computePersonalBests(allActivities, settings.minCyclingPower), [allActivities, settings.minCyclingPower]);
  const consistency = useMemo(() => computeConsistency(activities), [activities]);
  const summary = useMemo(() => computePeriodSummary(activities, cutoff, thresholdHR), [activities, cutoff, thresholdHR]);
  const sortedWellness = useMemo(() => [...wellness].sort((a,b) => a.date.localeCompare(b.date)), [wellness]);
  const sortedAllWellness = useMemo(() => [...allWellness].sort((a,b) => a.date.localeCompare(b.date)), [allWellness]);

  // Recovery rides (avg power below settings.minCyclingPower) excluded from power-based charts/KPIs
  const powerActivities = useMemo(() => filterCyclingByPower(activities, settings.minCyclingPower), [activities, settings.minCyclingPower]);
  const powerAllActivities = useMemo(() => filterCyclingByPower(allActivities, settings.minCyclingPower), [allActivities, settings.minCyclingPower]);

  // Efficiency Factor: use full history (not period-filtered) so the trend shows all-time progression
  const efData = useMemo((): EfficiencyFactorPoint[] => computeEfficiencyFactor(powerAllActivities), [powerAllActivities]);

  // YoY: same period one year ago
  const prevActivities = useMemo(() => {
    if (!showYoY) return [];
    const oneYearBack = subDays(cutoff, 365);
    return allActivities.filter(a => {
      const d = parseISO(a.date);
      return d >= oneYearBack && d < cutoff;
    });
  }, [allActivities, cutoff, showYoY]);

  const prevWeeklyVolume = useMemo(() => {
    if (!showYoY || prevActivities.length === 0) return undefined;
    return computeWeeklyVolume(prevActivities, thresholdHR);
  }, [prevActivities, thresholdHR, showYoY]);

  // Most recent Garmin-synced weight (newest first, any age)
  const weightKg = useMemo(() => {
    const allSorted = [...allWellness].sort((a, b) => b.date.localeCompare(a.date));
    for (const w of allSorted) {
      if (w.weight_kg != null) return w.weight_kg as number;
    }
    return null;
  }, [allWellness]);

  // FTP priority: 1) Latest manual entry (user-verified from Zwift test)
  //              2) Garmin/Zwift profile sync (often inaccurate)
  //              3) Best-ever p20-derived from activities (Zone 2 rides drag this down)
  const manualFtp = useMemo(() => {
    if (!ftpEntries.length) return null;
    const latest = [...ftpEntries].sort((a, b) => b.date.localeCompare(a.date))[0];
    return latest.ftp_watts;
  }, [ftpEntries]);

  const latestFtp = useMemo(() => {
    if (manualFtp) return manualFtp;
    if (settings.garminFtp && settings.garminFtp > 0) return settings.garminFtp;
    const ftps = allActivities
      .filter(a => a.activity_type === 'cycling' && a.ftp && a.ftp > 0)
      .map(a => a.ftp as number);
    return ftps.length ? Math.max(...ftps) : null;
  }, [allActivities, settings.garminFtp, manualFtp]);

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

  const SUB_TABS = [
    { id: 'home',     label: 'Home'     },
    { id: 'training', label: 'Training' },
    { id: 'running',  label: 'Running'  },
    { id: 'cycling',  label: 'Cycling'  },
    { id: 'health',   label: 'Health'   },
  ] as const;

  return (
    <div className="space-y-4">
      {/* Sub-tab navigation */}
      <div className="flex gap-0.5 border-b border-border/60 -mx-6 px-6 pb-0">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={cn(
              'px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
              subTab === t.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* KPI row — 4 cards, always visible */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="p-4 rounded-lg border border-border bg-card space-y-1">
          <p className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Activities {periodLabel(cutoff)}</p>
          <p className="text-2xl font-bold font-mono tracking-tight leading-none">
            {summary.running.count + summary.cycling.count + summary.walking.count}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {summary.running.count > 0 && `${summary.running.count} runs · `}
            {summary.cycling.count > 0 && `${summary.cycling.count} rides · `}
            {summary.walking.count > 0 && `${summary.walking.count} walks`}
          </p>
        </div>
        <StatCard
          label="Fitness (CTL)"
          value={latestLoad ? `${latestLoad.ctl.toFixed(0)}` : '—'}
          sub={ctlDelta != null ? `${ctlDelta >= 0 ? '+' : ''}${ctlDelta} this period` : 'current'}
          hint="42-day training load average — your current base fitness level."
          accent="hsl(0 0% 98%)"
        />
        <StatCard
          label="Weekly Load (TSS)"
          value={`${summary.avg_weekly_tss}`}
          sub="avg per week"
          hint="Average Training Stress Score per week for the selected period."
          accent="hsl(0 0% 98%)"
        />
        <div className="p-4 rounded-lg border border-border bg-card space-y-1">
          <p className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Form (TSB)</p>
          <p className="text-2xl font-bold font-mono tracking-tight leading-none">{latestLoad ? latestLoad.tsb.toFixed(1) : '—'}</p>
          {formBadge && <Badge variant={formBadge.variant}>{formBadge.label}</Badge>}
        </div>
      </div>

      {/* ── HOME ─────────────────────────────────────────────────────────── */}
      {subTab === 'home' && (
        <div className="space-y-4">
          {/* Today's status */}
          <ReadinessScore wellness={sortedAllWellness} />
          <WeeklyReport />
          <DailySuggestion trainingLoad={trainingLoad} wellness={sortedWellness} activities={activities} />

          {/* Volume overview */}
          <ExpandableCard
            title="Weekly Volume"
            headerRight={
              <div className="flex gap-1">
                {(['km','hours'] as const).map(m => (
                  <Button key={m} variant={volMetric === m ? 'default' : 'ghost'} size="sm" onClick={() => setVolMetric(m)}>{m}</Button>
                ))}
                <Button variant={showYoY ? 'default' : 'ghost'} size="sm" onClick={() => setShowYoY(v => !v)}>YoY</Button>
              </div>
            }
          >
            {(expanded) => <WeeklyVolumeChart data={weeklyVolume} metric={volMetric} height={expanded ? 520 : undefined} prevData={showYoY ? prevWeeklyVolume : undefined} />}
          </ExpandableCard>

          {/* Records */}
          <Card>
            <CardHeader className="pb-2"><CardTitle>Personal Bests (all-time)</CardTitle></CardHeader>
            <CardContent><PersonalBests data={personalBests} /></CardContent>
          </Card>
        </div>
      )}

      <ActivityDetail activity={selectedActivity} onClose={() => setSelectedActivity(null)} />
      <ActivitiesBrowser
        activities={allActivities}
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onSelect={(a) => { setSelectedActivity(a); setBrowserOpen(false); }}
      />

      {/* ── TRAINING ─────────────────────────────────────────────────────── */}
      {subTab === 'training' && (
        <div className="space-y-4">
          {/* Load management */}
          <ExpandableCard title="Training Load & Forecast">
            {(expanded) => (
              <>
                <TrainingLoadChart data={trainingLoad} height={expanded ? 500 : undefined} />
                <div className="flex flex-col gap-1 mt-2 text-[10px] text-muted-foreground">
                  <span><span className="text-blue-400 font-semibold">CTL</span> — Fitness (42-day avg). Higher = stronger base.</span>
                  <span><span className="text-red-400 font-semibold">ATL</span> — Fatigue (7-day avg). Spikes after hard training.</span>
                  <span><span className="text-green-400 font-semibold">TSB</span> — Form = CTL − ATL. Positive = fresh, negative = building.</span>
                </div>
              </>
            )}
          </ExpandableCard>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ExpandableCard title="Optimal Training Days">
              {() => <OptimalTrainingDays trainingLoad={trainingLoad} />}
            </ExpandableCard>
            <ExpandableCard title="Training Monotony">
              {(expanded) => <TrainingMonotony activities={allActivities} thresholdHR={thresholdHR} height={expanded ? 480 : undefined} />}
            </ExpandableCard>
          </div>
          <ExpandableCard title="Injury Risk">
            {() => <InjuryRiskScore activities={allActivities} trainingLoad={trainingLoad} wellness={sortedWellness} />}
          </ExpandableCard>
          <ExpandableCard title="Training Heatmap">
            {() => <TrainingHeatmap activities={allActivities} />}
          </ExpandableCard>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ExpandableCard title="Monthly Consistency">
              {(expanded) => <ConsistencyChart data={consistency} height={expanded ? 480 : undefined} />}
            </ExpandableCard>
            <ExpandableCard title="Weekly Calories">
              {(expanded) => <CaloriesChart activities={activities} height={expanded ? 480 : undefined} />}
            </ExpandableCard>
          </div>

          {/* Recent activities — click for per-second HR/power/cadence detail */}
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle>Recent Activities</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setBrowserOpen(true)} className="text-xs">
                View all & search →
              </Button>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border">
                {[...activities].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedActivity(a)}
                    className="w-full flex items-center justify-between py-2.5 text-left hover:bg-card/60 transition-colors px-2 -mx-2 rounded"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{a.title || a.activity_type}</p>
                      <p className="text-[10px] text-muted-foreground">{format(parseISO(a.date), 'MMM d, yyyy · HH:mm')} · {a.activity_type}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-[10px] text-muted-foreground font-mono">
                      <span>{a.distance_km > 0 ? `${a.distance_km.toFixed(1)} km` : ''}</span>
                      <span>{Math.round(a.duration_seconds / 60)} min</span>
                      {a.avg_hr != null && <span className="text-red-400">{a.avg_hr} bpm</span>}
                    </div>
                  </button>
                ))}
                {activities.length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-4 text-center">No activities in this period</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── RUNNING ──────────────────────────────────────────────────────── */}
      {subTab === 'running' && (
        <div className="space-y-4">
          {/* Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ExpandableCard title="HR Zone Distribution">
              {(expanded) => <HRZoneChart data={hrZones} height={expanded ? 360 : undefined} />}
            </ExpandableCard>
            <ExpandableCard title="Aerobic Efficiency">
              {(expanded) => <EfficiencyFactorChart data={efData} sport="running" height={expanded ? 360 : undefined} />}
            </ExpandableCard>
          </div>
          <ExpandableCard title="Cadence">
            {(expanded) => <CadenceChart activities={activities} sport="running" height={expanded ? 480 : undefined} />}
          </ExpandableCard>
          <ExpandableCard title="Sleep & Performance">
            {(expanded) => <SleepPerformanceChart activities={allActivities} wellness={allWellness} defaultSport="running" hideSportToggle height={expanded ? 480 : undefined} />}
          </ExpandableCard>
          {/* Planning tool */}
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground pt-2">Planning</p>
          <ExpandableCard title="Race Time Predictor">
            {() => <RacePredictor activities={allActivities} />}
          </ExpandableCard>
        </div>
      )}

      {/* ── CYCLING ──────────────────────────────────────────────────────── */}
      {subTab === 'cycling' && (
        <div className="space-y-4">
          {/* Manual FTP history */}
          <ExpandableCard title="Zwift FTP History">
            {(expanded) => <FtpHistoryChart entries={ftpEntries} height={expanded ? 480 : 220} />}
          </ExpandableCard>

          {/* Power & performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ExpandableCard title="FTP Progression (p20 estimate from activities)">
              {(expanded) => <FTPProgressionChart activities={powerAllActivities} weightKg={weightKg} garminFtp={manualFtp ?? settings.garminFtp} height={expanded ? 480 : undefined} />}
            </ExpandableCard>
            <ExpandableCard title="W/kg Over Time">
              {(expanded) => <WkgZonesChart activities={powerAllActivities} wellness={allWellness} garminFtp={manualFtp ?? settings.garminFtp} height={expanded ? 480 : undefined} />}
            </ExpandableCard>
          </div>
          <ExpandableCard title="Power Zones">
            {(expanded) => <PowerChart activities={powerActivities} weightKg={weightKg} ftp={latestFtp} height={expanded ? 480 : undefined} />}
          </ExpandableCard>
          {latestFtp && (
            <ExpandableCard title="Zone Distribution">
              {(expanded) => <PowerZonesChart ftp={latestFtp} cutoff={cutoff} minCyclingPower={settings.minCyclingPower} height={expanded ? 480 : undefined} />}
            </ExpandableCard>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ExpandableCard title="Aerobic Efficiency">
              {(expanded) => <EfficiencyFactorChart data={efData} sport="cycling" height={expanded ? 480 : undefined} />}
            </ExpandableCard>
            <ExpandableCard title="Power Curve">
              {(expanded) => <PowerCurveChart activities={powerAllActivities} weightKg={weightKg} height={expanded ? 480 : undefined} />}
            </ExpandableCard>
          </div>
          <ExpandableCard title="Cadence">
            {(expanded) => <CadenceChart activities={activities} sport="cycling" height={expanded ? 480 : undefined} />}
          </ExpandableCard>
          <ExpandableCard title="Sleep & Performance">
            {(expanded) => <SleepPerformanceChart activities={allActivities} wellness={allWellness} defaultSport="cycling" hideSportToggle height={expanded ? 480 : undefined} />}
          </ExpandableCard>
          {/* Planning tools */}
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground pt-2">Planning</p>
          <ExpandableCard title="Training Plan Generator">
            {() => <TrainingPlanGenerator activities={allActivities} ftp={latestFtp} />}
          </ExpandableCard>
        </div>
      )}

      {/* ── HEALTH ───────────────────────────────────────────────────────── */}
      {subTab === 'health' && (
        <div className="space-y-4">
          {/* Recovery & readiness */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ExpandableCard title="HRV Readiness">
              {() => <HRVReadinessCard wellness={sortedAllWellness} />}
            </ExpandableCard>
            <ExpandableCard title="Longevity Score">
              {() => <LongevityScore wellness={sortedWellness} activities={allActivities} settings={settings} />}
            </ExpandableCard>
          </div>
          <ExpandableCard title="Heart Rate">
            {(expanded) => <HeartRateChart wellness={sortedWellness} activities={activities} height={expanded ? 500 : undefined} />}
          </ExpandableCard>
          <ExpandableCard title="HRV & Training Load">
            {(expanded) => <HRVTrainingLoadChart trainingLoad={trainingLoad} wellness={sortedWellness} height={expanded ? 500 : undefined} />}
          </ExpandableCard>

          {/* Daily metrics */}
          <ExpandableCard
            title="Daily Metrics"
            headerRight={
              <div className="flex flex-wrap gap-1">
                {([
                  { id: 'rhr',     label: 'Resting HR'   },
                  { id: 'hrv',     label: 'HRV'          },
                  { id: 'sleep',   label: 'Sleep'        },
                  { id: 'score',   label: 'Sleep Score'  },
                  { id: 'battery', label: 'Body Battery' },
                  { id: 'vo2max',  label: 'VO₂ Max'      },
                ] as const).map(m => (
                  <Button key={m.id} variant={wellMetric === m.id ? 'default' : 'ghost'} size="sm" onClick={() => setWellMetric(m.id)}>{m.label}</Button>
                ))}
              </div>
            }
          >
            {(expanded) => <FitnessTrendChart wellness={sortedWellness} metric={wellMetric} age={age} height={expanded ? 500 : undefined} />}
          </ExpandableCard>

          {/* Sleep & energy */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ExpandableCard title="Sleep Debt">
              {(expanded) => <SleepDebtChart wellness={sortedAllWellness} height={expanded ? 480 : undefined} />}
            </ExpandableCard>
            <ExpandableCard title="Body Battery">
              {(expanded) => <BodyBatteryChart wellness={sortedWellness} height={expanded ? 480 : undefined} />}
            </ExpandableCard>
          </div>

          {/* Body composition & movement */}
          <ExpandableCard title="Body Composition">
            {(expanded) => <BodyCompositionChart wellness={sortedWellness} activities={allActivities} settings={settings} height={expanded ? 500 : undefined} />}
          </ExpandableCard>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ExpandableCard title="Weight">
              {(expanded) => <WeightChart wellness={sortedWellness} heightCm={settings.heightCm} height={expanded ? 480 : undefined} />}
            </ExpandableCard>
            <ExpandableCard title="Daily Steps">
              {(expanded) => <StepsChart wellness={sortedWellness} age={age} stepsGoal={settings.dailyStepsGoal} height={expanded ? 460 : undefined} />}
            </ExpandableCard>
          </div>

          {/* Apple Health mobility & gait metrics */}
          <ExpandableCard title="Apple Health Vitals">
            {(expanded) => (
              <ChartErrorBoundary title="Apple Health Vitals">
                <AppleHealthVitals wellness={sortedAllWellness} height={expanded ? 600 : undefined} />
              </ChartErrorBoundary>
            )}
          </ExpandableCard>

          {/* Walking as lifestyle activity */}
          <ExpandableCard title="Walking & Activity">
            {(expanded) => <WalkingChart activities={allActivities} height={expanded ? 480 : undefined} />}
          </ExpandableCard>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ExpandableCard title="Cardiovascular Age">
              {() => <CardiovascularAge settings={settings} wellness={sortedWellness} activities={activities} />}
            </ExpandableCard>
            <ExpandableCard title="HR During Walks">
              {(expanded) => <HRZoneChart data={computeHRZoneDistribution(activities.filter(a => a.activity_type === 'walking'), maxHrAt)} height={expanded ? 360 : undefined} />}
            </ExpandableCard>
          </div>

          {/* Correlation explorer — finds statistical relationships across your own metrics */}
          <ExpandableCard title="Correlation Explorer">
            {() => <CorrelationExplorer wellness={allWellness} activities={allActivities} trainingLoad={trainingLoad} />}
          </ExpandableCard>
        </div>
      )}
    </div>
  );
}
