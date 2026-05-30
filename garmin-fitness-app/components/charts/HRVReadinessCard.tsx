'use client';
import { WellnessRecord } from '@/types';
import { parseISO, format, subDays } from 'date-fns';
import { useState } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Area,
} from 'recharts';

// Recovery = 100 − stress (higher = better, consistent with HRV intuition)
function toRecovery(stress: number) { return 100 - stress; }

function rollingAvg(vals: (number | null)[], w: number): (number | null)[] {
  return vals.map((_, i) => {
    const slice = vals.slice(Math.max(0, i - w + 1), i + 1).filter((v): v is number => v != null);
    return slice.length >= Math.floor(w / 2)
      ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length)
      : null;
  });
}

function linearTrend(vals: number[]): { slope: number; start: number; end: number } | null {
  const n = vals.length;
  if (n < 5) return null;
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = vals.reduce((a, b) => a + b, 0);
  const sumXY = vals.reduce((s, y, i) => s + i * y, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, start: intercept, end: slope * (n - 1) + intercept };
}

function classify(recovery: number, baseline: number): 'good' | 'moderate' | 'poor' {
  const diff = recovery - baseline;
  if (diff >= 5)  return 'good';
  if (diff >= -5) return 'moderate';
  return 'poor';
}

const STATUS_COLOR = {
  good:     { bg: 'bg-green-500/15', border: 'border-green-500/30', text: 'text-green-400', dot: 'bg-green-500' },
  moderate: { bg: 'bg-amber-500/15', border: 'border-amber-500/30', text: 'text-amber-400', dot: 'bg-amber-500' },
  poor:     { bg: 'bg-red-500/15',   border: 'border-red-500/30',   text: 'text-red-400',   dot: 'bg-red-500'   },
};
const STATUS_LABEL = { good: 'Well recovered', moderate: 'Moderate', poor: 'Fatigued' };

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

const PERIODS = [
  { label: '30d',  days: 30  },
  { label: '90d',  days: 90  },
  { label: '180d', days: 180 },
  { label: '1Y',   days: 365 },
  { label: 'All',  days: 9999 },
] as const;
type Period = typeof PERIODS[number]['label'];

interface Props { wellness: WellnessRecord[]; height?: number }

