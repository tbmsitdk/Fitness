'use client';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Area, ScatterChart, Scatter,
} from 'recharts';
import { WellnessRecord, Activity } from '@/types';
import { format, parseISO, subDays } from 'date-fns';
import { useState } from 'react';
import { UserSettings, getAge } from '@/lib/settings';

const TOOLTIP_STYLE = {
  background: 'hsl(240 10% 7%)',
  border: '1px solid hsl(240 3.7% 13%)',
  borderRadius: '8px',
  fontSize: 11,
};

type Metric = 'fat' | 'muscle' | 'water' | 'bone' | 'visceral' | 'metabolic';

const METRICS: { id: Metric; label: string; color: string; unit: string; key: keyof WellnessRecord }[] = [
  { id: 'fat',      label: 'Body Fat %',    color: '#EF4444', unit: '%',   key: 'body_fat_pct'   },
  { id: 'muscle',   label: 'Muscle Mass',   color: '#3B82F6', unit: ' kg', key: 'muscle_mass_kg' },
  { id: 'water',    label: 'Body Water %',  color: '#06B6D4', unit: '%',   key: 'body_water_pct' },
  { id: 'bone',     label: 'Bone Mass',     color: '#F59E0B', unit: ' kg', key: 'bone_mass_kg'   },
  { id: 'visceral', label: 'Visceral Fat',  color: '#F97316', unit: '',    key: 'visceral_fat'   },
  { id: 'metabolic',label: 'Metabolic Age', color: '#8B5CF6', unit: ' yrs', key: 'metabolic_age' },
];

// Age/sex-adjusted benchmarks (male, ACSM / ACE norms)
function getBenchmarks(metric: Metric, age: number, sex: 'male' | 'female') {
  const isMale = sex === 'male';
  if (metric === 'fat') {
    // ACE body fat norms
    if (age < 40) return isMale
      ? { excellent: 8,  good: 14, average: 18, poor: 24, label: 'Age <40 male norms' }
      : { excellent: 16, good: 21, average: 25, poor: 32, label: 'Age <40 female norms' };
    if (age < 60) return isMale
      ? { excellent: 11, good: 17, average: 22, poor: 28, label: 'Age 40–59 male norms' }
      : { excellent: 18, good: 24, average: 29, poor: 35, label: 'Age 40–59 female norms' };
    return isMale
      ? { excellent: 13, good: 20, average: 25, poor: 30, label: 'Age 60+ male norms' }
      : { excellent: 19, good: 26, average: 31, poor: 37, label: 'Age 60+ female norms' };
  }
  if (metric === 'visceral') {
    return { healthy: 9, elevated: 14, label: 'Visceral fat rating scale' };
  }
  if (metric === 'metabolic') {
    return { target: age, label: `Your age: ${age}` };
  }
  if (metric === 'muscle') {
    // Rough norms for skeletal muscle mass (Garmin scale measures total muscle)
    if (isMale) return { excellent: 44, good: 38, average: 33, label: 'Male muscle mass norms (kg)' };
    return { excellent: 35, good: 29, average: 24, label: 'Female muscle mass norms (kg)' };
  }
  if (metric === 'water') {
    return isMale
      ? { low: 50, optimal: 60, label: 'Healthy: 50–65% (male)' }
      : { low: 45, optimal: 55, label: 'Healthy: 45–60% (female)' };
  }
  return null;
}

