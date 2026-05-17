'use client';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Activity } from '@/types';
import { useMemo, useState } from 'react';
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
  const [metric, setMetric] = useState<'W' | 'W/kg'>('W');
  const useWkg = metric === 'W/kg' && weightKg != null && weightKg > 0;
  const div = useWkg ? weightKg! : 1;

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

  // W/kg classification bands (Coggan scale)
  const WKG_BANDS = [
    { min: 0,    max: 2.0, label: 'Untrained',    color: '#6B7280' },
    { min: 2.0,  max: 2.5, label: 'Fair',         color: '#60A5FA' },
    { min: 2.5,  max: 3.2, label: 'Moderate',     color: '#34D399' },
    { min: 3.2,  max: 4.0, label: 'Good',         color: '#FBBF24' },
    { min: 4.0,  max: 5.0, label: 'Very Good',    color: '#F97316' },
    { min: 5.0,  max: 99,  label: 'Exceptional',  color: '#EF4444' },
  ];
  const ftpCategory = ftpWkg
    ? WKG_BANDS.find(b => Number(ftpWkg) >= b.min && Number(ftpWkg) < b.max)
    : null;

  return (
    <div>
      {/* Header row: FTP + W/kg + toggle */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        {ftp && (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">FTP:</span>
              <span className="text-sm font-bold font-mono text-yellow-400">{ftp} W</span>
            </div>
            {ftpWkg && (
              <div className="flex items-center gap-1">
                <span className="text-sm font-bold font-mono text-orange-400">{ftpWkg} W/kg</span>
                {ftpCategory && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ background: ftpCategory.color + '22', color: ftpCategory.color }}>
                    {ftpCategory.label}
                  </span>
                )}
              </div>
            )}
          </>
        )}
        {/* W / W/kg toggle */}
        {weightKg && (
          <div className="ml-auto flex rounded-md overflow-hidden border border-border text-[11px]">
            {(['W', 'W/kg'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`px-2 py-0.5 transition ${metric === m ? 'bg-foreground text-background font-semibold' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={chartData.map(d => ({
            ...d,
            avgPower: Math.round((d.avgPower / div) * 100) / 100,
            np:       d.np != null ? Math.round((d.np / div) * 100) / 100 : null,
            maxPower: d.maxPower != null ? Math.round((d.maxPower / div) * 100) / 100 : null,
            Trend:    d.Trend != null ? Math.round((d.Trend / div) * 100) / 100 : null,
          }))}
          margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={tickInterval} />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => useWkg ? `${v}` : `${v}W`}
            domain={['auto', 'auto']}
            tickCount={5}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, n: string) => {
              const unit = useWkg ? 'W/kg' : 'W';
              if (n === 'Trend')    return [`${v} ${unit}`, 'Trend'];
              if (n === 'avgPower') return [`${v} ${unit}`, 'Avg Power'];
              if (n === 'np')       return [`${v} ${unit}`, 'Norm. Power (NP)'];
              if (n === 'maxPower') return [`${v} ${unit}`, 'Peak Power'];
              return [v, n];
            }}
          />
          {ftp && (
            <ReferenceLine
              y={Math.round((ftp / div) * 100) / 100}
              stroke="hsl(45 93% 58%)" strokeDasharray="5 3" strokeWidth={1.5}
              label={{ value: useWkg ? `FTP ${ftpWkg} W/kg` : `FTP ${ftp}W`, position: 'insideTopRight', fontSize: 9, fill: 'hsl(45 93% 58%)' }}
            />
          )}
          <ReferenceLine
            y={Math.round((avgAll / div) * 100) / 100}
            stroke="hsl(240 5% 50%)" strokeDasharray="3 2" strokeWidth={1}
            label={{ value: useWkg ? `Avg ${(avgAll / div).toFixed(2)} W/kg` : `Avg ${avgAll}W`, position: 'insideTopLeft', fontSize: 9, fill: 'hsl(240 5% 64.9%)' }}
          />
          <Bar dataKey="avgPower" name="avgPower" fill="#22C55E" opacity={0.75} radius={[3, 3, 0, 0]} />
          {hasNP && <Line dataKey="np" name="np" stroke="#4ADE80" strokeWidth={2} dot={{ r: 3, fill: '#4ADE80' }} />}
          <Line dataKey="Trend" stroke="hsl(0 0% 55%)" strokeWidth={1.5} dot={false} strokeDasharray="5 3" legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
        {useWkg
          ? `W/kg = power ÷ ${weightKg} kg body weight. FTP categories: <2.0 untrained · 2.5 fair · 3.2 moderate · 4.0 good · 5.0+ exceptional.`
          : `Green bars = duration-weighted avg power/week.${hasNP ? ' Bright green line = NP — better measure of true effort.' : ''} Yellow = FTP.`}
      </p>
    </div>
  );
}
