'use client';
import {
  ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { EfficiencyFactorPoint } from '@/lib/training-load';
import { format, parseISO } from 'date-fns';

const TOOLTIP_STYLE = {
  background: 'hsl(240 10% 7%)',
  border: '1px solid hsl(240 3.7% 13%)',
  borderRadius: '8px',
  fontSize: 11,
};

// Linear regression for trend line
function linearTrend(points: EfficiencyFactorPoint[]): { date: string; trend: number }[] {
  if (points.length < 3) return [];
  const n = points.length;
  const xs = points.map((_, i) => i);
  const ys = points.map(p => p.ef);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return points.map((p, i) => ({
    date: p.date,
    trend: Math.round((slope * i + intercept) * 10000) / 10000,
  }));
}

interface Props {
  data: EfficiencyFactorPoint[];
  sport: 'running' | 'cycling';
  height?: number;
}

export default function EfficiencyFactorChart({ data, sport, height = 260 }: Props) {
  const filtered = data.filter(p => p.sport === sport);
  const trend = linearTrend(filtered);

  const spanYears = new Set(filtered.map(p => p.date.substring(0, 4))).size > 1;
  const dateFmt = spanYears ? "MMM ''yy" : 'MMM d';

  // Merge scatter + trend into one array keyed by date
  const trendMap = new Map(trend.map(t => [t.date, t.trend]));
  const display = filtered.map(p => ({
    date: format(parseISO(p.date), dateFmt),
    rawDate: p.date,
    ef: p.ef,
    trend: trendMap.get(p.date) ?? null,
    title: p.title,
  }));

  const isRunning = sport === 'running';
  const color = isRunning ? '#3B82F6' : '#22C55E';
  const unit = isRunning ? 'km/min/bpm' : 'W/bpm';
  // Typical baselines
  const baseline = isRunning ? 0.008 : 1.5;
  const baselineLabel = isRunning ? 'Typical baseline (~0.008)' : 'Typical baseline (~1.5)';

  const trendDir = trend.length >= 2
    ? trend[trend.length - 1].trend - trend[0].trend
    : 0;
  const trendLabel = Math.abs(trendDir) < 0.0001
    ? '→ stable'
    : trendDir > 0
    ? `↑ improving`
    : `↓ declining`;
  const trendColor = trendDir > 0 ? '#22C55E' : trendDir < -0.0001 ? '#EF4444' : '#9CA3AF';

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-6">
        <p className="text-sm text-muted-foreground">
          No {sport} activities with HR + {isRunning ? 'distance' : 'power'} data yet.
        </p>
        {!isRunning && (
          <p className="text-[11px] text-muted-foreground/60 max-w-sm">
            Cycling EF requires heart rate recorded on the Garmin activity.
            If using Zwift, connect your HR monitor through the Garmin Connect app
            (not directly to Zwift) so HR is written to the Garmin activity.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-muted-foreground">Trend:</span>
        <span className="text-xs font-semibold" style={{ color: trendColor }}>{trendLabel}</span>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} activities</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={display} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            interval={Math.max(1, Math.floor(display.length / 8))}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            domain={['auto', 'auto']}
            tickCount={5}
            tickFormatter={v => v.toFixed(isRunning ? 4 : 2)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, name: string) => [
              name === 'EF' ? `${v.toFixed(isRunning ? 4 : 2)} ${unit}` : `${v.toFixed(isRunning ? 4 : 2)}`,
              name,
            ]}
          />
          <ReferenceLine
            y={baseline}
            stroke="hsl(240 5% 40%)"
            strokeDasharray="4 3"
            label={{ value: baselineLabel, position: 'insideTopLeft', fontSize: 9, fill: 'hsl(240 5% 50%)' }}
          />
          <Scatter dataKey="ef" name="EF" fill={color} fillOpacity={0.7} r={3} />
          <Line
            type="monotone"
            dataKey="trend"
            name="Trend"
            stroke={trendColor}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
        {isRunning
          ? 'EF = speed (km/min) ÷ avg HR. Higher = faster at same heart rate. Improving trend = growing aerobic efficiency.'
          : 'EF = normalized power ÷ avg HR. Higher = more watts per heartbeat. Improving trend = better cycling aerobic fitness.'}
      </p>
    </div>
  );
}