export default function HRVReadinessCard({ wellness, height = 260 }: Props) {
  const [period, setPeriod] = useState<Period>('90d');

  const hasStress = wellness.some(w => w.stress_score != null);
  if (!hasStress) {
    return (
      <div className="rounded-md border border-border bg-secondary/20 p-4 text-xs text-muted-foreground text-center h-32 flex items-center justify-center">
        No stress / HRV data available
      </div>
    );
  }

  // Full history sorted — needed for accurate 30d rolling baseline
  const allSorted = [...wellness]
    .filter(w => w.stress_score != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const allRecovery   = allSorted.map(w => toRecovery(w.stress_score!));
  const allBaseline30 = rollingAvg(allRecovery, 30);
  const allBaseline7  = rollingAvg(allRecovery, 7);

  // Filter to selected period for display
  const days  = PERIODS.find(p => p.label === period)!.days;
  const cutoff = subDays(new Date(), days);

  const displayData = allSorted
    .map((w, i) => ({
      date:       w.date.slice(0, 10),
      label:      format(parseISO(w.date.slice(0, 10)), days <= 90 ? 'd MMM' : "MMM ''yy"),
      recovery:   Math.round(toRecovery(w.stress_score!)),
      baseline30: allBaseline30[i],
      baseline7:  allBaseline7[i],
    }))
    .filter(d => new Date(d.date) >= cutoff);

  // Trend over the display window
  const trendInput = displayData.map(d => d.recovery);
  const trend      = linearTrend(trendInput);
  const trendPerDay = trend ? trend.slope : 0;
  const trendDir = trendPerDay > 0.05 ? 'improving' : trendPerDay < -0.05 ? 'declining' : 'stable';
  const trendColor = trendDir === 'improving' ? 'text-green-400' : trendDir === 'declining' ? 'text-red-400' : 'text-muted-foreground';
  const trendIcon  = trendDir === 'improving' ? '↑' : trendDir === 'declining' ? '↓' : '→';

  // Add trend line values to data
  const chartData = displayData.map((d, i) => ({
    ...d,
    trendLine: trend ? Math.round(Math.max(0, Math.min(100, trend.start + trend.slope * i))) : null,
  }));

  const tickEvery = chartData.length > 180 ? 30 : chartData.length > 60 ? 14 : chartData.length > 30 ? 7 : 3;
  const ticks = chartData.filter((_, i) => i % tickEvery === 0).map(d => d.label);

  // Today's readiness
  const last30Baseline = allBaseline30.at(-1) ?? 50;
  const todayRecovery  = allRecovery.at(-1) ?? null;
  const todayStatus    = todayRecovery != null ? classify(todayRecovery, last30Baseline) : 'moderate';
  const c = STATUS_COLOR[todayStatus];

  // Last 7 days for timeline
  const last7 = allSorted.slice(-7).map((w, i) => {
    const globalIdx = allSorted.length - 7 + i;
    const rec  = Math.round(toRecovery(w.stress_score!));
    const base = allBaseline30[globalIdx] ?? 50;
    return {
      date:     w.date.slice(0, 10),
      label:    format(parseISO(w.date.slice(0, 10)), 'EEE'),
      recovery: rec,
      status:   classify(rec, base),
    };
  });

  // Weekly averages for longer periods
  const weeklyAvg = (() => {
    if (days <= 30) return null;
    const weeks: { label: string; avg: number }[] = [];
    for (let i = 0; i < chartData.length; i += 7) {
      const slice = chartData.slice(i, i + 7).map(d => d.recovery);
      const avg = Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
      weeks.push({ label: chartData[i].label, avg });
    }
    return weeks;
  })();

  return (
    <div className="space-y-4">
      {/* Header: today + trend */}
      <div className="grid grid-cols-2 gap-3">
        {todayRecovery != null && (
          <div className={`rounded-lg border ${c.border} ${c.bg} p-3 flex items-center justify-between`}>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">Today</p>
              <p className={`text-2xl font-bold font-mono ${c.text}`}>{todayRecovery}<span className="text-xs font-normal text-muted-foreground ml-1">/ 100</span></p>
              <p className={`text-xs ${c.text}`}>{STATUS_LABEL[todayStatus]}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">vs 30d base</p>
              <p className={`text-sm font-semibold ${todayRecovery - last30Baseline >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {todayRecovery - last30Baseline >= 0 ? '+' : ''}{Math.round(todayRecovery - last30Baseline)}
              </p>
            </div>
          </div>
        )}
        <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Trend ({period})</p>
          <p className={`text-2xl font-bold ${trendColor}`}>{trendIcon}</p>
          <p className={`text-xs font-medium ${trendColor}`}>{trendDir.charAt(0).toUpperCase() + trendDir.slice(1)}</p>
          <p className="text-[10px] text-muted-foreground">
            {Math.abs(trendPerDay * 7).toFixed(1)} pts/week {trendDir === 'improving' ? '↑' : trendDir === 'declining' ? '↓' : ''}
          </p>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-0.5">
        {PERIODS.map(p => (
          <button
            key={p.label}
            onClick={() => setPeriod(p.label)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
              period === p.label
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Trend chart */}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="recGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#A78BFA" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#A78BFA" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="label" ticks={ticks} tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} width={28} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'hsl(0 0% 98%)' }}
            formatter={(v: number, name: string) => [`${v}`, name]}
          />
          {/* Reference zones */}
          <ReferenceLine y={75} stroke="#22C55E" strokeDasharray="4 3" strokeWidth={1}
            label={{ value: 'good', position: 'insideTopRight', fontSize: 9, fill: '#22C55E' }} />
          <ReferenceLine y={50} stroke="#F59E0B" strokeDasharray="4 3" strokeWidth={1}
            label={{ value: 'moderate', position: 'insideTopRight', fontSize: 9, fill: '#F59E0B' }} />

          {/* Area fill under recovery */}
          <Area dataKey="recovery" fill="url(#recGrad)" stroke="none" connectNulls />

          {/* Daily recovery dots */}
          <Line dataKey="recovery" name="Recovery" stroke="#A78BFA" strokeWidth={0}
            dot={{ r: 2, fill: '#A78BFA', fillOpacity: 0.5, strokeWidth: 0 }}
            activeDot={{ r: 4 }} connectNulls={false} />

          {/* 7-day rolling average */}
          <Line dataKey="baseline7" name="7d avg" stroke="#A78BFA" strokeWidth={2}
            dot={false} connectNulls />

          {/* 30-day baseline */}
          <Line dataKey="baseline30" name="30d baseline" stroke="hsl(240 5% 55%)"
            strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls />

          {/* Linear trend */}
          <Line dataKey="trendLine" name="Trend" stroke={trendDir === 'improving' ? '#22C55E' : trendDir === 'declining' ? '#EF4444' : 'hsl(240 5% 50%)'}
            strokeWidth={1.5} strokeDasharray="3 2" dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>

      {/* 7-day tiles */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Last 7 days</p>
        <div className="grid grid-cols-7 gap-1">
          {last7.map(d => {
            const sc = STATUS_COLOR[d.status];
            return (
              <div key={d.date} className="flex flex-col items-center gap-1">
                <div className={`w-full rounded-md ${sc.bg} border ${sc.border} flex items-center justify-center py-2`}>
                  <span className={`text-xs font-bold font-mono ${sc.text}`}>{d.recovery}</span>
                </div>
                <span className="text-[9px] text-muted-foreground">{d.label}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Weekly summary for longer periods */}
      {weeklyAvg && weeklyAvg.length > 4 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Weekly averages</p>
          <div className="flex gap-1 flex-wrap">
            {weeklyAvg.slice(-12).map((w, i) => {
              const status = w.avg >= 75 ? 'good' : w.avg >= 50 ? 'moderate' : 'poor';
              const sc = STATUS_COLOR[status];
              return (
                <div key={i} className={`flex flex-col items-center rounded px-2 py-1 ${sc.bg} border ${sc.border}`}>
                  <span className={`text-[10px] font-bold font-mono ${sc.text}`}>{w.avg}</span>
                  <span className="text-[9px] text-muted-foreground">{w.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 italic">
        Recovery = 100 − stress score (Firstbeat Analytics from R-R intervals) ·
        Purple = 7d avg · Dashed grey = 30d baseline · Coloured dashed = {period} trend
      </p>
    </div>
  );
}
