'use client';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Activity } from '@/types';
import { useMemo } from 'react';
import { parseISO, format, startOfWeek } from 'date-fns';

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

export default function PowerChart({ activities }: { activities: Activity[] }) {
  const data = useMemo(() => {
    // Filter to cycling activities with power data
    const cycling = activities
      .filter(a => a.activity_type === 'cycling' && a.avg_power && a.avg_power > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!cycling.length) return [];

    // Group by week, duration-weighted average power
    const byWeek = new Map<string, { totalWattSeconds: number; totalSeconds: number; maxPower: number }>();
    for (const a of cycling) {
      const week = format(startOfWeek(parseISO(a.date), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const existing = byWeek.get(week) ?? { totalWattSeconds: 0, totalSeconds: 0, maxPower: 0 };
      const secs = a.duration_seconds || 1;
      existing.totalWattSeconds += (a.avg_power ?? 0) * secs;
      existing.totalSeconds += secs;
      existing.maxPower = Math.max(existing.maxPower, a.max_power ?? 0);
      byWeek.set(week, existing);
    }

    return Array.from(byWeek.entries()).map(([week, v]) => ({
      week,
      label: format(parseISO(week), 'MMM d'),
      avgPower: Math.round(v.totalWattSeconds / v.totalSeconds),
      maxPower: v.maxPower || null,
    }));
  }, [activities]);

  const trend = linearTrend(data.map(d => d.avgPower));
  const chartData = data.map((d, i) => ({ ...d, Trend: trend[i] }));

  const tickInterval = Math.max(1, Math.floor(data.length / 12));

  if (!data.length) return (
    <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
      No cycling power data in selected period
    </div>
  );

  const avgAll = Math.round(data.reduce((s, d) => s + d.avgPower, 0) / data.length);

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={tickInterval} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}W`} domain={['auto', 'auto']} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, n: string) => {
              if (n === 'Trend') return [`${v} W`, 'Trend'];
              if (n === 'avgPower') return [`${v} W`, 'Avg Power'];
              if (n === 'maxPower') return [`${v} W`, 'Peak Power'];
              return [v, n];
            }} />
          <ReferenceLine y={avgAll} stroke="hsl(240 5% 50%)" strokeDasharray="4 2" strokeWidth={1}
            label={{ value: `Period avg ${avgAll}W`, position: 'insideTopLeft', fontSize: 9, fill: 'hsl(240 5% 64.9%)' }} />
          <Bar dataKey="avgPower" name="avgPower" fill="#22C55E" opacity={0.85} radius={[3, 3, 0, 0]} />
          <Line dataKey="maxPower" name="maxPower" stroke="#86EFAC" strokeWidth={1.5} dot={false} strokeDasharray="3 2" />
          <Line dataKey="Trend" stroke="hsl(0 0% 55%)" strokeWidth={1.5} dot={false} strokeDasharray="5 3" legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
        Green bars = duration-weighted avg power per week. Dashed green = weekly peak power. Grey dashed = trend.
      </p>
    </div>
  );
}
