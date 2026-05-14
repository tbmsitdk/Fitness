'use client';

import { useMemo, useState } from 'react';
import { Activity, WellnessRecord } from '@/types';
import {
  computeWeeklyVolume,
  computeTrainingLoad,
  computeHRZoneDistribution,
  computePersonalBests,
  computeConsistency,
  compute90DaySummary,
} from '@/lib/training-load';
import WeeklyVolumeChart from './charts/WeeklyVolumeChart';
import FitnessTrendChart from './charts/FitnessTrendChart';
import TrainingLoadChart from './charts/TrainingLoadChart';
import HRZoneChart from './charts/HRZoneChart';
import ConsistencyChart from './charts/ConsistencyChart';
import PersonalBests from './charts/PersonalBests';
import StepsChart from './charts/StepsChart';
import { Activity as ActivityIcon, Bike, Footprints, TrendingUp, Zap, Heart } from 'lucide-react';
import { clsx } from 'clsx';

interface Props {
  activities: Activity[];
  wellness: WellnessRecord[];
}

function StatCard({ label, value, sub, icon, color }: { label: string; value: string; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-4 flex items-center gap-4">
      <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium truncate">{label}</p>
        <p className="text-xl font-bold text-slate-900 leading-none mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-white rounded-2xl border border-slate-100 p-5', className)}>
      <h3 className="text-sm font-semibold text-slate-700 mb-4">{title}</h3>
      {children}
    </div>
  );
}

export default function Dashboard({ activities, wellness }: Props) {
  const [volumeMetric, setVolumeMetric] = useState<'km' | 'hours'>('km');
  const [wellnessMetric, setWellnessMetric] = useState<'hrv' | 'rhr' | 'sleep'>('rhr');

  const weeklyVolume = useMemo(() => computeWeeklyVolume(activities), [activities]);
  const trainingLoad = useMemo(() => computeTrainingLoad(activities), [activities]);
  const hrZones = useMemo(() => computeHRZoneDistribution(activities), [activities]);
  const personalBests = useMemo(() => computePersonalBests(activities), [activities]);
  const consistency = useMemo(() => computeConsistency(activities), [activities]);
  const summary = useMemo(() => compute90DaySummary(activities), [activities]);

  const sortedWellness = useMemo(() =>
    [...wellness].sort((a, b) => a.date.localeCompare(b.date)),
    [wellness]
  );

  const latestLoad = trainingLoad[trainingLoad.length - 1];

  // Determine form status
  const formStatus = latestLoad
    ? latestLoad.tsb > 5 ? { label: 'Fresh', color: 'text-garmin-green', bg: 'bg-green-50' }
    : latestLoad.tsb < -10 ? { label: 'Fatigued', color: 'text-red-600', bg: 'bg-red-50' }
    : { label: 'Neutral', color: 'text-amber-600', bg: 'bg-amber-50' }
    : null;

  return (
    <div className="space-y-6">
      {/* Summary stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Runs (90d)"
          value={`${summary.running.count}`}
          sub={`${summary.running.km} km`}
          icon={<ActivityIcon className="w-5 h-5 text-garmin-green" />}
          color="bg-green-50"
        />
        <StatCard
          label="Rides (90d)"
          value={`${summary.cycling.count}`}
          sub={`${summary.cycling.km} km`}
          icon={<Bike className="w-5 h-5 text-garmin-blue" />}
          color="bg-blue-50"
        />
        <StatCard
          label="Walks (90d)"
          value={`${summary.walking.count}`}
          sub={`${summary.walking.km} km`}
          icon={<Footprints className="w-5 h-5 text-garmin-orange" />}
          color="bg-orange-50"
        />
        <StatCard
          label="Fitness (CTL)"
          value={latestLoad ? `${latestLoad.ctl.toFixed(0)}` : '—'}
          sub="42-day avg TSS"
          icon={<TrendingUp className="w-5 h-5 text-garmin-purple" />}
          color="bg-purple-50"
        />
        <StatCard
          label="Week TSS"
          value={`${summary.current_week_tss}`}
          sub={summary.load_change_pct >= 0 ? `+${summary.load_change_pct}% vs last wk` : `${summary.load_change_pct}% vs last wk`}
          icon={<Zap className="w-5 h-5 text-amber-500" />}
          color="bg-amber-50"
        />
        <StatCard
          label="Form (TSB)"
          value={latestLoad ? `${latestLoad.tsb.toFixed(1)}` : '—'}
          sub={formStatus?.label}
          icon={<Heart className="w-5 h-5 text-red-500" />}
          color="bg-red-50"
        />
      </div>

      {/* Weekly volume */}
      <Card title="Weekly Training Volume">
        <div className="flex items-center gap-2 mb-4">
          {(['km', 'hours'] as const).map(m => (
            <button
              key={m}
              onClick={() => setVolumeMetric(m)}
              className={clsx(
                'px-3 py-1 text-xs font-medium rounded-full transition-colors',
                volumeMetric === m ? 'bg-garmin-blue text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <WeeklyVolumeChart data={weeklyVolume} metric={volumeMetric} />
      </Card>

      {/* Training load + HR zones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Training Load — ATL / CTL / Form (TSB)">
          <TrainingLoadChart data={trainingLoad} />
          <div className="flex gap-4 mt-2 text-xs text-slate-500">
            <span><span className="font-semibold text-garmin-blue">CTL</span> = fitness (42d avg)</span>
            <span><span className="font-semibold text-red-500">ATL</span> = fatigue (7d avg)</span>
            <span><span className="font-semibold text-garmin-green">TSB</span> = form (CTL − ATL)</span>
          </div>
        </Card>

        <Card title="HR Zone Distribution (all activities)">
          <HRZoneChart data={hrZones} />
        </Card>
      </div>

      {/* Wellness trends */}
      <Card title="Wellness Trends">
        <div className="flex items-center gap-2 mb-4">
          {([
            { id: 'rhr', label: 'Resting HR' },
            { id: 'hrv', label: 'HRV' },
            { id: 'sleep', label: 'Sleep' },
          ] as const).map(m => (
            <button
              key={m.id}
              onClick={() => setWellnessMetric(m.id)}
              className={clsx(
                'px-3 py-1 text-xs font-medium rounded-full transition-colors',
                wellnessMetric === m.id ? 'bg-garmin-blue text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <FitnessTrendChart wellness={sortedWellness} metric={wellnessMetric} />
      </Card>

      {/* Consistency + Steps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Monthly Consistency">
          <ConsistencyChart data={consistency} />
        </Card>

        <Card title="Daily Steps (last 60 days)">
          <StepsChart wellness={sortedWellness} />
        </Card>
      </div>

      {/* Personal bests */}
      <Card title="Personal Bests">
        <PersonalBests data={personalBests} />
      </Card>
    </div>
  );
}
