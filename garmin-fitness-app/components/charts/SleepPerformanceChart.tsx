'use client';
import { useMemo, useState } from 'react';
import {
  ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Activity, WellnessRecord } from '@/types';
import { format, parseISO, subDays } from 'date-fns';

const TOOLTIP_STYLE = {
  background: 'hsl(240 10% 7%)',
  border: '1px solid hsl(240 3.7% 13%)',
  borderRadius: '8px',
  fontSize: 11,
};

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(
    xs.reduce((s, x) => s + (x - mx) ** 2, 0) *
    ys.reduce((s, y) => s + (y - my) ** 2, 0)
  );
  return den === 0 ? 0 : Math.round((num / den) * 100) / 100;
}

function linearFit(xs: number[], ys: number[]) {
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxy = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sxx = xs.reduce((s, x) => s + x * x, 0);
  const d = n * sxx - sx * sx;
  if (d === 0) return null;
  const slope = (n * sxy - sx * sy) / d;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function rLabel(r: number): { text: string; color: string } {
  const a = Math.abs(r);
  const dir = r > 0 ? 'positive' : 'negative';
  if (a < 0.1) return { text: 'No correlation', color: '#9CA3AF' };
  if (a < 0.3) return { text: `Weak ${dir}`, color: r > 0 ? '#34D399' : '#FCA5A5' };
  if (a < 0.5) return { text: `Moderate ${dir}`, color: r > 0 ? '#10B981' : '#F87171' };
  if (a < 0.7) return { text: `Strong ${dir}`, color: r > 0 ? '#059669' : '#EF4444' };
  return { text: `Very strong ${dir}`, color: r > 0 ? '#047857' : '#DC2626' };
}

type Sport = 'running' | 'cycling';
type SleepMetric = 'hours' | 'score';

interface Props {
  activities: Activity[];
  wellness: WellnessRecord[];
  height?: number;
}

export default function SleepPerformanceChart({ activities, wellness, height = 280 }: Props) {
  const [sport, setSport]   = useState<Sport>('running');
  const [metric, setMetric] = useState<SleepMetric>('hours');

  // Build date → wellness map for O(1) lookup
  const wellMap = useMemo(() => {
    const m = new Map<string, WellnessRecord>();
    for (const w of wellness) m.set(w.date.substring(0, 10), w);
    return m;
  }, [wellness]);

  const { points, r, trendLine, xLabel, yLabel } = useMemo(() => {
    const filtered = activities.filter(a => {
      if (a.activity_type !== sport) return false;
      if (!a.avg_hr || a.avg_hr < 80) return false;
      if (sport === 'running') return a.distance_km > 0.5 && a.duration_seconds > 300;
      return (a.avg_power != null || a.normalized_power != null) && a.duration_seconds > 300;
    });

    const pts: { sleep: number; ef: number; date: string; title: string }[] = [];

    for (const a of filtered) {
      const actDate = new Date(a.date).toISOString().split('T')[0];
      const prevDate = format(subDays(parseISO(actDate), 1), 'yyyy-MM-dd');
      const w = wellMap.get(prevDate);
      if (!w) continue;

      const sleepVal = metric === 'hours' ? w.sleep_hours : w.sleep_score;
      if (sleepVal == null || sleepVal < (metric === 'hours' ? 3 : 10)) continue;

      let ef: number;
      if (sport === 'running') {
        const speedKmMin = a.distance_km / (a.duration_seconds / 60);
        ef = speedKmMin / a.avg_hr!;
      } else {
        const power = a.normalized_power ?? a.avg_power ?? 0;
        ef = power / a.avg_hr!;
      }
      if (ef <= 0) continue;

      pts.push({ sleep: Number(sleepVal), ef: Math.round(ef * 10000) / 10000, date: actDate, title: a.title || a.activity_type });
    }

    if (pts.length < 3) return { points: pts, r: 0, trendLine: null, xLabel: '', yLabel: '' };

    const xs = pts.map(p => p.sleep);
    const ys = pts.map(p => p.ef);
    const r  = pearson(xs, ys);
    const fit = linearFit(xs, ys);

    let trendLine: { sleep: number; trend: number }[] | null = null;
    if (fit) {
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      trendLine = [
        { sleep: xMin, trend: Math.round((fit.slope * xMin + fit.intercept) * 10000) / 10000 },
        { sleep: xMax, trend: Math.round((fit.slope * xMax + fit.intercept) * 10000) / 10000 },
      ];
    }

    const xLabel = metric === 'hours' ? 'Sleep hours (previous night)' : 'Sleep score (previous night)';
    const yLabel = sport === 'running' ? 'EF (km/min ÷ bpm)' : 'EF (W ÷ bpm)';

    return { points: pts, r, trendLine, xLabel, yLabel };
  }, [activities, wellMap, sport, metric]);

  const rl = rLabel(r);

  // Merge scatter + trend into one dataset for ComposedChart
  const chartData = useMemo(() => {
    // For scatter: each point individually; trend line as separate dataset
    // ComposedChart needs same data array — we merge by index
    return points.map(p => ({ sleep: p.sleep, ef: p.ef, date: p.date, title: p.title }));
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <p>Not enough data yet.</p>
        <p className="text-xs">Need {sport} activities with HR data + previous-night sleep records.</p>
      </div>
    );
  }

  const isRunning = sport === 'running';

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex gap-1">
          {(['running', 'cycling'] as Sport[]).map(s => (
            <button key={s} onClick={() => setSport(s)}
              className={`text-xs px-2 py-0.5 rounded border capitalize transition ${sport === s ? 'bg-foreground text-background border-foreground font-semibold' : 'border-border text-muted-foreground hover:border-foreground/40'}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['hours', 'score'] as SleepMetric[]).map(m => (
            <button key={m} onClick={() => setMetric(m)}
              className={`text-xs px-2 py-0.5 rounded border capitalize transition ${metric === m ? 'bg-foreground text-background border-foreground font-semibold' : 'border-border text-muted-foreground hover:border-foreground/40'}`}>
              Sleep {m}
            </button>
          ))}
        </div>
        {/* Correlation badge */}
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">r = <span className="font-mono font-bold" style={{ color: rl.color }}>{r}</span></span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: rl.color + '22', color: rl.color }}>{rl.text}</span>
          <span className="text-muted-foreground text-[10px]">({points.length} activities)</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart margin={{ top: 4, right: 8, left: -12, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" />
          <XAxis
            type="number"
            dataKey="sleep"
            domain={['auto', 'auto']}
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            label={{ value: xLabel, position: 'insideBottom', offset: -12, fontSize: 10, fill: 'hsl(240 5% 50%)' }}
          />
          <YAxis
            type="number"
            dataKey="ef"
            domain={['auto', 'auto']}
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => v.toFixed(isRunning ? 3 : 2)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              if (!d?.date) return null;
              return (
                <div style={TOOLTIP_STYLE} className="p-2.5">
                  <p className="font-semibold mb-1 text-foreground">{format(parseISO(d.date), 'd MMM yyyy')}</p>
                  <p className="text-muted-foreground text-[10px]">{d.title}</p>
                  <p className="text-[10px]">Sleep: <span className="font-mono">{d.sleep}{metric === 'hours' ? 'h' : ''}</span></p>
                  <p className="text-[10px]">EF: <span className="font-mono">{d.ef.toFixed(isRunning ? 4 : 3)}</span></p>
                </div>
              );
            }}
          />
          {/* Scatter points */}
          <Scatter
            data={chartData}
            fill={isRunning ? '#3B82F6' : '#22C55E'}
            fillOpacity={0.7}
            r={4}
          />
          {/* Trend line */}
          {trendLine && (
            <Line
              data={trendLine}
              dataKey="trend"
              dot={false}
              stroke={rl.color}
              strokeWidth={2}
              strokeDasharray="5 3"
              type="linear"
              legendType="none"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
        Each dot = one {sport} session. X = previous night&apos;s sleep. Y = aerobic efficiency (speed or power ÷ HR). 
        {r > 0.2 ? ' Upward trend means more sleep → better performance for you.' : r < -0.2 ? ' Unexpected negative trend — may reflect selection bias (more sleep on rest days).' : ' No clear pattern yet — more data helps.'}
      </p>
    </div>
  );
}
