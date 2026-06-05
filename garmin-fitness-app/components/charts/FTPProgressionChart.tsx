'use client';
import { useMemo, useState } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceDot, Legend,
} from 'recharts';
import { Activity } from '@/types';
import { format, parseISO, startOfMonth } from 'date-fns';

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

export default function FTPProgressionChart({
  activities,
  weightKg,
  height = 220,
}: {
  activities: Activity[];
  weightKg?: number | null;
  height?: number;
}) {
  const [metric, setMetric] = useState<'W' | 'W/kg'>('W');
  const useWkg = metric === 'W/kg' && weightKg != null && weightKg > 0;
  const div = useWkg ? (weightKg ?? 1) : 1;

  const { chartData, currentFTP, bestFTP, bestDate } = useMemo(() => {
    const withFTP = activities
      .filter(a => a.ftp != null && a.ftp > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (withFTP.length === 0) return { chartData: [], currentFTP: null, bestFTP: null, bestDate: null };

    // Group by month, take max FTP per month
    const monthMap = new Map<string, number>();
    for (const a of withFTP) {
      const month = format(startOfMonth(parseISO(a.date)), 'yyyy-MM');
      const cur = monthMap.get(month) ?? 0;
      if ((a.ftp as number) > cur) monthMap.set(month, a.ftp as number);
    }

    const months = Array.from(monthMap.keys()).sort();

    // Rolling peak FTP — carry forward so Zone 2 months don't show collapse
    let peak = 0;
    const rollingPeak = months.map(m => {
      peak = Math.max(peak, monthMap.get(m) ?? 0);
      return peak;
    });

    const ftpValues = rollingPeak;
    const trend = linearTrend(ftpValues);

    const spanYears = months.length > 0 && new Set(months.map(m => m.substring(0, 4))).size > 1;
    const dateFmt = spanYears ? "MMM ''yy" : 'MMM';

    const data = months.map((m, i) => ({
      label: format(parseISO(m + '-01'), dateFmt),
      month: m,
      ftp: rollingPeak[i],
      trend: trend[i],
    }));

    const best = data.reduce((b, d) => d.ftp > b.ftp ? d : b);
    // "Current" = manual override if set, otherwise rolling peak (last entry)
    const derivedCurrent = data[data.length - 1]?.ftp ?? null;

    return {
      chartData: data,
      currentFTP: derivedCurrent,
      bestFTP: best?.ftp ?? null,
      bestDate: best?.label ?? null,
    };
  }, [activities]);

  if (chartData.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
        No FTP data found (populate from cycling activities with FTP field)
      </div>
    );
  }

  const currentWkg = currentFTP && weightKg ? (currentFTP / weightKg).toFixed(2) : null;
  const bestWkg = bestFTP && weightKg ? (bestFTP / weightKg).toFixed(2) : null;
  const bestIdx = bestFTP ? chartData.findIndex(d => d.ftp === bestFTP) : -1;

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex gap-3 flex-wrap items-center">
        {currentFTP && (
          <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
            <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Current FTP</p>
            <p className="text-2xl font-bold font-mono text-yellow-400">{useWkg ? `${currentWkg} W/kg` : `${currentFTP}W`}</p>
            <p className="text-[10px] text-muted-foreground">Peak from Zwift/Garmin data</p>
          </div>
        )}
        {bestFTP && (
          <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
            <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Best Ever</p>
            <p className="text-2xl font-bold font-mono text-orange-400">{useWkg ? `${bestWkg} W/kg` : `${bestFTP}W`}</p>
            {bestDate && <p className="text-[10px] text-muted-foreground">{bestDate}</p>}
          </div>
        )}
        {weightKg && (
          <div className="ml-auto flex rounded-md overflow-hidden border border-border text-[11px] self-center">
            {(['W', 'W/kg'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`px-2 py-1 transition ${metric === m ? 'bg-foreground text-background font-semibold' : 'text-muted-foreground hover:bg-muted'}`}
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
            ftp: useWkg && weightKg ? Math.round((d.ftp / div) * 100) / 100 : d.ftp,
            trend: d.trend != null ? (useWkg && weightKg ? Math.round((d.trend / div) * 100) / 100 : d.trend) : null,
          }))}
          margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => useWkg ? `${v}` : `${v}W`}
            domain={['auto', 'auto']}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, name: string) => {
              const unit = useWkg ? 'W/kg' : 'W';
              if (name === 'ftp') return [`${v} ${unit}`, 'Monthly Max FTP'];
              if (name === 'trend') return [`${v} ${unit}`, 'Trend'];
              return [v, name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(240 5% 64.9%)' }} iconSize={6} />
          <Line dataKey="ftp" name="Rolling peak FTP" stroke="#FBBF24" strokeWidth={2.5} dot={{ r: 3, fill: '#FBBF24' }} connectNulls />
          <Line dataKey="trend" name="trend" stroke="hsl(0 0% 55%)" strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls />
          {bestIdx >= 0 && bestFTP != null && (
            <ReferenceDot
              x={chartData[bestIdx].label}
              y={useWkg && weightKg ? Math.round((bestFTP / div) * 100) / 100 : bestFTP}
              r={7}
              fill="#F97316"
              stroke="#7C2D12"
              strokeWidth={1.5}
              label={{ value: '★ Best', position: 'top', fontSize: 9, fill: '#F97316' }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 italic">
        Monthly maximum FTP. Populated from Zwift p20 / structured test data. Dashed = linear trend.
      </p>
    </div>
  );
}
