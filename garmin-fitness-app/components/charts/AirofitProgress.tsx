'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useDataVersion } from '@/lib/data-refresh';
import type { ExerciseLog } from '@/lib/exercises';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

// Respiratory metrics get their own categorical slots — distinct from the
// exercise-category palette, validated for the dark surface.
// Capacity is measured in litres (~3-6) and the two strength scores in device
// units (~80-130). They cannot share one axis — on a common scale the capacity
// line flattens against zero and its trend becomes unreadable. Each metric
// declares which axis it belongs to.
const METRICS = [
  { key: 'vital_capacity_l',     label: 'Lung capacity',        unit: 'L', color: '#3987e5', axis: 'capacity' },
  { key: 'inspiratory_strength', label: 'Inspiratory strength', unit: '',  color: '#199e70', axis: 'strength' },
  { key: 'expiratory_strength',  label: 'Expiratory strength',  unit: '',  color: '#d55181', axis: 'strength' },
] as const;

/** Round a [min,max] out to tidy bounds with ~12% headroom on each side, so
 *  lines sit in the middle of the plot rather than skimming its edges. */
function paddedDomain(values: number[], step: number): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // A dead-flat series has no range to pad — give it a visible band either side.
  const pad = Math.max((hi - lo) * 0.12, step);
  return [
    Math.max(0, Math.floor((lo - pad) / step) * step),
    Math.ceil((hi + pad) / step) * step,
  ];
}

type MetricKey = typeof METRICS[number]['key'];

interface Props {
  cutoff: Date;
  height?: number;
}

function Stat({ label, value, unit, color, delta }: {
  label: string; value: number | null; unit: string; color: string; delta: number | null;
}) {
  return (
    <div className="px-3 py-2 rounded-md border border-border bg-card">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-xl font-bold font-mono leading-tight" style={{ color }}>
        {value != null ? `${value}${unit}` : '—'}
      </p>
      {delta != null && delta !== 0 && (
        <p className={`text-[10px] font-mono ${delta > 0 ? 'text-green-400' : 'text-amber-400'}`}>
          {delta > 0 ? '↑ +' : '↓ '}{Math.round(delta * 100) / 100}{unit} vs first
        </p>
      )}
      {delta === 0 && <p className="text-[10px] text-muted-foreground">→ unchanged</p>}
    </div>
  );
}

export default function AirofitProgress({ cutoff, height = 240 }: Props) {
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

  // Only sessions that actually carry at least one device reading — a session
  // logged for time alone tells us nothing about respiratory capacity.
  const sessions = useMemo(() => {
    return (logs ?? [])
      .filter(l =>
        l.exercise_key === 'airofit' &&
        new Date(l.date) >= cutoff &&
        METRICS.some(m => l[m.key] != null)
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [logs, cutoff]);

  const chartData = useMemo(() => sessions.map(s => ({
    label: format(parseISO(s.date.slice(0, 10)), 'd MMM'),
    vital_capacity_l: s.vital_capacity_l,
    inspiratory_strength: s.inspiratory_strength,
    expiratory_strength: s.expiratory_strength,
  })), [sessions]);

  if (error) return <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Could not load Airofit data</div>;
  if (!logs) return <div className="h-32 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-6">
        <p className="text-sm text-muted-foreground">No Airofit readings in this period</p>
        <p className="text-[11px] text-muted-foreground/60 max-w-sm">
          Log lung capacity, inspiratory and expiratory strength under Data → Exercise Log.
          Session time alone won&apos;t appear here — this chart tracks the device&apos;s
          measurements, not how long you trained.
        </p>
      </div>
    );
  }

  // Which metrics actually have data — never plot an all-null series
  const present = METRICS.filter(m => sessions.some(s => s[m.key] != null));

  const latestOf = (k: MetricKey) => [...sessions].reverse().find(s => s[k] != null)?.[k] ?? null;
  const firstOf  = (k: MetricKey) => sessions.find(s => s[k] != null)?.[k] ?? null;

  // Fit each axis to the values actually plotted on it. Only render an axis if
  // something uses it, otherwise recharts reserves blank gutter space.
  const valuesOn = (axis: 'capacity' | 'strength') =>
    present.filter(m => m.axis === axis)
      .flatMap(m => sessions.map(s => s[m.key]))
      .filter((v): v is number => v != null);

  const capacityValues = valuesOn('capacity');
  const strengthValues = valuesOn('strength');
  const capacityDomain = capacityValues.length ? paddedDomain(capacityValues, 0.5) : undefined;
  const strengthDomain = strengthValues.length ? paddedDomain(strengthValues, 10) : undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {present.map(m => {
          const latest = latestOf(m.key);
          const first = firstOf(m.key);
          return (
            <Stat key={m.key} label={m.label} value={latest} unit={m.unit} color={m.color}
              delta={latest != null && first != null ? latest - first : null} />
          );
        })}
      </div>

      {chartData.length >= 2 ? (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
              interval={Math.max(0, Math.floor(chartData.length / 10))} />
            {/* Left: litres. Right: device strength score. Each fitted to its
                own values, so all three lines use the full plot height. Note
                neither is anchored at 0 — read these as trends, not magnitudes. */}
            {capacityDomain && (
              <YAxis yAxisId="capacity" orientation="left" domain={capacityDomain}
                tick={{ fontSize: 10, fill: '#3987e5' }} tickLine={false} axisLine={false}
                width={38} tickFormatter={(v: number) => `${v}L`} />
            )}
            {strengthDomain && (
              <YAxis yAxisId="strength" orientation="right" domain={strengthDomain}
                tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
                width={34} />
            )}
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
              formatter={(v: number, n: string) => {
                const m = METRICS.find(x => x.key === n);
                return [`${v}${m?.unit ?? ''}`, m?.label ?? n];
              }} />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8}
              formatter={(n: string) => (
                <span style={{ color: 'hsl(240 5% 64.9%)' }}>
                  {METRICS.find(x => x.key === n)?.label ?? n}
                </span>
              )} />
            {present.map(m => (
              <Line key={m.key} yAxisId={m.axis} type="monotone" dataKey={m.key} name={m.key} stroke={m.color}
                strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} connectNulls />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
          Need at least 2 sessions with readings to show a trend
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 italic">
        Airofit device measurements over {sessions.length} session{sessions.length !== 1 ? 's' : ''} —
        lung (vital) capacity in litres on the left axis, inspiratory and expiratory strength on the
        right. Each axis is fitted to its own range so all three trends are readable — neither starts
        at zero, so compare the shape of each line, not their heights against each other. Rising
        values mean improving respiratory capacity. Training time is tracked in the routine card.
      </p>
    </div>
  );
}
