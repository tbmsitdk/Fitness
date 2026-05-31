'use client';
import { useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { WellnessRecord } from '@/types';
import { format, parseISO, subDays } from 'date-fns';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

type Period = '30d' | '90d' | 'all';

function median(arr: number[]): number {
  if (arr.length === 0) return 7.5;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export default function SleepDebtChart({
  wellness,
  height = 220,
}: {
  wellness: WellnessRecord[];
  height?: number;
}) {
  const [period, setPeriod] = useState<Period>('30d');

  const { chartData, baseline, lastNight, sevenDayDebt } = useMemo(() => {
    const sorted = [...wellness]
      .filter(w => w.sleep_hours != null)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (sorted.length === 0) return { chartData: [], baseline: 0, lastNight: null, sevenDayDebt: 0 };

    // Rolling 30-day median baseline per record
    const baselineMap = new Map<string, number>();
    for (let i = 0; i < sorted.length; i++) {
      const windowStart = i >= 30 ? i - 29 : 0;
      const window = sorted.slice(windowStart, i + 1).map(w => w.sleep_hours as number);
      baselineMap.set(sorted[i].date, median(window));
    }

    // Daily deficit
    const records = sorted.map(w => ({
      date: w.date,
      sleep: w.sleep_hours as number,
      baseline: baselineMap.get(w.date) ?? 7.5,
      deficit: (baselineMap.get(w.date) ?? 7.5) - (w.sleep_hours as number),
    }));

    // 7-day cumulative debt
    const withDebt = records.map((r, i) => {
      const start = Math.max(0, i - 6);
      const debt = records.slice(start, i + 1).reduce((s, d) => s + d.deficit, 0);
      return { ...r, debt7d: Math.round(debt * 100) / 100 };
    });

    // Filter by period
    const now = new Date();
    const cutoff = period === 'all' ? new Date(0) : subDays(now, period === '30d' ? 30 : 90);
    const filtered = withDebt.filter(r => new Date(r.date) >= cutoff);

    const last = filtered[filtered.length - 1];
    const overallBaseline = baselineMap.get(sorted[sorted.length - 1].date) ?? 7.5;

    const spanYears = filtered.length > 0 && new Set(filtered.map(r => r.date.substring(0, 4))).size > 1;
    const dateFmt = spanYears ? "MMM ''yy" : 'MMM d';

    return {
      chartData: filtered.map(r => ({
        label: format(parseISO(r.date), dateFmt),
        sleep: Math.round(r.sleep * 10) / 10,
        baseline: Math.round(r.baseline * 10) / 10,
        debt7d: r.debt7d,
      })),
      baseline: Math.round(overallBaseline * 10) / 10,
      lastNight: last?.sleep ?? null,
      sevenDayDebt: last?.debt7d ?? 0,
    };
  }, [wellness, period]);

  if (chartData.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
        No sleep data available
      </div>
    );
  }

  const debtColor = sevenDayDebt > 3 ? '#EF4444' : sevenDayDebt > 1 ? '#F59E0B' : '#22C55E';

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex gap-3 flex-wrap">
        <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Baseline (30d median)</p>
          <p className="text-2xl font-bold font-mono text-foreground">{baseline}h</p>
        </div>
        {lastNight != null && (
          <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
            <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Last Night</p>
            <p className="text-2xl font-bold font-mono text-blue-400">{lastNight}h</p>
          </div>
        )}
        <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground">7-Day Debt</p>
          <p className="text-2xl font-bold font-mono" style={{ color: debtColor }}>
            {sevenDayDebt > 0 ? '+' : ''}{sevenDayDebt}h
          </p>
        </div>
        {/* Period selector */}
        <div className="ml-auto flex rounded-md overflow-hidden border border-border text-[11px] self-center">
          {(['30d', '90d', 'all'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2 py-1 transition ${period === p ? 'bg-foreground text-background font-semibold' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            interval={Math.max(1, Math.floor(chartData.length / 12))}
          />
          <YAxis
            yAxisId="sleep"
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            domain={[0, 10]}
            tickFormatter={v => `${v}h`}
          />
          <YAxis
            yAxisId="debt"
            orientation="right"
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v}h`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, name: string) => {
              if (name === 'sleep') return [`${v}h`, 'Sleep'];
              if (name === 'baseline') return [`${v}h`, 'Baseline'];
              if (name === 'debt7d') return [`${v > 0 ? '+' : ''}${v}h`, '7-Day Debt'];
              return [v, name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(240 5% 64.9%)', paddingTop: 8 }} iconSize={6} />
          <Bar yAxisId="sleep" dataKey="sleep" name="sleep" fill="#3B82F6" opacity={0.75} radius={[3, 3, 0, 0]} />
          <Line yAxisId="sleep" dataKey="baseline" name="baseline" stroke="hsl(0 0% 55%)" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
          <Line yAxisId="debt" dataKey="debt7d" name="debt7d" stroke="#EF4444" strokeWidth={2} dot={false} />
          <ReferenceLine yAxisId="sleep" y={baseline} stroke="hsl(0 0% 40%)" strokeDasharray="3 2" strokeWidth={1} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 italic">
        Blue bars = nightly sleep. Dashed = rolling 30d median baseline. Red line = cumulative 7-day debt (right axis).
      </p>
    </div>
  );
}
