'use client';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { WellnessRecord } from '@/types';
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
  return values.map((_, i) => Math.round(slope * i + intercept));
}

export default function StepsChart({ wellness }: { wellness: WellnessRecord[] }) {
  const bench = getPeerBenchmarks();
  const filtered = wellness.filter(w => (w.steps ?? 0) > 0);
  const values = filtered.map(w => w.steps ?? 0);
  const trend = linearTrend(values);

  const spanYears = new Set(filtered.map(w => w.date.substring(0, 4))).size > 1;
  const dateFmt = spanYears ? "MMM ''yy" : 'MMM d';

  const data = filtered.map((w, i) => ({
    date: format(parseISO(w.date), dateFmt),
    Steps: w.steps ?? 0,
    Trend: trend[i],
  }));

  const tickInterval = Math.max(1, Math.floor(data.length / 10));

  if (!data.length) return (
    <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">
      No steps data in export
    </div>
  );

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={tickInterval} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${(v/1000).toFixed(0)}k`} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)' }}
            formatter={(v: number, n: string) => n === 'Trend' ? [v.toLocaleString(), 'Trend'] : [v.toLocaleString(), 'Steps']} />
          <ReferenceLine y={10000} stroke="#22C55E" strokeDasharray="4 2" strokeWidth={1}
            label={{ value: '10k goal', position: 'insideTopRight', fontSize: 9, fill: '#22C55E' }} />
          <ReferenceLine y={bench.stepsAvg} stroke="hsl(45 93% 58%)" strokeDasharray="4 2" strokeWidth={1}
            label={{ value: `Age ${bench.label} peer avg ${(bench.stepsAvg/1000).toFixed(1)}k`, position: 'insideBottomRight', fontSize: 9, fill: 'hsl(45 93% 58%)' }} />
          <Bar dataKey="Steps" fill="#3B82F6" fillOpacity={0.7} radius={[2,2,0,0]} />
          <Line dataKey="Trend" stroke="hsl(0 0% 55%)" strokeWidth={1.5} dot={false} strokeDasharray="5 3" legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">Yellow = age {bench.label} peer avg ({bench.stepsAvg.toLocaleString()} steps/day). Green = 10k goal. Grey dashed = your trend.</p>
    </div>
  );
}
