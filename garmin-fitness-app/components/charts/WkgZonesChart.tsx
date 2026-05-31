'use client';
import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Activity, WellnessRecord } from '@/types';
import { format, parseISO, startOfMonth } from 'date-fns';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

const COGGAN_CATEGORIES = [
  { label: 'Untrained',  min: 0,   max: 2.0, color: '#6B7280' },
  { label: 'Fair',       min: 2.0, max: 2.5, color: '#60A5FA' },
  { label: 'Moderate',   min: 2.5, max: 3.2, color: '#34D399' },
  { label: 'Good',       min: 3.2, max: 4.0, color: '#FBBF24' },
  { label: 'Very Good',  min: 4.0, max: 5.0, color: '#F97316' },
  { label: 'Exceptional',min: 5.0, max: 99,  color: '#EF4444' },
] as const;

function getCategory(wkg: number) {
  return COGGAN_CATEGORIES.find(c => wkg >= c.min && wkg < c.max) ?? COGGAN_CATEGORIES[0];
}

export default function WkgZonesChart({
  activities,
  wellness,
  height = 220,
}: {
  activities: Activity[];
  wellness: WellnessRecord[];
  height?: number;
}) {
  const { chartData, currentWkg, currentCategory } = useMemo(() => {
    const withFTP = activities
      .filter(a => a.ftp != null && a.ftp > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (withFTP.length === 0) return { chartData: [], currentWkg: null, currentCategory: null };

    // Most recent weight per month from wellness
    const monthWeight = new Map<string, number>();
    const sortedWellness = [...wellness].filter(w => w.weight_kg != null).sort((a, b) => a.date.localeCompare(b.date));
    for (const w of sortedWellness) {
      const month = format(startOfMonth(parseISO(w.date)), 'yyyy-MM');
      monthWeight.set(month, w.weight_kg as number);
    }

    // Fill forward — for a month with no weight reading, use most recent available
    function getWeight(month: string): number | null {
      if (monthWeight.has(month)) return monthWeight.get(month)!;
      // Walk backwards through months until we find one
      const months = Array.from(monthWeight.keys()).sort();
      const earlier = months.filter(m => m <= month);
      if (earlier.length > 0) return monthWeight.get(earlier[earlier.length - 1])!;
      return null;
    }

    // Group by month, take max FTP per month
    const monthFTP = new Map<string, number>();
    for (const a of withFTP) {
      const month = format(startOfMonth(parseISO(a.date)), 'yyyy-MM');
      const cur = monthFTP.get(month) ?? 0;
      if ((a.ftp as number) > cur) monthFTP.set(month, a.ftp as number);
    }

    const months = Array.from(monthFTP.keys()).sort();
    const spanYears = months.length > 0 && new Set(months.map(m => m.substring(0, 4))).size > 1;
    const dateFmt = spanYears ? "MMM ''yy" : 'MMM';

    const data = months.map(m => {
      const ftp = monthFTP.get(m) as number;
      const weight = getWeight(m);
      const wkg = weight ? Math.round((ftp / weight) * 100) / 100 : null;
      return {
        label: format(parseISO(m + '-01'), dateFmt),
        month: m,
        wkg,
        category: wkg ? getCategory(wkg) : null,
      };
    }).filter(d => d.wkg != null);

    const last = data[data.length - 1];

    return {
      chartData: data,
      currentWkg: last?.wkg ?? null,
      currentCategory: last?.category ?? null,
    };
  }, [activities, wellness]);

  if (chartData.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
        No FTP + weight data available to compute W/kg
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Current W/kg + category badge */}
      {currentWkg != null && currentCategory && (
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
            <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Current W/kg</p>
            <p className="text-3xl font-bold font-mono" style={{ color: currentCategory.color }}>{currentWkg}</p>
          </div>
          <div>
            <span
              className="text-sm font-semibold px-3 py-1 rounded-full"
              style={{ background: currentCategory.color + '22', color: currentCategory.color }}
            >
              {currentCategory.label}
            </span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {COGGAN_CATEGORIES.map(c => (
          <div key={c.label} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: c.color }} />
            <span className="text-[10px] text-muted-foreground">{c.label} ({c.min}–{c.max === 99 ? '5+' : c.max})</span>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v}`}
            domain={[0, 'auto']}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, name: string) => {
              if (name === 'wkg') {
                const cat = getCategory(v);
                return [`${v} W/kg — ${cat.label}`, 'Monthly Max W/kg'];
              }
              return [v, name];
            }}
          />
          <Bar dataKey="wkg" radius={[3, 3, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.category?.color ?? '#6B7280'} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 italic">
        W/kg = monthly max FTP ÷ body weight. Coggan categories: Untrained &lt;2.0 · Fair 2.0 · Moderate 2.5 · Good 3.2 · Very Good 4.0 · Exceptional 5.0+
      </p>
    </div>
  );
}
