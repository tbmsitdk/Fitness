'use client';
import { useMemo, useState } from 'react';
import {
  ComposedChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line,
} from 'recharts';
import { Activity } from '@/types';
import { parseISO, format } from 'date-fns';

const TOOLTIP_STYLE = {
  background: 'hsl(240 10% 7%)',
  border: '1px solid hsl(240 3.7% 13%)',
  borderRadius: '8px',
  fontSize: 11,
};

interface Props {
  activities: Activity[];
}

type PowerMetric = 'avg_power' | 'normalized_power' | 'wkg';

function normalizeName(title: string): string {
  let name = title
    .replace(/^Zwift\s*[-–]\s*/i, '')   // strip "Zwift – " prefix
    .replace(/:\s*.+$/, '')              // strip suffix after ":"
    .trim()
    .toLowerCase();
  return name;
}

function leastSquaresTrend(data: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  if (data.length < 2) return null;
  const n = data.length;
  const sumX  = data.reduce((s, d) => s + d.x, 0);
  const sumY  = data.reduce((s, d) => s + d.y, 0);
  const sumXY = data.reduce((s, d) => s + d.x * d.y, 0);
  const sumXX = data.reduce((s, d) => s + d.x * d.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export default function RouteProgressionChart({ activities }: Props) {
  const [selectedRoute, setSelectedRoute] = useState<string>('');
  const [metric, setMetric] = useState<PowerMetric>('avg_power');

  // Filter to Zwift-like cycling activities
  const zwiftActs = useMemo(() =>
    activities.filter(
      a =>
        a.activity_type === 'cycling' &&
        (a.title?.toLowerCase().includes('zwift') || (a.avg_power != null && a.avg_power > 0)),
    ),
    [activities],
  );

  // Group by normalized route name, keep those with ≥3 rides
  const routeMap = useMemo(() => {
    const raw = new Map<string, Activity[]>();
    for (const a of zwiftActs) {
      const key = normalizeName(a.title || 'zwift ride');
      const arr = raw.get(key) ?? [];
      arr.push(a);
      raw.set(key, arr);
    }
    // Filter to routes with ≥3 appearances (don't mutate while iterating)
    const map = new Map<string, Activity[]>();
    for (const [k, v] of raw) {
      if (v.length >= 3) map.set(k, v);
    }
    return map;
  }, [zwiftActs]);

  // Routes sorted by most recent activity
  const routes = useMemo(() => {
    return Array.from(routeMap.entries())
      .map(([name, acts]) => ({
        name,
        displayName: name.charAt(0).toUpperCase() + name.slice(1),
        latestDate: acts.reduce((best, a) => (a.date > best ? a.date : best), ''),
        count: acts.length,
      }))
      .sort((a, b) => b.latestDate.localeCompare(a.latestDate));
  }, [routeMap]);

  // Auto-select first route
  const activeRoute = selectedRoute || routes[0]?.name || '';

  const chartData = useMemo(() => {
    const acts = routeMap.get(activeRoute) ?? [];
    return acts
      .map(a => {
        const date = parseISO(a.date);
        const dateMs = date.getTime();
        let y: number | null = null;
        if (metric === 'avg_power') y = a.avg_power;
        else if (metric === 'normalized_power') y = a.normalized_power ?? a.avg_power;
        else if (metric === 'wkg') {
          // W/kg requires weight — skip if missing
          y = a.avg_power;
        }
        return { date, dateMs, dateLabel: format(date, 'MMM d, yy'), y, activity: a };
      })
      .filter(d => d.y != null && (d.y as number) > 0)
      .sort((a, b) => a.dateMs - b.dateMs) as {
        date: Date;
        dateMs: number;
        dateLabel: string;
        y: number;
        activity: Activity;
      }[];
  }, [activeRoute, metric, routeMap]);

  // Trend line points
  const trendLine = useMemo(() => {
    if (chartData.length < 2) return null;
    const normalized = chartData.map((d, i) => ({ x: i, y: d.y }));
    const trend = leastSquaresTrend(normalized);
    if (!trend) return null;
    const first = { dateMs: chartData[0].dateMs, y: trend.intercept };
    const last  = { dateMs: chartData[chartData.length - 1].dateMs, y: trend.slope * (chartData.length - 1) + trend.intercept };
    return { first, last, slope: trend.slope };
  }, [chartData]);

  const summary = useMemo(() => {
    if (chartData.length < 2) return null;
    const firstVal = chartData[0].y;
    const lastVal  = chartData[chartData.length - 1].y;
    const pct = ((lastVal - firstVal) / firstVal) * 100;
    const direction = Math.abs(pct) < 2 ? 'stable' : pct > 0 ? 'improving' : 'declining';
    return { firstVal, lastVal, pct: Math.round(pct * 10) / 10, direction };
  }, [chartData]);

  if (routes.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
        No Zwift routes with 3+ rides found.
      </div>
    );
  }

  const metricLabel = metric === 'avg_power' ? 'Avg Power (W)' : metric === 'normalized_power' ? 'NP (W)' : 'W/kg';
  const trendColor = summary?.direction === 'improving' ? '#22C55E' : summary?.direction === 'declining' ? '#EF4444' : '#94A3B8';

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Route</label>
          <select
            value={activeRoute}
            onChange={e => setSelectedRoute(e.target.value)}
            className="text-xs rounded border border-border bg-card px-2 py-1 text-foreground focus:outline-none"
          >
            {routes.map(r => (
              <option key={r.name} value={r.name}>
                {r.displayName} ({r.count} rides)
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Metric</label>
          <div className="flex gap-1">
            {(['avg_power', 'normalized_power', 'wkg'] as PowerMetric[]).map(m => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  metric === m
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'avg_power' ? 'Avg W' : m === 'normalized_power' ? 'NP' : 'W/kg'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="flex gap-4 flex-wrap text-xs">
          <div className="p-2 rounded border border-border bg-card">
            <span className="text-muted-foreground">First: </span>
            <span className="font-mono font-semibold">{summary.firstVal.toFixed(0)} W</span>
          </div>
          <div className="p-2 rounded border border-border bg-card">
            <span className="text-muted-foreground">Latest: </span>
            <span className="font-mono font-semibold">{summary.lastVal.toFixed(0)} W</span>
          </div>
          <div className="p-2 rounded border border-border bg-card">
            <span className="text-muted-foreground">Trend: </span>
            <span className="font-semibold" style={{ color: trendColor }}>
              {summary.direction} ({summary.pct > 0 ? '+' : ''}{summary.pct}%)
            </span>
          </div>
        </div>
      )}

      {/* Chart — unified data array with both actual values and trend */}
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={chartData.map((d, i) => ({
            label: d.dateLabel,
            power: d.y,
            trend: trendLine
              ? Math.round(trendLine.first.y + (trendLine.last.y - trendLine.first.y) * (i / Math.max(chartData.length - 1, 1)))
              : undefined,
            title: d.activity.title,
          }))}
          margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            domain={['auto', 'auto']}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content={({ payload, label }: any) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div style={TOOLTIP_STYLE} className="p-2 space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="font-mono font-semibold text-xs">{d?.power?.toFixed(0)} W</p>
                  <p className="text-[10px] text-muted-foreground truncate max-w-[160px]">{d?.title}</p>
                </div>
              );
            }}
          />
          <Scatter dataKey="power" fill="#3B82F6" fillOpacity={0.8} />
          {trendLine && (
            <Line
              dataKey="trend"
              dot={false}
              stroke={trendColor}
              strokeWidth={1.5}
              strokeDasharray="4 2"
              type="linear"
              isAnimationActive={false}
              legendType="none"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