function ratingLabel(metric: Metric, value: number, age: number, sex: 'male' | 'female'): { label: string; color: string } {
  const bench = getBenchmarks(metric, age, sex);
  if (!bench) return { label: '', color: 'text-muted-foreground' };
  if (metric === 'fat') {
    const b = bench as { excellent: number; good: number; average: number; poor: number };
    if (value <= b.excellent) return { label: 'Excellent', color: 'text-green-400' };
    if (value <= b.good)      return { label: 'Good',      color: 'text-green-400' };
    if (value <= b.average)   return { label: 'Average',   color: 'text-amber-400' };
    if (value <= b.poor)      return { label: 'Above avg', color: 'text-orange-400' };
    return { label: 'High', color: 'text-red-400' };
  }
  if (metric === 'visceral') {
    const b = bench as { healthy: number; elevated: number };
    if (value <= b.healthy)   return { label: 'Healthy',  color: 'text-green-400' };
    if (value <= b.elevated)  return { label: 'Elevated', color: 'text-amber-400' };
    return { label: 'High', color: 'text-red-400' };
  }
  if (metric === 'metabolic') {
    const b = bench as { target: number };
    const delta = value - b.target;
    if (delta <= -5) return { label: `${Math.abs(delta)} yrs younger`, color: 'text-green-400' };
    if (delta <= 0)  return { label: `On target`,                      color: 'text-green-400' };
    if (delta <= 5)  return { label: `${delta} yrs older`,             color: 'text-amber-400' };
    return { label: `${delta} yrs older`, color: 'text-red-400' };
  }
  if (metric === 'muscle') {
    const b = bench as { excellent: number; good: number; average: number };
    if (value >= b.excellent) return { label: 'Excellent', color: 'text-green-400' };
    if (value >= b.good)      return { label: 'Good',      color: 'text-green-400' };
    if (value >= b.average)   return { label: 'Average',   color: 'text-amber-400' };
    return { label: 'Below avg', color: 'text-red-400' };
  }
  return { label: '', color: 'text-muted-foreground' };
}

function rollingAvg(vals: (number | null)[], w: number): (number | null)[] {
  return vals.map((_, i) => {
    const slice = vals.slice(Math.max(0, i - w + 1), i + 1).filter((v): v is number => v != null);
    return slice.length >= 1 ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length * 10) / 10 : null;
  });
}

interface Props {
  wellness: WellnessRecord[];
  activities?: Activity[];
  settings?: UserSettings;
  height?: number;
}

