'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useDataVersion } from '@/lib/data-refresh';
import { loadSettings, getAge } from '@/lib/settings';
import {
  predictedVitalCapacity, predictedMIP, predictedMEP, percentOfPredicted, linearTrend,
} from '@/lib/respiratory';
import type { ExerciseLog } from '@/lib/exercises';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };
const TREND_COLOR = 'hsl(240 5% 50%)';
const BENCH_COLOR = 'hsl(240 5% 40%)';

const METRICS = [
  { key: 'vital_capacity_l',     label: 'Lung capacity',        unit: 'L',    color: '#3987e5', decimals: 2, step: 0.5 },
  { key: 'inspiratory_strength', label: 'Inspiratory strength', unit: ' cmH₂O', color: '#199e70', decimals: 1, step: 10 },
  { key: 'expiratory_strength',  label: 'Expiratory strength',  unit: ' cmH₂O', color: '#d55181', decimals: 1, step: 10 },
] as const;

type MetricKey = typeof METRICS[number]['key'];
type Metric = typeof METRICS[number];

interface Props {
  cutoff: Date;
  height?: number;
}

/** Tidy bounds with headroom, widened to keep the benchmark line in frame. */
function paddedDomain(values: number[], step: number, benchmark: number | null): [number, number] {
  const all = benchmark != null ? [...values, benchmark] : values;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = Math.max((hi - lo) * 0.12, step);
  return [
    Math.max(0, Math.floor((lo - pad) / step) * step),
    Math.ceil((hi + pad) / step) * step,
  ];
}

function Panel({ metric, rows, benchmark, height }: {
  metric: Metric;
  rows: { label: string; value: number | null }[];
  benchmark: number | null;
  height: number;
}) {
  const values = rows.map(r => r.value).filter((v): v is number => v != null);
  const trend = linearTrend(rows.map(r => r.value), metric.decimals);
  const data = rows.map((r, i) => ({ label: r.label, value: r.value, trend: trend[i] }));

  const latest = [...values].pop() ?? null;
  const first = values[0] ?? null;
  const delta = latest != null && first != null ? latest - first : null;
  const pct = percentOfPredicted(latest, benchmark);

  const domain = values.length ? paddedDomain(values, metric.step, benchmark) : undefined;
  const fmt = (v: number) => `${v.toFixed(metric.decimals === 2 ? 1 : 0)}`;

  return (
    <div className="flex-1 min-w-0 rounded-md border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{metric.label}</p>
      <p className="text-2xl font-bold font-mono leading-tight" style={{ color: metric.color }}>
        {latest != null ? `${latest}${metric.unit}` : '—'}
      </p>
      <div className="flex items-baseline gap-2 h-4 mb-2">
        {delta != null && delta !== 0 && (
          <span className={`text-[10px] font-mono ${delta > 0 ? 'text-green-400' : 'text-amber-400'}`}>
            {delta > 0 ? '↑ +' : '↓ '}{Math.round(delta * 100) / 100} vs first
          </span>
        )}
        {pct != null && (
          <span className="text-[10px] font-mono text-muted-foreground">{pct}% of predicted</span>
        )}
      </div>

      {values.length >= 2 && domain ? (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'hsl(240 5% 64.9%)' }}
              tickLine={false} axisLine={false}
              interval={Math.max(0, Math.floor(data.length / 4))} />
            <YAxis domain={domain} tickFormatter={fmt} width={34}
              tick={{ fontSize: 9, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
              formatter={(v: number, n: string) => [
                `${v}${metric.unit}`, n === 'trend' ? 'Trend' : metric.label,
              ]} />
            {benchmark != null && (
              <ReferenceLine y={benchmark} stroke={BENCH_COLOR} strokeDasharray="4 4"
                label={{ value: `peer ${fmt(benchmark)}`, position: 'insideTopRight',
                         fill: BENCH_COLOR, fontSize: 9 }} />
            )}
            <Line type="linear" dataKey="trend" stroke={TREND_COLOR} strokeWidth={1.5}
              strokeDasharray="5 3" dot={false} activeDot={false} connectNulls />
            <Line type="monotone" dataKey="value" stroke={metric.color} strokeWidth={2}
              dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ height }} className="flex items-center justify-center text-[11px] text-muted-foreground">
          Need 2+ readings
        </div>
      )}
    </div>
  );
}

export default function AirofitProgress({ cutoff, height = 180 }: Props) {
  const [logs, setLogs] = useState<ExerciseLog[] | null>(null);
  const [error, setError] = useState(false);
  const dataVersion = useDataVersion();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/exercises?days=3650&t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => { if (!cancelled) setLogs(Array.isArray(data.logs) ? data.logs : []); })
      .catch(() => { if (!cancelled) { setError(true); setLogs([]); } });
    return () => { cancelled = true; };
  }, [dataVersion]);

  // Only sessions carrying at least one device reading — a session logged for
  // time alone says nothing about respiratory capacity.
  const sessions = useMemo(() => (logs ?? [])
    .filter(l => l.exercise_key === 'airofit' && new Date(l.date) >= cutoff
              && METRICS.some(m => l[m.key] != null))
    .sort((a, b) => a.date.localeCompare(b.date)),
  [logs, cutoff]);

  // Predicted values depend on the profile, which lives in localStorage — read
  // it after mount so server and client render the same markup.
  const [benchmarks, setBenchmarks] = useState<Record<MetricKey, number | null> | null>(null);
  useEffect(() => {
    const s = loadSettings();
    const age = getAge(s);
    setBenchmarks({
      vital_capacity_l: predictedVitalCapacity(age, s.sex, s.heightCm),
      inspiratory_strength: predictedMIP(age, s.sex),
      expiratory_strength: predictedMEP(age, s.sex),
    });
  }, []);

  if (error) return <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Could not load Airofit data</div>;
  if (!logs) return <div className="h-32 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-6">
        <p className="text-sm text-muted-foreground">No Airofit readings in this period</p>
        <p className="text-[11px] text-muted-foreground/60 max-w-sm">
          Log lung capacity, inspiratory and expiratory strength under Data → Exercise Log.
          Session time alone won&apos;t appear here — this tracks the device&apos;s measurements.
        </p>
      </div>
    );
  }

  const rowsFor = (k: MetricKey) => sessions.map(s => ({
    label: format(parseISO(s.date.slice(0, 10)), 'd MMM'),
    value: s[k],
  }));

  const present = METRICS.filter(m => sessions.some(s => s[m.key] != null));
  const noHeight = benchmarks?.vital_capacity_l == null;

  return (
    <div className="space-y-3">
      {/* Three panels side by side; they stack on narrow screens rather than
          squeezing three axes into a phone width. */}
      <div className="flex flex-col sm:flex-row gap-3">
        {present.map(m => (
          <Panel key={m.key} metric={m} rows={rowsFor(m.key)} height={height}
            benchmark={benchmarks?.[m.key] ?? null} />
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/60 italic">
        {sessions.length} session{sessions.length !== 1 ? 's' : ''}. Solid line is your reading,
        dashed grey is the least-squares trend, and the horizontal dashed line is the predicted
        value for your age, sex and height — vital capacity from the ECCS/Quanjer equations,
        the two pressures from Black &amp; Hyatt (1969).{' '}
        <strong>Those pressure predictions come from a clinical lab maneuver</strong>, so a handheld
        trainer normally reads well below them, especially on the expiratory side. Your own trend is
        the meaningful signal; the peer line is orientation only, not a diagnosis.
        {noHeight && ' Add your height in Settings to show the lung-capacity benchmark.'}
      </p>
    </div>
  );
}
