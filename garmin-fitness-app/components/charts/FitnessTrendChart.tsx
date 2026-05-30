'use client';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { WellnessRecord } from '@/types';
import { format, parseISO } from 'date-fns';
import { getPeerBenchmarks } from '@/lib/benchmarks';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

const CONFIG = {
  hrv:         { key: 'hrv_rmssd'     as keyof WellnessRecord, label: 'HRV',           color: '#8B5CF6', unit: 'ms'         },
  rhr:         { key: 'resting_hr'    as keyof WellnessRecord, label: 'Resting HR',    color: '#EF4444', unit: 'bpm'        },
  sleep:       { key: 'sleep_hours'   as keyof WellnessRecord, label: 'Sleep',         color: '#3B82F6', unit: 'h'          },
  stress:      { key: 'stress_score'  as keyof WellnessRecord, label: 'Stress',        color: '#F97316', unit: ''           },
  battery:     { key: 'body_battery'  as keyof WellnessRecord, label: 'Body Battery',  color: '#22C55E', unit: '%'          },
  score:       { key: 'sleep_score'   as keyof WellnessRecord, label: 'Sleep Score',   color: '#06B6D4', unit: ''           },
  vo2max:      { key: 'vo2max'        as keyof WellnessRecord, label: 'VO₂ Max',       color: '#10B981', unit: 'ml/kg/min'  },
  fitness_age: { key: 'fitness_age'   as keyof WellnessRecord, label: 'Fitness Age',   color: '#F59E0B', unit: 'yrs'        },
};

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
  return values.map((_, i) => Math.round((slope * i + intercept) * 100) / 100);
}

export type WellnessMetric = 'hrv' | 'rhr' | 'sleep' | 'stress' | 'battery' | 'score' | 'vo2max' | 'fitness_age';

