'use client';
import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Activity, WellnessRecord } from '@/types';
import { TrainingLoadForecast } from '@/lib/training-load';
import { findCorrelations, type MetricSeries, type CorrelationResult } from '@/lib/correlation';
import { Search } from 'lucide-react';

interface Props {
  wellness: WellnessRecord[];
  activities: Activity[];
  trainingLoad: TrainingLoadForecast[];
}

function dateKey(iso: string): string {
  return iso.split('T')[0];
}

function buildSeries(wellness: WellnessRecord[], activities: Activity[], trainingLoad: TrainingLoadForecast[]): MetricSeries[] {
  const series: MetricSeries[] = [];

  const wellnessFields: { key: keyof WellnessRecord; label: string; unit: string }[] = [
    { key: 'resting_hr',  label: 'Resting HR',     unit: 'bpm' },
    { key: 'hrv_rmssd',   label: 'HRV (RMSSD)',    unit: 'ms' },
    { key: 'sleep_hours', label: 'Sleep duration', unit: 'h' },
    { key: 'sleep_score', label: 'Sleep score',    unit: '' },
    { key: 'stress_score',label: 'Stress score',   unit: '' },
    { key: 'body_battery',label: 'Body battery',   unit: '' },
    { key: 'steps',       label: 'Steps',          unit: '' },
    { key: 'weight_kg',   label: 'Body weight',    unit: 'kg' },
  ];

  for (const f of wellnessFields) {
    const values = new Map<string, number>();
    for (const w of wellness) {
      const v = w[f.key];
      if (typeof v === 'number' && isFinite(v)) values.set(dateKey(w.date), v);
    }
    if (values.size >= 20) series.push({ key: f.key, label: f.label, unit: f.unit, values });
  }

  // Daily training load: TSS and minutes trained, aggregated per calendar day from activities
  const dailyTss = new Map<string, number>();
  const dailyMinutes = new Map<string, number>();
  for (const a of activities) {
    const d = dateKey(a.date);
    if (a.tss != null) dailyTss.set(d, (dailyTss.get(d) ?? 0) + a.tss);
    dailyMinutes.set(d, (dailyMinutes.get(d) ?? 0) + a.duration_seconds / 60);
  }
  if (dailyTss.size >= 20) series.push({ key: 'daily_tss', label: 'Daily training stress (TSS)', unit: '' , values: dailyTss });
  if (dailyMinutes.size >= 20) series.push({ key: 'daily_minutes', label: 'Daily training time', unit: 'min', values: dailyMinutes });

  // TSB / form, from the training-load forecast (historical points only)
  const tsbValues = new Map<string, number>();
  const ctlValues = new Map<string, number>();
  for (const t of trainingLoad) {
    if (t.projected) continue;
    tsbValues.set(dateKey(t.date), t.tsb);
    ctlValues.set(dateKey(t.date), t.ctl);
  }
  if (tsbValues.size >= 20) series.push({ key: 'tsb', label: 'Form (TSB)', unit: '', values: tsbValues });
  if (ctlValues.size >= 20) series.push({ key: 'ctl', label: 'Fitness (CTL)', unit: '', values: ctlValues });

  return series;
}

export default function CorrelationExplorer({ wellness, activities, trainingLoad }: Props) {
  const [search, setSearch] = useState('');

  const series = useMemo(() => buildSeries(wellness, activities, trainingLoad), [wellness, activities, trainingLoad]);
  const correlations = useMemo(() => findCorrelations(series), [series]);

  const filtered = useMemo(() => {
    if (!search.trim()) return correlations;
    const q = search.toLowerCase();
    return correlations.filter((c: CorrelationResult) =>
      c.a.label.toLowerCase().includes(q) || c.b.label.toLowerCase().includes(q)
    );
  }, [correlations, search]);

  if (series.length < 2) {
    return <p className="text-xs text-muted-foreground italic py-6 text-center">Not enough overlapping daily data yet to explore correlations.</p>;
  }

  if (correlations.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic py-6 text-center max-w-md mx-auto">
        No strong relationships (|r| ≥ 0.25, n ≥ 20 days) found yet across {series.length} tracked metrics.
        This is a good sign for stability — or it just means more data is needed to surface a pattern.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter by metric (e.g. sleep, HRV, TSS)…"
          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-card placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-400/50"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-4 text-center">No correlations match &quot;{search}&quot;.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((c, i) => (
            <div key={i} className="p-3 rounded-lg border border-border bg-card space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium">{c.a.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {c.lagDays === 0 ? '↔ same day ↔' : `→ ${c.lagDays}d later →`}
                </span>
                <span className="text-xs font-medium">{c.b.label}</span>
                <span className={`ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded ${Math.abs(c.r) >= 0.5 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-sky-500/20 text-sky-400'}`}>
                  r = {c.r >= 0 ? '+' : ''}{c.r.toFixed(2)}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">n = {c.n}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{c.description}</p>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 italic">
        Pearson correlation across daily metrics (|r| ≥ 0.25, n ≥ 20 overlapping days). Correlation isn&apos;t
        causation — these are statistical patterns in your own data, worth investigating further, not diagnoses.
      </p>
    </div>
  );
}
