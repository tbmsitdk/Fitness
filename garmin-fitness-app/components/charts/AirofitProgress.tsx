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
const METRICS = [
  { key: 'vital_capacity_l',     label: 'Lung capacity',       unit: 'L',  color: '#3987e5' },
  { key: 'inspiratory_strength', label: 'Inspiratory strength', unit: '',   color: '#199e70' },
  { key: 'expiratory_strength',  label: 'Expiratory strength',  unit: '',   color: '#d55181' },
] as const;

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
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
              interval={Math.max(0, Math.floor(chartData.length / 10))} />
            {/* One axis only — these share a comparable numeric range. Anchored
                at 0 so a flat series reads as genuinely flat. */}
            <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} domain={[0, 'auto']} />
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
              <Line key={m.key} type="monotone" dataKey={m.key} name={m.key} stroke={m.color}
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
        lung (vital) capacity in litres, plus inspiratory and expiratory strength. Rising values mean
        improving respiratory capacity. Training time is tracked separately in the routine card.
      </p>
    </div>
  );
}
