'use client';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
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

export default function CaloriesChart({ activities }: { activities: Activity[] }) {
  const data = useMemo(() => {
    const byWeek = new Map<string, { running: number; cycling: number; walking: number; other: number }>();

    const sorted = [...activities].sort((a, b) => a.date.localeCompare(b.date));
    for (const a of sorted) {
      if (!a.calories || a.calories <= 0) continue;
      const week = format(startOfWeek(parseISO(a.date), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const existing = byWeek.get(week) ?? { running: 0, cycling: 0, walking: 0, other: 0 };
      const type = a.activity_type as 'running' | 'cycling' | 'walking' | 'other';
      existing[type in existing ? type : 'other'] += a.calories;
      byWeek.set(week, existing);
    }

    return Array.from(byWeek.entries()).map(([week, v]) => ({
      week,
      label: format(parseISO(week), 'MMM d'),
      Running: v.running,
      Cycling: v.cycling,
      Walking: v.walking,
      Other: v.other,
      total: v.running + v.cycling + v.walking + v.other,
    }));
  }, [activities]);

  const trend = linearTrend(data.map(d => d.total));
  const chartData = data.map((d, i) => ({ ...d, Trend: trend[i] }));
  const tickInterval = Math.max(1, Math.floor(data.length / 12));

  if (!data.length) return (
    <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
      No calorie data in selected period
    </div>
  );

  const totalKcal = data.reduce((s, d) => s + d.total, 0);
  const avgWeekly = Math.round(totalKcal / data.length);

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={tickInterval} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(v >= 1000 ? 1 : 0)}k`} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, n: string) => n === 'Trend' ? [`${v} kcal`, 'Trend'] : [`${v.toLocaleString()} kcal`, n]} />
          <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(240 5% 64.9%)', paddingTop: 8 }} iconType="circle" iconSize={6} />
          <Bar dataKey="Running" stackId="a" fill="#3B82F6" />
          <Bar dataKey="Cycling" stackId="a" fill="#22C55E" />
          <Bar dataKey="Walking" stackId="a" fill="#F59E0B" />
          <Bar dataKey="Other"   stackId="a" fill="#8B5CF6" radius={[3, 3, 0, 0]} />
          <Line dataKey="Trend" stroke="hsl(0 0% 55%)" strokeWidth={1.5} dot={false} strokeDasharray="5 3" legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
        Weekly active calories by sport. Avg {avgWeekly.toLocaleString()} kcal/week over this period.
      </p>
    </div>
  );
}
