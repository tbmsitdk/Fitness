'use client';
import { useMemo, useState } from 'react';
import { Activity, WellnessRecord } from '@/types';
import { computeWeeklyVolume, computeTrainingLoad, computeHRZoneDistribution, computePersonalBests, computeConsistency, compute90DaySummary } from '@/lib/training-load';
import WeeklyVolumeChart from './charts/WeeklyVolumeChart';
import FitnessTrendChart from './charts/FitnessTrendChart';
import TrainingLoadChart from './charts/TrainingLoadChart';
import HRZoneChart from './charts/HRZoneChart';
import ConsistencyChart from './charts/ConsistencyChart';
import PersonalBests from './charts/PersonalBests';
import StepsChart from './charts/StepsChart';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props { activities: Activity[]; wellness: WellnessRecord[]; }

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card space-y-1">
      <p className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold font-mono tracking-tight leading-none" style={{ color: accent }}>{value}</p>
      </div>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function Dashboard({ activities, wellness }: Props) {
  const [volMetric, setVolMetric] = useState<'km' | 'hours'>('km');
  const [wellMetric, setWellMetric] = useState<'hrv' | 'rhr' | 'sleep'>('rhr');

  const weeklyVolume = useMemo(() => computeWeeklyVolume(activities), [activities]);
  const trainingLoad = useMemo(() => computeTrainingLoad(activities), [activities]);
  const hrZones = useMemo(() => computeHRZoneDistribution(activities), [activities]);
  const personalBests = useMemo(() => computePersonalBests(activities), [activities]);
  const consistency = useMemo(() => computeConsistency(activities), [activities]);
  const summary = useMemo(() => compute90DaySummary(activities), [activities]);
  const sortedWellness = useMemo(() => [...wellness].sort((a,b) => a.date.localeCompare(b.date)), [wellness]);

  const latestLoad = trainingLoad[trainingLoad.length - 1];
  const formBadge = latestLoad
    ? latestLoad.tsb > 5 ? { label: 'Fresh', variant: 'fresh' as const }
    : latestLoad.tsb < -10 ? { label: 'Fatigued', variant: 'fatigued' as const }
    : { label: 'Neutral', variant: 'neutral' as const }
    : null;

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <StatCard label="Runs 90d" value={`${summary.running.count}`} sub={`${summary.running.km} km`} accent="#3B82F6" />
        <StatCard label="Rides 90d" value={`${summary.cycling.count}`} sub={`${summary.cycling.km} km`} accent="#22C55E" />
        <StatCard label="Walks 90d" value={`${summary.walking.count}`} sub={`${summary.walking.km} km`} accent="#F59E0B" />
        <StatCard label="Fitness CTL" value={latestLoad ? `${latestLoad.ctl.toFixed(0)}` : '—'} sub="42-day avg" accent="hsl(0 0% 98%)" />
        <StatCard label="Week TSS" value={`${summary.current_week_tss}`} sub={`${summary.load_change_pct >= 0 ? '+' : ''}${summary.load_change_pct}% vs prev`} accent="hsl(0 0% 98%)" />
        <div className="p-4 rounded-lg border border-border bg-card space-y-1">
          <p className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Form TSB</p>
          <p className="text-2xl font-bold font-mono tracking-tight leading-none">{latestLoad ? latestLoad.tsb.toFixed(1) : '—'}</p>
          {formBadge && <Badge variant={formBadge.variant}>{formBadge.label}</Badge>}
        </div>
      </div>

      {/* Weekly volume */}
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle>Weekly Volume</CardTitle>
          <div className="flex gap-1">
            {(['km','hours'] as const).map(m => (
              <Button key={m} variant={volMetric === m ? 'default' : 'ghost'} size="sm" onClick={() => setVolMetric(m)}>{m}</Button>
            ))}
          </div>
        </CardHeader>
        <CardContent><WeeklyVolumeChart data={weeklyVolume} metric={volMetric} /></CardContent>
      </Card>

      {/* Training load + HR zones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Training Load — ATL / CTL / Form</CardTitle>
          </CardHeader>
          <CardContent>
            <TrainingLoadChart data={trainingLoad} />
            <div className="flex gap-4 mt-1 text-[10px] text-muted-foreground">
              <span><span className="text-blue-400 font-medium">CTL</span> fitness</span>
              <span><span className="text-red-400 font-medium">ATL</span> fatigue</span>
              <span><span className="text-green-400 font-medium">TSB</span> form</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle>HR Zone Distribution</CardTitle></CardHeader>
          <CardContent><HRZoneChart data={hrZones} /></CardContent>
        </Card>
      </div>

      {/* Wellness */}
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle>Wellness Trends</CardTitle>
          <div className="flex gap-1">
            {([
              { id: 'rhr', label: 'Resting HR' },
              { id: 'hrv', label: 'HRV' },
              { id: 'sleep', label: 'Sleep' },
            ] as const).map(m => (
              <Button key={m.id} variant={wellMetric === m.id ? 'default' : 'ghost'} size="sm" onClick={() => setWellMetric(m.id)}>{m.label}</Button>
            ))}
          </div>
        </CardHeader>
        <CardContent><FitnessTrendChart wellness={sortedWellness} metric={wellMetric} /></CardContent>
      </Card>

      {/* Consistency + Steps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle>Monthly Consistency</CardTitle></CardHeader>
          <CardContent><ConsistencyChart data={consistency} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle>Daily Steps</CardTitle></CardHeader>
          <CardContent><StepsChart wellness={sortedWellness} /></CardContent>
        </Card>
      </div>

      {/* Personal bests */}
      <Card>
        <CardHeader className="pb-2"><CardTitle>Personal Bests</CardTitle></CardHeader>
        <CardContent><PersonalBests data={personalBests} /></CardContent>
      </Card>
    </div>
  );
}