export default function FitnessTrendChart({ wellness, metric, age, height = 200 }: { wellness: WellnessRecord[]; metric: WellnessMetric; age?: number; height?: number }) {
  const cfg = CONFIG[metric];
  const peer = getPeerBenchmarks(age ?? 55);
  const BENCHMARKS: Record<WellnessMetric, { value: number; label: string; note: string } | null> = {
    hrv:         { value: peer.hrv,   label: `Age ${peer.label} peer avg ${peer.hrv}ms`,  note: `Typical active adult age ${peer.label}` },
    rhr:         { value: peer.rhr,   label: `Age ${peer.label} peer avg ${peer.rhr}bpm`, note: `Active adult age ${peer.label}` },
    sleep:       { value: peer.sleep, label: `Age ${peer.label} target ${peer.sleep}h`,   note: 'Sleep science recommendation' },
    stress:      { value: 25,  label: 'Target <25 (low stress)',    note: 'Garmin stress 0–100; <25 = low. On Vivosmart 5 this IS the HRV-derived metric (Firstbeat Analytics).' },
    battery:     { value: 75,  label: 'Target ≥75% charged',        note: 'High body battery = well recovered' },
    score:       { value: 80,  label: 'Target ≥80 sleep score',     note: 'Garmin sleep score 0–100' },
    vo2max:      { value: 45,  label: 'Target ≥45 (good fitness)',  note: 'Peter Attia: VO₂max is the strongest predictor of longevity. Elite >55, Good >45, Average >35.' },
    fitness_age: { value: peer.age, label: `Target = chronological age (${peer.age})`, note: 'Garmin Fitness Age: computed from VO₂max vs age-matched peers. Lower = fitter. Powers VO₂max tracking on Vivosmart 5.' },
  };
  const bench = BENCHMARKS[metric];

  // For HRV: if no RMSSD data, fall back to stress_score (which IS the HRV metric on Vivosmart 5)
  const hasHrvData = metric === 'hrv' && wellness.some(w => w.hrv_rmssd != null);
  const usingStressAsHrv = metric === 'hrv' && !hasHrvData && wellness.some(w => w.stress_score != null);
  const effectiveCfg = usingStressAsHrv
    ? { ...CONFIG.stress, label: 'HRV-derived Stress', unit: '' }
    : cfg;
  const effectiveKey = usingStressAsHrv ? 'stress_score' : cfg.key;

  const filtered = wellness.filter(w => w[effectiveKey as keyof WellnessRecord] != null);
  const values = filtered.map(w => w[effectiveKey as keyof WellnessRecord] as number);
  const trend = linearTrend(values);

  const spanYears = new Set(filtered.map(w => w.date.substring(0, 4))).size > 1;
  const dateFmt = spanYears ? "MMM ''yy" : 'MMM d';

  const data = filtered.map((w, i) => {
    const raw = w[effectiveKey as keyof WellnessRecord];
    return {
      date: format(parseISO(w.date), dateFmt),
      [effectiveCfg.label]: typeof raw === 'number' ? raw : null,
      Trend: trend[i],
    };
  }).filter(d => d[effectiveCfg.label] != null);

  const tickInterval = Math.max(1, Math.floor(data.length / 10));

  if (!data.length) {
    return (
      <div className="h-[200px] flex flex-col items-center justify-center gap-2 text-center px-6">
        <p className="text-xs text-muted-foreground">No {cfg.label} data in export</p>
        {(metric === 'vo2max' || metric === 'fitness_age') && (
          <p className="text-[11px] text-muted-foreground/70 max-w-sm">
            VO₂ Max and Fitness Age require a live Garmin sync (not available in ZIP export).
            Run the daily sync to populate this data.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={tickInterval} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} domain={[(dataMin: number) => Math.floor(dataMin * 0.97), (dataMax: number) => Math.ceil(dataMax * 1.03)]} tickCount={5} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)' }}
            formatter={(v: number, n: string) => n === 'Trend' ? [`${v} ${effectiveCfg.unit}`, 'Trend'] : [`${v} ${effectiveCfg.unit}`, effectiveCfg.label]} />
          {bench && !usingStressAsHrv && <ReferenceLine y={bench.value} stroke="hsl(45 93% 58%)" strokeDasharray="5 3" strokeWidth={1.5}
            label={{ value: bench.label, position: 'insideTopRight', fontSize: 9, fill: 'hsl(45 93% 58%)' }} />}
          <Line type="monotone" dataKey={effectiveCfg.label} stroke={effectiveCfg.color} strokeWidth={1.5} dot={false}
            activeDot={{ r: 3, fill: effectiveCfg.color }} />
          <Line type="monotone" dataKey="Trend" stroke="hsl(0 0% 55%)" strokeWidth={1.5} dot={false}
            strokeDasharray="5 3" legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      {bench && !usingStressAsHrv && <p className="text-[10px] text-muted-foreground/60 mt-1 italic">Yellow = {bench.label} ({bench.note}). Grey dashed = your trend.</p>}
      {usingStressAsHrv && (
        <p className="text-[10px] text-purple-400/70 mt-1 italic">
          ⟳ Your Vivosmart 5 does not export raw HRV (RMSSD). Showing <strong>Stress score</strong> instead — this IS your HRV metric, computed from beat-to-beat intervals via Firstbeat Analytics. Lower = more recovered. Target: below 25.
        </p>
      )}
      {metric === 'stress' && !usingStressAsHrv && (
        <p className="text-[10px] text-amber-400/70 mt-0.5 italic">
          ⟳ On Garmin Vivosmart 5 this score IS the HRV metric — the device converts beat-to-beat intervals into a 0–100 stress index via Firstbeat Analytics.
        </p>
      )}
      {metric === 'fitness_age' && (
        <p className="text-[10px] text-amber-400/70 mt-0.5 italic">
          ⟳ Fitness Age is computed from your VO₂ Max estimate. A fitness age below your chronological age means your cardio fitness is above average for your cohort.
        </p>
      )}
    </div>
  );
}
