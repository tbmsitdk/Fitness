'use client';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { WellnessRecord } from '@/types';
import { format, parseISO } from 'date-fns';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

// Peer benchmarks for active adults (approx 35–55 yo)
const BENCHMARKS = {
  hrv:   { value: 42,   label: 'Peer avg 42ms',   note: 'Typical active adult 35–55yo' },
  rhr:   { value: 58,   label: 'Peer avg 58bpm',  note: 'Good aerobic fitness baseline' },
  sleep: { value: 7.5,  label: 'Target 7.5h',     note: 'WHO / sleep science recommendation' },
};

const CONFIG = {
  hrv:   { key: 'hrv_rmssd'   as keyof WellnessRecord, label: 'HRV',        color: '#8B5CF6', unit: 'ms' },
  rhr:   { key: 'resting_hr'  as keyof WellnessRecord, label: 'Resting HR', color: '#EF4444', unit: 'bpm' },
  sleep: { key: 'sleep_hours' as keyof WellnessRecord, label: 'Sleep',      color: '#3B82F6', unit: 'h' },
};

function linearTrend(values: number[]): (number | null)[] {
  const n = values.length;
  if (n < 3) return values.map(() => null);
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((s, y, i) => s + i * y, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return values.map(() => null);
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return values.map((_, i) => Math.round((slope * i + intercept) * 100) / 100);
}

export default function FitnessTrendChart({ wellness, metric }: { wellness: WellnessRecord[]; metric: 'hrv' | 'rhr' | 'sleep' }) {
  const cfg = CONFIG[metric];
  const bench = BENCHMARKS[metric];

  const filtered = wellness.filter(w => w[cfg.key] != null);
  const values = filtered.map(w => w[cfg.key] as number);
  const trend = linearTrend(values);

  const data = filtered.map((w, i) => {
    const raw = w[cfg.key];
    return {
      date: format(parseISO(w.date), 'MMM d'),
      [cfg.label]: typeof raw === 'number' ? raw : null,
      Trend: trend[i],
    };
  }).filter(d => d[cfg.label] != null);

  const tickInterval = Math.max(1, Math.floor(data.length / 10));

  if (!data.length) return (
    <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
      No {cfg.label} data in export
    </div>
  );

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={tickInterval} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} domain={['auto','auto']} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)' }}
            formatter={(v: number, n: string) => n === 'Trend' ? [`${v} ${cfg.unit}`, 'Trend'] : [`${v} ${cfg.unit}`, cfg.label]} />
          <ReferenceLine y={bench.value} stroke="hsl(45 93% 58%)" strokeDasharray="5 3" strokeWidth={1.5}
            label={{ value: bench.label, position: 'insideTopRight', fontSize: 9, fill: 'hsl(45 93% 58%)' }} />
          <Line type="monotone" dataKey={cfg.label} stroke={cfg.color} strokeWidth={1.5} dot={false}
            activeDot={{ r: 3, fill: cfg.color }} />
          <Line type="monotone" dataKey="Trend" stroke="hsl(0 0% 55%)" strokeWidth={1.5} dot={false}
            strokeDasharray="5 3" legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">Yellow = {bench.label} ({bench.note}). Grey dashed = your trend.</p>
    </div>
  );
}
