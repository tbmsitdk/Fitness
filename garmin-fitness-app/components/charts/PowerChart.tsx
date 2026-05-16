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

export default function PowerChart({ activities, weightKg, height = 220 }: { activities: Activity[]; weightKg?: number | null; height?: number }) {
  const { chartData, ftp, avgAll, tickInterval } = useMemo(() => {
    const cycling = activities
      .filter(a => a.activity_type === 'cycling' && a.avg_power && a.avg_power > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!cycling.length) return { chartData: [], ftp: null, avgAll: 0, tickInterval: 1 };

    // Most recent FTP across all cycling activities
    const ftpVal = cycling.reduce((latest, a) => {
      if (a.ftp && a.ftp > 0 && a.date > (latest?.date ?? '')) return a;
      return latest;
    }, null as Activity | null)?.ftp ?? null;

    // Group by week — duration-weighted avg power and max NP
    const byWeek = new Map<string, {
      totalWattSeconds: number; totalSeconds: number;
      maxPower: number; npWattSeconds: number; npCount: number;
    }>();

    for (const a of cycling) {
      const week = format(startOfWeek(parseISO(a.date), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const ex = byWeek.get(week) ?? { totalWattSeconds: 0, totalSeconds: 0, maxPower: 0, npWattSeconds: 0, npCount: 0 };
      const secs = a.duration_seconds || 1;
      ex.totalWattSeconds += (a.avg_power ?? 0) * secs;
      ex.totalSeconds += secs;
      ex.maxPower = Math.max(ex.maxPower, a.max_power ?? 0);
      if (a.normalized_power && a.normalized_power > 0) {
        ex.npWattSeconds += a.normalized_power * secs;
        ex.npCount += secs;
      }
      byWeek.set(week, ex);
    }

    const weekKeys = Array.from(byWeek.keys());
    const spanYears = new Set(weekKeys.map(w => w.substring(0, 4))).size > 1;
    const dateFmt = spanYears ? "MMM ''yy" : 'MMM d';
    const data = weekKeys.map(week => ({ week, v: byWeek.get(week)! })).map(({ week, v }) => ({
      label: format(parseISO(week), dateFmt),
      avgPower: Math.round(v.totalWattSeconds / v.totalSeconds),
      np: v.npCount > 0 ? Math.round(v.npWattSeconds / v.npCount) : null,
      maxPower: v.maxPower || null,
    }));

    const trend = linearTrend(data.map(d => d.avgPower));
    const all = Math.round(data.reduce((s, d) => s + d.avgPower, 0) / data.length);

    return {
      chartData: data.map((d, i) => ({ ...d, Trend: trend[i] })),
      ftp: ftpVal,
      avgAll: all,
      tickInterval: Math.max(1, Math.floor(data.length / 12)),
    };
  }, [activities]);

  if (!chartData.length) return (
    <div className="h-[240px] flex items-center justify-center text-xs text-muted-foreground">
      No cycling power data in selected period
    </div>
  );

  const hasNP = chartData.some(d => d.np != null);

  const ftpWkg = ftp && weightKg ? (ftp / weightKg).toFixed(2) : null;

  return (
    <div>
      {ftp && (
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Est. FTP:</span>
            <span className="text-sm font-bold font-mono text-yellow-400">{ftp} W</span>
          </div>
          {ftpWkg && (
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold font-mono text-orange-400">{ftpWkg} W/kg</span>
              <span className="text-[10px] text-muted-foreground/60">@ {weightKg}kg</span>
            </div>
          )}
          <span className="text-[10px] text-muted-foreground/60 italic">(best 20-min × 0.95)</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={tickInterval} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}W`} domain={['auto', 'auto']} tickCount={5} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, n: string) => {
              if (n === 'Trend')    return [`${v} W`, 'Trend'];
              if (n === 'avgPower') return [`${v} W`, 'Avg Power'];
              if (n === 'np')       return [`${v} W`, 'Norm. Power (NP)'];
              if (n === 'maxPower') return [`${v} W`, 'Peak Power'];
              return [v, n];
            }} />
          {ftp && (
            <ReferenceLine y={ftp} stroke="hsl(45 93% 58%)" strokeDasharray="5 3" strokeWidth={1.5}
              label={{ value: `FTP ${ftp}W`, position: 'insideTopRight', fontSize: 9, fill: 'hsl(45 93% 58%)' }} />
          )}
          <ReferenceLine y={avgAll} stroke="hsl(240 5% 50%)" strokeDasharray="3 2" strokeWidth={1}
            label={{ value: `Avg ${avgAll}W`, position: 'insideTopLeft', fontSize: 9, fill: 'hsl(240 5% 64.9%)' }} />
          <Bar dataKey="avgPower" name="avgPower" fill="#22C55E" opacity={0.75} radius={[3, 3, 0, 0]} />
          {hasNP && <Line dataKey="np" name="np" stroke="#4ADE80" strokeWidth={2} dot={{ r: 3, fill: '#4ADE80' }} />}
          <Line dataKey="Trend" stroke="hsl(0 0% 55%)" strokeWidth={1.5} dot={false} strokeDasharray="5 3" legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
        Green bars = duration-weighted avg power/week.{hasNP ? ' Bright green line = Normalized Power (NP) — better measure of true effort.' : ''} Yellow = FTP. Grey dashed = trend.
      </p>
    </div>
  );
}
