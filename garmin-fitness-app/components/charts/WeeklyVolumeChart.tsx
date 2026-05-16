'use client';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { WeeklyVolume } from '@/types';
import { format, parseISO } from 'date-fns';
import { getPeerBenchmarks } from '@/lib/benchmarks';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

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
  return values.map((_, i) => Math.round((slope * i + intercept) * 10) / 10);
}

export default function WeeklyVolumeChart({ data, metric, height = 260 }: { data: WeeklyVolume[]; metric: 'km' | 'hours'; height?: number }) {
  const bench = getPeerBenchmarks();
  const unit = metric === 'km' ? 'km' : 'h';
  const peerRef = metric === 'km' ? bench.weeklyKm : bench.weeklyHours;

  const totals = data.map(d =>
    metric === 'km'
      ? d.running_km + d.cycling_km + d.walking_km
      : d.running_hours + d.cycling_hours + d.walking_hours
  );
  const trend = linearTrend(totals);

  const tickInterval = Math.max(1, Math.floor(data.length / 12));
  const spanYears = new Set(data.map(d => d.week.substring(0, 4))).size > 1;
  const dateFmt = spanYears ? "MMM ''yy" : 'MMM d';

  const display = data.map((d, i) => ({
    week: format(parseISO(d.week), dateFmt),
    Running: metric === 'km' ? Math.round(d.running_km * 10) / 10 : Math.round(d.running_hours * 10) / 10,
    Cycling: metric === 'km' ? Math.round(d.cycling_km * 10) / 10 : Math.round(d.cycling_hours * 10) / 10,
    Walking: metric === 'km' ? Math.round(d.walking_km * 10) / 10 : Math.round(d.walking_hours * 10) / 10,
    Trend: trend[i],
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={display} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={tickInterval} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}${unit}`} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }} formatter={(v: number, n: string) => n === 'Trend' ? [`${v} ${unit}`, 'Trend'] : [`${v} ${unit}`, n]} />
          <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(240 5% 64.9%)', paddingTop: 8 }} iconType="circle" iconSize={6} />
          <ReferenceLine y={peerRef} stroke="hsl(45 93% 58%)" strokeDasharray="5 3" strokeWidth={1.5}
            label={{ value: `Peer avg ${peerRef}${unit}`, position: 'insideTopRight', fontSize: 9, fill: 'hsl(45 93% 58%)' }} />
          <Bar dataKey="Running" stackId="a" fill="#3B82F6" radius={[0,0,0,0]} />
          <Bar dataKey="Cycling" stackId="a" fill="#22C55E" radius={[0,0,0,0]} />
          <Bar dataKey="Walking" stackId="a" fill="#F59E0B" radius={[3,3,0,0]} />
          <Line dataKey="Trend" stroke="hsl(0 0% 70%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">Yellow = peer avg for age {bench.label} ({peerRef}{unit}/week). Grey dashed = your trend.</p>
    </div>
  );
}
