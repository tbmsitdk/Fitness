'use client';
import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceDot, Legend,
} from 'recharts';
import { Activity } from '@/types';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

interface CurvePoint {
  label: string;
  watts: number | null;
  wkg: number | null;
}

const DURATION_BANDS = [
  { label: '5 min',  minMins: 4,   maxMins: 8,   useNP: false },
  { label: '20 min', minMins: 15,  maxMins: 30,  useNP: true  },
  { label: '60 min', minMins: 45,  maxMins: 90,  useNP: false },
  { label: '90 min+', minMins: 90, maxMins: 9999, useNP: false },
] as const;

export default function PowerCurveChart({
  activities,
  weightKg,
  height = 220,
}: {
  activities: Activity[];
  weightKg?: number | null;
  height?: number;
}) {
  const { curveData, bestSprint } = useMemo(() => {
    const cycling = activities.filter(a => a.activity_type === 'cycling');

    // Sprint = best max_power across all cycling activities
    const sprintActivities = cycling.filter(a => (a.max_power ?? 0) > 0);
    const sprintWatts = sprintActivities.length > 0
      ? Math.max(...sprintActivities.map(a => a.max_power as number))
      : null;

    const curvePoints: CurvePoint[] = [];

    // Sprint point
    curvePoints.push({
      label: 'Sprint',
      watts: sprintWatts,
      wkg: sprintWatts && weightKg ? Math.round((sprintWatts / weightKg) * 100) / 100 : null,
    });

    for (const band of DURATION_BANDS) {
      const inBand = cycling.filter(a => {
        const mins = a.duration_seconds / 60;
        return mins >= band.minMins && mins <= band.maxMins;
      });
      if (inBand.length === 0) {
        curvePoints.push({ label: band.label, watts: null, wkg: null });
        continue;
      }

      let bestWatts: number | null = null;
      for (const a of inBand) {
        const w = band.useNP ? (a.normalized_power ?? a.avg_power ?? 0) : (a.avg_power ?? 0);
        if (w > 0 && (bestWatts === null || w > bestWatts)) bestWatts = w;
      }

      curvePoints.push({
        label: band.label,
        watts: bestWatts,
        wkg: bestWatts && weightKg ? Math.round((bestWatts / weightKg) * 100) / 100 : null,
      });
    }

    const sprintPoint = curvePoints.find(p => p.label === 'Sprint');
    return { curveData: curvePoints, bestSprint: sprintPoint?.watts ?? null };
  }, [activities, weightKg]);

  const hasData = curveData.some(p => p.watts != null);

  if (!hasData) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
        No cycling power data available
      </div>
    );
  }

  const hasWkg = weightKg != null && curveData.some(p => p.wkg != null);

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={curveData} margin={{ top: 4, right: hasWkg ? 40 : 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
          <YAxis
            yAxisId="watts"
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v}W`}
            domain={['auto', 'auto']}
          />
          {hasWkg && (
            <YAxis
              yAxisId="wkg"
              orientation="right"
              tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `${v}`}
              domain={['auto', 'auto']}
            />
          )}
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, name: string) => {
              if (name === 'watts') return [v != null ? `${v}W` : '—', 'Best Power'];
              if (name === 'wkg')   return [v != null ? `${v} W/kg` : '—', 'W/kg'];
              return [v, name];
            }}
          />
          {hasWkg && <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(240 5% 64.9%)' }} iconSize={6} />}
          <Line
            yAxisId="watts"
            dataKey="watts"
            name="watts"
            stroke="#22C55E"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#22C55E' }}
            connectNulls
          />
          {hasWkg && (
            <Line
              yAxisId="wkg"
              dataKey="wkg"
              name="wkg"
              stroke="#F59E0B"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={{ r: 3, fill: '#F59E0B' }}
              connectNulls
            />
          )}
          {bestSprint != null && (
            <ReferenceDot
              yAxisId="watts"
              x="Sprint"
              y={bestSprint}
              r={6}
              fill="#EF4444"
              stroke="#7F1D1D"
              strokeWidth={1}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 italic">
        Approximated from activity averages — connect a power meter for precise MMP. 20 min uses normalized power when available.
      </p>
    </div>
  );
}