export default function BodyCompositionChart({ wellness, activities = [], settings, height = 280 }: Props) {
  const [metric, setMetric] = useState<Metric>('fat');
  const [showCorrelation, setShowCorrelation] = useState(false);

  const age = settings ? getAge(settings) : 45;
  const sex = settings?.sex ?? 'male';

  const sorted = [...wellness]
    .filter(w => METRICS.some(m => w[m.key] != null))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-6">
        <p className="text-sm text-muted-foreground">No body composition data yet</p>
        <p className="text-[11px] text-muted-foreground/60 max-w-sm">
          Sync your Garmin smart scale — the next daily sync will import body fat %, muscle mass,
          bone mass, body water %, visceral fat rating, and metabolic age.
        </p>
      </div>
    );
  }

  const cfg  = METRICS.find(m => m.id === metric)!;
  const vals = sorted.map(w => w[cfg.key] as number | null);
  const avg7 = rollingAvg(vals, 7);
  const bench = getBenchmarks(metric, age, sex);

  const data = sorted.map((w, i) => ({
    label: format(parseISO(w.date.slice(0, 10)), sorted.length > 90 ? "MMM ''yy" : 'd MMM'),
    value: vals[i],
    avg7:  avg7[i],
  }));

  const nonNull = vals.filter((v): v is number => v != null);
  const latest  = nonNull.at(-1);
  const delta   = nonNull.length >= 2 ? Math.round((nonNull.at(-1)! - nonNull[0]) * 10) / 10 : null;
  const rating  = latest != null ? ratingLabel(metric, latest, age, sex) : null;

  const tickEvery = data.length > 90 ? 14 : data.length > 30 ? 7 : 3;
  const ticks     = data.filter((_, i) => i % tickEvery === 0).map(d => d.label);

  // ── Correlation: body fat vs resting HR (last 90 days matched by date)
  const corrData = (() => {
    if (!showCorrelation) return [];
    const cutoff = subDays(new Date(), 90);
    const wellMap = new Map(sorted.map(w => [w.date.slice(0, 10), w]));
    return sorted
      .filter(w => new Date(w.date) >= cutoff && w.body_fat_pct != null && w.resting_hr != null)
      .map(w => ({ fat: w.body_fat_pct as number, rhr: w.resting_hr as number }));
  })();

  // ── Correlation: muscle mass vs latest FTP/power
  const muscleVsPower = (() => {
    if (!showCorrelation || !activities.length) return [];
    const wellMap = new Map(sorted.map(w => [w.date.slice(0, 10), w]));
    return activities
      .filter(a => a.activity_type === 'cycling' && a.avg_power && a.avg_power > 0)
      .map(a => {
        const d = a.date.slice(0, 10);
        const muscle = wellMap.get(d)?.muscle_mass_kg;
        return muscle != null ? { muscle, power: a.avg_power as number } : null;
      })
      .filter((x): x is { muscle: number; power: number } => x != null);
  })();

  const latestRecord = sorted.at(-1);

  return (
    <div className="space-y-4">
      {/* Latest readings grid — click to switch metric */}
      {latestRecord && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {METRICS.map(m => {
            const v = latestRecord[m.key] as number | null;
            const r = v != null ? ratingLabel(m.id, v, age, sex) : null;
            return (
              <button
                key={m.id}
                onClick={() => { setMetric(m.id); setShowCorrelation(false); }}
                className={`rounded-md border p-2.5 text-left transition-colors ${
                  metric === m.id && !showCorrelation
                    ? 'border-foreground bg-secondary'
                    : 'border-border bg-secondary/30 hover:border-border/80'
                }`}
              >
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{m.label}</p>
                <p className="text-base font-semibold font-mono mt-0.5" style={{ color: m.color }}>
                  {v != null ? `${v}${m.unit}` : '—'}
                </p>
                {r?.label && <p className={`text-[9px] font-medium ${r.color}`}>{r.label}</p>}
              </button>
            );
          })}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-0.5">
          {METRICS.map(m => (
            <button key={m.id} onClick={() => { setMetric(m.id); setShowCorrelation(false); }}
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                metric === m.id && !showCorrelation ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}>
              {m.label}
            </button>
          ))}
        </div>
        {(corrData.length > 3 || muscleVsPower.length > 3) && (
          <button onClick={() => setShowCorrelation(v => !v)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
              showCorrelation ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}>
            Correlations
          </button>
        )}
      </div>

      {/* Trend chart */}
      {!showCorrelation && (
        <>
          {/* Status bar */}
          {latest != null && (
            <div className="flex items-center gap-4 text-xs">
              <span>Latest: <span className="font-semibold font-mono">{latest}{cfg.unit}</span></span>
              {rating?.label && <span className={`font-semibold ${rating.color}`}>{rating.label}</span>}
              {delta != null && (
                <span className="text-muted-foreground">Change: <span className={`font-semibold ${
                  metric === 'fat' || metric === 'visceral' || metric === 'metabolic'
                    ? delta < 0 ? 'text-green-400' : delta > 0 ? 'text-red-400' : ''
                    : delta > 0 ? 'text-green-400' : delta < 0 ? 'text-amber-400' : ''
                }`}>{delta >= 0 ? '+' : ''}{delta}{cfg.unit}</span></span>
              )}
              {bench && 'label' in bench && (
                <span className="text-muted-foreground/60 text-[10px]">{(bench as {label:string}).label}</span>
              )}
            </div>
          )}

          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="bcGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.12} />
                  <stop offset="95%" stopColor={cfg.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
              <XAxis dataKey="label" ticks={ticks} tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} width={36} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)' }}
                formatter={(v: number) => [`${v}${cfg.unit}`, cfg.label]} />

              {/* Benchmark reference lines */}
              {metric === 'fat' && bench && 'good' in bench && (
                <>
                  <ReferenceLine y={(bench as {excellent:number}).excellent} stroke="#22C55E" strokeDasharray="3 3" strokeOpacity={0.6}
                    label={{ value: 'Excellent', position: 'insideTopRight', fontSize: 9, fill: '#22C55E' }} />
                  <ReferenceLine y={(bench as {average:number}).average} stroke="#F59E0B" strokeDasharray="3 3" strokeOpacity={0.6}
                    label={{ value: 'Avg', position: 'insideTopRight', fontSize: 9, fill: '#F59E0B' }} />
                  <ReferenceLine y={(bench as {poor:number}).poor} stroke="#EF4444" strokeDasharray="3 3" strokeOpacity={0.6}
                    label={{ value: 'High', position: 'insideTopRight', fontSize: 9, fill: '#EF4444' }} />
                </>
              )}
              {metric === 'visceral' && bench && 'healthy' in bench && (
                <>
                  <ReferenceLine y={(bench as {healthy:number}).healthy} stroke="#22C55E" strokeDasharray="3 3" strokeOpacity={0.6}
                    label={{ value: '≤9 healthy', position: 'insideTopRight', fontSize: 9, fill: '#22C55E' }} />
                  <ReferenceLine y={(bench as {elevated:number}).elevated} stroke="#F59E0B" strokeDasharray="3 3" strokeOpacity={0.6}
                    label={{ value: '≤14 elevated', position: 'insideTopRight', fontSize: 9, fill: '#F59E0B' }} />
                </>
              )}
              {metric === 'metabolic' && bench && 'target' in bench && (
                <ReferenceLine y={(bench as {target:number}).target} stroke="#A78BFA" strokeDasharray="4 3" strokeOpacity={0.8}
                  label={{ value: `Your age: ${age}`, position: 'insideTopRight', fontSize: 9, fill: '#A78BFA' }} />
              )}
              {metric === 'muscle' && bench && 'good' in bench && (
                <>
                  <ReferenceLine y={(bench as {excellent:number}).excellent} stroke="#22C55E" strokeDasharray="3 3" strokeOpacity={0.6}
                    label={{ value: 'Excellent', position: 'insideTopRight', fontSize: 9, fill: '#22C55E' }} />
                  <ReferenceLine y={(bench as {average:number}).average} stroke="#F59E0B" strokeDasharray="3 3" strokeOpacity={0.6}
                    label={{ value: 'Average', position: 'insideTopRight', fontSize: 9, fill: '#F59E0B' }} />
                </>
              )}
              {metric === 'water' && bench && 'optimal' in bench && (
                <>
                  <ReferenceLine y={(bench as {low:number}).low} stroke="#F59E0B" strokeDasharray="3 3" strokeOpacity={0.6}
                    label={{ value: 'Min', position: 'insideTopRight', fontSize: 9, fill: '#F59E0B' }} />
                  <ReferenceLine y={(bench as {optimal:number}).optimal} stroke="#22C55E" strokeDasharray="3 3" strokeOpacity={0.6}
                    label={{ value: 'Optimal', position: 'insideTopRight', fontSize: 9, fill: '#22C55E' }} />
                </>
              )}

              <Area dataKey="value" fill="url(#bcGrad)" stroke="none" connectNulls />
              <Line dataKey="value" name={cfg.label} stroke={cfg.color} strokeWidth={0}
                dot={{ r: 3, fill: cfg.color, fillOpacity: 0.6, strokeWidth: 0 }}
                activeDot={{ r: 5 }} connectNulls={false} />
              <Line dataKey="avg7" name="7-day avg" stroke={cfg.color} strokeWidth={2}
                dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </>
      )}

      {/* Correlations panel */}
      {showCorrelation && (
        <div className="space-y-4">
          {corrData.length > 3 && (
            <div>
              <p className="text-xs font-medium mb-2 text-muted-foreground">Body Fat % vs Resting HR <span className="text-[10px]">(last 90 days — higher fat often correlates with higher RHR)</span></p>
              <ResponsiveContainer width="100%" height={200}>
                <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" />
                  <XAxis dataKey="fat" name="Body Fat %" unit="%" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="rhr" name="Resting HR" unit=" bpm" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number, n: string) => [n === 'Body Fat %' ? `${v}%` : `${v} bpm`, n]} />
                  <Scatter data={corrData} fill="#EF4444" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
          {muscleVsPower.length > 3 && (
            <div>
              <p className="text-xs font-medium mb-2 text-muted-foreground">Muscle Mass vs Cycling Power <span className="text-[10px]">(more muscle generally = more power output)</span></p>
              <ResponsiveContainer width="100%" height={200}>
                <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" />
                  <XAxis dataKey="muscle" name="Muscle Mass" unit=" kg" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="power" name="Avg Power" unit=" W" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number, n: string) => [n === 'Muscle Mass' ? `${v} kg` : `${v} W`, n]} />
                  <Scatter data={muscleVsPower} fill="#3B82F6" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {!showCorrelation && (
        <p className="text-[10px] text-muted-foreground/60 italic">
          Benchmarks based on ACE/ACSM norms for age {age} {sex} ·
          {metric === 'fat' && ' Lower is better — excess fat increases cardiovascular risk'}
          {metric === 'muscle' && ' Higher is better — muscle mass declines ~3–8% per decade after 30 without training'}
          {metric === 'visceral' && ' Rating 1–9 = healthy, 10–14 = elevated, 15–30 = high risk'}
          {metric === 'metabolic' && ' Metabolic age below chronological age = above-average fitness'}
          {metric === 'water' && ' Hydration affects performance, recovery and heart rate accuracy'}
          {metric === 'bone' && ' Bone mass is relatively stable — weight-bearing exercise maintains it'}
        </p>
      )}
    </div>
  );
}
