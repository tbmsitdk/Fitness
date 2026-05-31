'use client';
import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { Activity } from '@/types';
import { format, startOfWeek, parseISO } from 'date-fns';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

function estimateTSS(a: Activity, thresholdHR = 165): number {
  if (a.tss != null && a.tss > 0) return a.tss;
  const durationHours = a.duration_seconds / 3600;
  const avgHr = a.avg_hr ?? 140;
  const hrFraction = avgHr / thresholdHR;
  const intensityFactor = Math.min(hrFraction * 0.9, 1.15);
  return durationHours * intensityFactor * intensityFactor * 100;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

interface WeekData {
  label: string;
  monotony: number;
  strain: number;
  weeklyTSS: number;
}

function monotonyColor(m: number): string {
  if (m > 2.0) return '#EF4444';
  if (m >= 1.5) return '#F59E0B';
  return '#22C55E';
}

export default function TrainingMonotony({
  activities,
  thresholdHR = 165,
  height = 220,
}: {
  activities: Activity[];
  thresholdHR?: number;
  height?: number;
}) {
  const { chartData, currentMonotony, currentStrain } = useMemo(() => {
    // Build daily TSS map
    const dailyTSS = new Map<string, number>();
    for (const a of activities) {
      const dateStr = new Date(a.date).toISOString().split('T')[0];
      dailyTSS.set(dateStr, (dailyTSS.get(dateStr) ?? 0) + estimateTSS(a, thresholdHR));
    }

    // Group by week (Mon–Sun), compute monotony per week
    const weekMap = new Map<string, number[]>();
    for (const [date, tss] of dailyTSS) {
      const weekStart = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const arr = weekMap.get(weekStart) ?? [];
      arr.push(tss);
      weekMap.set(weekStart, arr);
    }

    // Fill each week to 7 days (missing days = 0)
    const weeks = Array.from(weekMap.keys()).sort();
    const data: WeekData[] = weeks.map(weekStart => {
      const days = weekMap.get(weekStart)!;
      // Pad to 7 days with zeros for missing days
      while (days.length < 7) days.push(0);
      const mean = days.reduce((s, v) => s + v, 0) / 7;
      const sd = stddev(days);
      const monotony = sd === 0 ? 0 : mean / sd;
      const weeklyTSS = days.reduce((s, v) => s + v, 0);
      const strain = weeklyTSS * monotony;
      const spanYears = weeks.length > 0 && new Set(weeks.map(w => w.substring(0, 4))).size > 1;
      return {
        label: format(parseISO(weekStart), spanYears ? "MMM ''yy" : 'MMM d'),
        monotony: Math.round(monotony * 100) / 100,
        strain: Math.round(strain),
        weeklyTSS: Math.round(weeklyTSS),
      };
    });

    const latest = data[data.length - 1];
    return {
      chartData: data,
      currentMonotony: latest?.monotony ?? 0,
      currentStrain: latest?.strain ?? 0,
    };
  }, [activities, thresholdHR]);

  if (chartData.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
        No activity data available
      </div>
    );
  }

  const mColor = monotonyColor(currentMonotony);
  const mLabel = currentMonotony > 2.0 ? 'High injury risk' : currentMonotony >= 1.5 ? 'Moderate' : 'Healthy';

  return (
    <div className="space-y-3">
      {/* Current score */}
      <div className="flex gap-4 flex-wrap">
        <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Current Monotony</p>
          <p className="text-2xl font-bold font-mono" style={{ color: mColor }}>{currentMonotony.toFixed(2)}</p>
          <p className="text-[10px]" style={{ color: mColor }}>{mLabel}</p>
        </div>
        <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Training Strain</p>
          <p className="text-2xl font-bold font-mono text-foreground">{currentStrain}</p>
          <p className="text-[10px] text-muted-foreground">TSS × monotony</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            interval={Math.max(1, Math.floor(chartData.length / 12))}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            domain={[0, 'auto']}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, name: string) => {
              if (name === 'monotony') return [v.toFixed(2), 'Monotony'];
              if (name === 'weeklyTSS') return [v, 'Weekly TSS'];
              return [v, name];
            }}
          />
          <ReferenceLine
            y={2.0}
            stroke="#EF4444"
            strokeDasharray="5 3"
            strokeWidth={1.5}
            label={{ value: 'Injury risk ≥2.0', position: 'insideTopRight', fontSize: 9, fill: '#EF4444' }}
          />
          <ReferenceLine
            y={1.5}
            stroke="#F59E0B"
            strokeDasharray="3 2"
            strokeWidth={1}
            label={{ value: 'Moderate 1.5', position: 'insideTopRight', fontSize: 9, fill: '#F59E0B' }}
          />
          <Bar dataKey="monotony" radius={[3, 3, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={monotonyColor(entry.monotony)} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 italic">
        Monotony = mean daily TSS ÷ std dev. &gt;2.0 = high injury risk. Strain = weekly TSS × monotony.
      </p>
    </div>
  );
}
