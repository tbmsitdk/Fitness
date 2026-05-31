'use client';
import { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { WellnessRecord } from '@/types';
import { format, parseISO } from 'date-fns';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function batteryColor(val: number): string {
  if (val > 70) return '#22C55E';
  if (val >= 40) return '#F59E0B';
  return '#EF4444';
}

type View = 'byDay' | 'trend';

export default function BodyBatteryChart({
  wellness,
  height = 220,
}: {
  wellness: WellnessRecord[];
  height?: number;
}) {
  const [view, setView] = useState<View>('trend');

  const sorted = useMemo(
    () => [...wellness].filter(w => w.body_battery != null).sort((a, b) => a.date.localeCompare(b.date)),
    [wellness]
  );

  const { byDow, trendData, latest, weeklyAvg, bestDow, worstDow } = useMemo(() => {
    if (sorted.length === 0) {
      return { byDow: [], trendData: [], latest: null, weeklyAvg: 0, bestDow: null, worstDow: null };
    }

    // By day of week
    const dowAccum: { sum: number; count: number }[] = Array.from({ length: 7 }, () => ({ sum: 0, count: 0 }));
    for (const w of sorted) {
      const dow = parseISO(w.date).getDay();
      dowAccum[dow].sum += w.body_battery as number;
      dowAccum[dow].count++;
    }
    const byDow = DOW_LABELS.map((label, i) => ({
      label,
      avg: dowAccum[i].count > 0 ? Math.round(dowAccum[i].sum / dowAccum[i].count) : null,
    }));

    // 7-day rolling average for trend
    const spanYears = new Set(sorted.map(r => r.date.substring(0, 4))).size > 1;
    const dateFmt = spanYears ? "MMM ''yy" : 'MMM d';
    const trendData = sorted.map((w, i) => {
      const start = Math.max(0, i - 6);
      const window = sorted.slice(start, i + 1);
      const avg7 = window.reduce((s, x) => s + (x.body_battery as number), 0) / window.length;
      return {
        label: format(parseISO(w.date), dateFmt),
        value: w.body_battery as number,
        avg7: Math.round(avg7 * 10) / 10,
      };
    });

    const last = sorted[sorted.length - 1];
    const recent = sorted.slice(-7);
    const weeklyAvg = Math.round(recent.reduce((s, w) => s + (w.body_battery as number), 0) / recent.length);

    const validDow = byDow.filter(d => d.avg != null);
    const bestDow = validDow.length > 0 ? validDow.reduce((best, d) => (d.avg! > best.avg! ? d : best)) : null;
    const worstDow = validDow.length > 0 ? validDow.reduce((worst, d) => (d.avg! < worst.avg! ? d : worst)) : null;

    return {
      byDow,
      trendData,
      latest: last?.body_battery ?? null,
      weeklyAvg,
      bestDow: bestDow?.label ?? null,
      worstDow: worstDow?.label ?? null,
    };
  }, [sorted]);

  if (sorted.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
        No body battery data available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary strip */}
      <div className="flex gap-3 flex-wrap items-center">
        {latest != null && (
          <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
            <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Latest</p>
            <p className="text-2xl font-bold font-mono" style={{ color: batteryColor(latest) }}>{latest}</p>
          </div>
        )}
        <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground">7-Day Avg</p>
          <p className="text-2xl font-bold font-mono" style={{ color: batteryColor(weeklyAvg) }}>{weeklyAvg}</p>
        </div>
        {bestDow && (
          <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
            <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Best Day</p>
            <p className="text-xl font-bold font-mono text-green-400">{bestDow}</p>
          </div>
        )}
        {worstDow && (
          <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
            <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Worst Day</p>
            <p className="text-xl font-bold font-mono text-red-400">{worstDow}</p>
          </div>
        )}
        <div className="ml-auto flex rounded-md overflow-hidden border border-border text-[11px] self-center">
          {([['byDay', 'By Day'], ['trend', 'Trend']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2 py-1 transition ${view === v ? 'bg-foreground text-background font-semibold' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'byDay' ? (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={byDow} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} domain={[0, 100]} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
              formatter={(v: number) => [v, 'Avg Body Battery']}
            />
            <ReferenceLine y={70} stroke="#22C55E" strokeDasharray="3 2" strokeWidth={1} label={{ value: '70', position: 'insideTopRight', fontSize: 9, fill: '#22C55E' }} />
            <ReferenceLine y={40} stroke="#F59E0B" strokeDasharray="3 2" strokeWidth={1} label={{ value: '40', position: 'insideTopRight', fontSize: 9, fill: '#F59E0B' }} />
            <Bar dataKey="avg" radius={[3, 3, 0, 0]}>
              {byDow.map((entry, i) => (
                <Cell key={i} fill={entry.avg != null ? batteryColor(entry.avg) : 'hsl(240 3.7% 13%)'} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(1, Math.floor(trendData.length / 12))}
            />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} domain={[0, 100]} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
              formatter={(v: number, name: string) => [v, name === 'avg7' ? '7-Day Avg' : 'Body Battery']}
            />
            <ReferenceLine y={70} stroke="#22C55E" strokeDasharray="3 2" strokeWidth={1} />
            <ReferenceLine y={40} stroke="#F59E0B" strokeDasharray="3 2" strokeWidth={1} />
            <Line dataKey="value" stroke="#F59E0B" strokeWidth={1} dot={false} opacity={0.5} />
            <Line dataKey="avg7" stroke="#22C55E" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <p className="text-[10px] text-muted-foreground/60 italic">
        Green &gt;70 (high), Amber 40–70 (moderate), Red &lt;40 (low). Trend view shows 7-day rolling average.
      </p>
    </div>
  );
}
