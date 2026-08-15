'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { format, parseISO, startOfWeek } from 'date-fns';
import {
  EXERCISES, EXERCISE_BY_KEY, CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER,
  primaryUnit, primaryValue, type ExerciseLog, type ExerciseCategory,
} from '@/lib/exercises';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

interface Props {
  cutoff: Date;
  height?: number;
}

export default function ExerciseProgress({ cutoff, height = 240 }: Props) {
  const [logs, setLogs] = useState<ExerciseLog[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string>('squats');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/exercises?days=3650&t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => { if (!cancelled) setLogs(Array.isArray(data.logs) ? data.logs : []); })
      .catch(() => { if (!cancelled) { setError(true); setLogs([]); } });
    return () => { cancelled = true; };
  }, []);

  const inPeriod = useMemo(
    () => (logs ?? []).filter(l => new Date(l.date) >= cutoff),
    [logs, cutoff]
  );

  // Which exercises actually have data — only offer those as selectable
  const loggedKeys = useMemo(() => {
    const keys = new Set(inPeriod.map(l => l.exercise_key));
    return EXERCISES.filter(e => keys.has(e.key));
  }, [inPeriod]);

  // Keep the selection valid as the period changes
  useEffect(() => {
    if (loggedKeys.length > 0 && !loggedKeys.some(e => e.key === selected)) {
      setSelected(loggedKeys[0].key);
    }
  }, [loggedKeys, selected]);

  // ── Consistency: sessions per week, split by category ─────────────────────
  const weekly = useMemo(() => {
    const byWeek = new Map<string, Record<string, number>>();
    for (const log of inPeriod) {
      const def = EXERCISE_BY_KEY[log.exercise_key];
      if (!def) continue;
      const week = format(startOfWeek(parseISO(log.date.slice(0, 10)), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const row = byWeek.get(week) ?? {};
      row[def.category] = (row[def.category] ?? 0) + 1;
      byWeek.set(week, row);
    }
    return Array.from(byWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, counts]) => ({
        label: format(parseISO(week), 'd MMM'),
        ...Object.fromEntries(CATEGORY_ORDER.map(c => [c, counts[c] ?? 0])),
      }));
  }, [inPeriod]);

  // ── Progression for the selected exercise ─────────────────────────────────
  const progression = useMemo(() => {
    const def = EXERCISE_BY_KEY[selected];
    if (!def) return [];
    return inPeriod
      .filter(l => l.exercise_key === selected)
      .map(l => ({ date: l.date.slice(0, 10), value: primaryValue(l) }))
      .filter((p): p is { date: string; value: number } => p.value != null)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(p => ({ label: format(parseISO(p.date), 'd MMM'), value: p.value }));
  }, [inPeriod, selected]);

  if (error) return <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Could not load exercise log</div>;
  if (!logs) return <div className="h-32 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;

  if (inPeriod.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-6">
        <p className="text-sm text-muted-foreground">No exercises logged in this period</p>
        <p className="text-[11px] text-muted-foreground/60 max-w-sm">
          Log your routine under Data → Exercise Log and progression will appear here.
        </p>
      </div>
    );
  }

  const activeDays = new Set(inPeriod.map(l => l.date.slice(0, 10))).size;
  const totalEntries = inPeriod.length;
  const selectedDef = EXERCISE_BY_KEY[selected];
  const unit = primaryUnit(selected);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 text-xs flex-wrap">
        <span><span className="font-semibold font-mono text-foreground">{activeDays}</span> <span className="text-muted-foreground">days logged</span></span>
        <span><span className="font-semibold font-mono text-foreground">{totalEntries}</span> <span className="text-muted-foreground">exercise entries</span></span>
      </div>

      {/* Weekly consistency by category */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Weekly volume by category</p>
        <ResponsiveContainer width="100%" height={height * 0.55}>
          <ComposedChart data={weekly} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
              interval={Math.max(0, Math.floor(weekly.length / 10))} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
              formatter={(v: number, n: string) => [`${v} entries`, CATEGORY_LABEL[n as ExerciseCategory] ?? n]} />
            {CATEGORY_ORDER.map(c => (
              <Bar key={c} dataKey={c} stackId="a" fill={CATEGORY_COLOR[c]} opacity={0.8} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Per-exercise progression */}
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Progression</p>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="ml-auto rounded border border-border bg-secondary px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {loggedKeys.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
          </select>
        </div>
        {progression.length >= 2 ? (
          <ResponsiveContainer width="100%" height={height * 0.55}>
            <ComposedChart data={progression} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
                interval={Math.max(0, Math.floor(progression.length / 10))} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
                domain={['auto', 'auto']} tickFormatter={v => `${v}`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
                formatter={(v: number) => [`${v} ${unit}`, selectedDef?.label ?? 'Value']} />
              <Line type="monotone" dataKey="value" stroke={CATEGORY_COLOR[selectedDef?.category ?? 'strength']}
                strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
            Need at least 2 logged sessions of {selectedDef?.label} to show a trend
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/60 italic">
        Reps and hold-times are multiplied by sets. Grip strength shows your peak dynamometer reading,
        Airofit shows session minutes.
      </p>
    </div>
  );
}
