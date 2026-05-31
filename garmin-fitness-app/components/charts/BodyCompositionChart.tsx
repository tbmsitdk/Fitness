'use client';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Area,
} from 'recharts';
import { WellnessRecord } from '@/types';
import { format, parseISO } from 'date-fns';
import { useState } from 'react';

const TOOLTIP_STYLE = {
  background: 'hsl(240 10% 7%)',
  border: '1px solid hsl(240 3.7% 13%)',
  borderRadius: '8px',
  fontSize: 11,
};

type Metric = 'fat' | 'muscle' | 'water' | 'bone' | 'visceral' | 'metabolic';

const METRICS: { id: Metric; label: string; color: string; unit: string; key: keyof WellnessRecord }[] = [
  { id: 'fat',      label: 'Body Fat %',     color: '#EF4444', unit: '%',  key: 'body_fat_pct'   },
  { id: 'muscle',   label: 'Muscle Mass',    color: '#3B82F6', unit: ' kg', key: 'muscle_mass_kg' },
  { id: 'water',    label: 'Body Water %',   color: '#06B6D4', unit: '%',  key: 'body_water_pct' },
  { id: 'bone',     label: 'Bone Mass',      color: '#F59E0B', unit: ' kg', key: 'bone_mass_kg'   },
  { id: 'visceral', label: 'Visceral Fat',   color: '#F97316', unit: '',   key: 'visceral_fat'   },
  { id: 'metabolic',label: 'Metabolic Age',  color: '#8B5CF6', unit: ' yrs', key: 'metabolic_age' },
];

// Healthy ranges for reference lines
const REFERENCES: Partial<Record<Metric, { low?: number; high?: number; label: string }>> = {
  fat:      { low: 10, high: 20, label: 'Healthy: 10–20% (male)' },
  visceral: { high: 9,           label: 'Healthy: <10' },
};

function rollingAvg(vals: (number | null)[], w: number): (number | null)[] {
  return vals.map((_, i) => {
    const slice = vals.slice(Math.max(0, i - w + 1), i + 1).filter((v): v is number => v != null);
    return slice.length >= 1 ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length * 10) / 10 : null;
  });
}

interface Props {
  wellness: WellnessRecord[];
  height?: number;
}

export default function BodyCompositionChart({ wellness, height = 280 }: Props) {
  const [metric, setMetric] = useState<Metric>('fat');

  const sorted = [...wellness]
    .filter(w => w.body_fat_pct != null || w.muscle_mass_kg != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-6">
        <p className="text-sm text-muted-foreground">No body composition data yet</p>
        <p className="text-[11px] text-muted-foreground/60 max-w-sm">
          Sync your Garmin smart scale (Index S2 or compatible) — the next daily sync will import
          body fat %, muscle mass, bone mass, body water %, visceral fat, and metabolic age.
        </p>
      </div>
    );
  }

  const cfg = METRICS.find(m => m.id === metric)!;
  const vals = sorted.map(w => w[cfg.key] as number | null);
  const avg7  = rollingAvg(vals, 7);

  const data = sorted.map((w, i) => ({
    label:   format(parseISO(w.date.slice(0, 10)), sorted.length > 90 ? "MMM ''yy" : 'd MMM'),
    value:   vals[i],
    avg7:    avg7[i],
  }));

  // Summary stats
  const nonNull = vals.filter((v): v is number => v != null);
  const latest  = nonNull.at(-1);
  const min     = nonNull.length ? Math.min(...nonNull) : null;
  const max     = nonNull.length ? Math.max(...nonNull) : null;
  const delta   = nonNull.length >= 2 ? Math.round((nonNull.at(-1)! - nonNull[0]) * 10) / 10 : null;

  const tickEvery = data.length > 90 ? 14 : data.length > 30 ? 7 : 3;
  const ticks     = data.filter((_, i) => i % tickEvery === 0).map(d => d.label);
  const ref       = REFERENCES[metric];

  // Latest reading summary across all metrics
  const latestRecord = sorted.at(-1);

  return (
    <div className="space-y-4">
      {/* Latest reading strip — all metrics */}
      {latestRecord && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {METRICS.map(m => {
            const v = latestRecord[m.key] as number | null;
            return (
              <button
                key={m.id}
                onClick={() => setMetric(m.id)}
                className={`rounded-md border p-2.5 text-left transition-colors ${
                  metric === m.id ? 'border-foreground bg-secondary' : 'border-border bg-secondary/30 hover:border-border/80'
                }`}
              >
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{m.label}</p>
                <p className="text-base font-semibold font-mono mt-0.5" style={{ color: m.color }}>
                  {v != null ? `${v}${m.unit}` : '—'}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Trend stats */}
      {latest != null && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Latest: <span className="font-semibold text-foreground">{latest}{cfg.unit}</span></span>
          {min != null && <span>Min: <span className="font-mono">{min}{cfg.unit}</span></span>}
          {max != null && <span>Max: <span className="font-mono">{max}{cfg.unit}</span></span>}
          {delta != null && (
            <span>Change: <span className={`font-semibold ${
              metric === 'fat' || metric === 'visceral' || metric === 'metabolic'
                ? delta < 0 ? 'text-green-400' : delta > 0 ? 'text-red-400' : 'text-muted-foreground'
                : delta > 0 ? 'text-green-400' : delta < 0 ? 'text-amber-400' : 'text-muted-foreground'
            }`}>{delta >= 0 ? '+' : ''}{delta}{cfg.unit}</span></span>
          )}
        </div>
      )}

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="bodyCompGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.12} />
              <stop offset="95%" stopColor={cfg.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="label" ticks={ticks} tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
          <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} width={36} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'hsl(0 0% 98%)' }}
            formatter={(v: number, name: string) => [`${v}${cfg.unit}`, name]}
          />
          {ref?.low  && <ReferenceLine y={ref.low}  stroke={cfg.color} strokeDasharray="4 3" strokeOpacity={0.5} />}
          {ref?.high && <ReferenceLine y={ref.high} stroke={cfg.color} strokeDasharray="4 3" strokeOpacity={0.5}
            label={{ value: ref.label, position: 'insideTopRight', fontSize: 9, fill: cfg.color }} />}
          <Area dataKey="value" fill="url(#bodyCompGrad)" stroke="none" connectNulls />
          <Line dataKey="value" name={cfg.label} stroke={cfg.color} strokeWidth={0}
            dot={{ r: 3, fill: cfg.color, fillOpacity: 0.6, strokeWidth: 0 }}
            activeDot={{ r: 5 }} connectNulls={false} />
          <Line dataKey="avg7" name="7-day avg" stroke={cfg.color} strokeWidth={2}
            dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-muted-foreground/60 italic">
        Data from Garmin smart scale · Dots = individual weigh-ins · Line = 7-day rolling average ·
        {metric === 'fat' && ' Healthy body fat: 10–20% (male) or 18–28% (female)'}
        {metric === 'muscle' && ' Higher is better — muscle mass increases with strength and endurance training'}
        {metric === 'visceral' && ' Visceral fat rating 1–9 = healthy, 10–14 = high, 15–30 = very high'}
        {metric === 'metabolic' && ' Metabolic age below chronological age indicates good fitness'}
        {metric === 'water' && ' Healthy body water: 50–65% (male) or 45–60% (female)'}
        {metric === 'bone' && ' Bone mass is relatively stable — changes slowly with training and nutrition'}
      </p>
    </div>
  );
}
