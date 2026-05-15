'use client';
import { ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Activity } from '@/types';
import { useMemo } from 'react';
import { parseISO, format } from 'date-fns';

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

// Optimal cadence references
const CADENCE_REF = {
  running: { value: 170, label: 'Target ≥170 spm', color: '#3B82F6' },
  cycling: { value: 90,  label: 'Target 85–95 rpm', color: '#22C55E' },
};

export default function CadenceChart({ activities, sport }: { activities: Activity[]; sport: 'running' | 'cycling' }) {
  const data = useMemo(() => {
    const sorted = activities
      .filter(a => a.activity_type === sport && a.avg_cadence && a.avg_cadence > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const spanYears = new Set(sorted.map(a => a.date.substring(0, 4))).size > 1;
    const dateFmt = spanYears ? "MMM ''yy" : 'MMM d';
    return sorted.map(a => ({
        date: format(parseISO(a.date), dateFmt),
        cadence: a.avg_cadence as number,
        title: a.title,
      }));
  }, [activities, sport]);

  const trend = linearTrend(data.map(d => d.cadence));
  const chartData = data.map((d, i) => ({ ...d, Trend: trend[i] }));
  const tickInterval = Math.max(1, Math.floor(data.length / 12));
  const ref = CADENCE_REF[sport];
  const unit = sport === 'running' ? 'spm' : 'rpm';
  const avg = data.length ? Math.round(data.reduce((s, d) => s + d.cadence, 0) / data.length) : 0;

  if (!data.length) return (
    <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
      No {sport} cadence data in selected period
    </div>
  );

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={tickInterval} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} tickFormatter={v => `${v}`} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, n: string) => n === 'Trend' ? [`${v} ${unit}`, 'Trend'] : [`${v} ${unit}`, 'Cadence']} />
          <ReferenceLine y={ref.value} stroke="hsl(45 93% 58%)" strokeDasharray="5 3" strokeWidth={1.5}
            label={{ value: ref.label, position: 'insideTopRight', fontSize: 9, fill: 'hsl(45 93% 58%)' }} />
          <Scatter dataKey="cadence" fill={ref.color} opacity={0.7} />
          <Line dataKey="Trend" stroke="hsl(0 0% 55%)" strokeWidth={1.5} dot={false} strokeDasharray="5 3" legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
        Your avg: {avg} {unit}. {sport === 'running' ? '≥170 spm reduces injury risk.' : '85–95 rpm is optimal efficiency.'} Yellow = target. Grey dashed = trend.
      </p>
    </div>
  );
}
