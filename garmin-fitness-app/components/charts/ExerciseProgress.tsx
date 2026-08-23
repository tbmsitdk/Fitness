'use client';
import { useState, useEffect, useMemo } from 'react';
import { useDataVersion } from '@/lib/data-refresh';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { format, parseISO, startOfWeek } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  EXERCISES, EXERCISE_BY_KEY, CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER,
  ADHERENCE_RAMP, ADHERENCE_EMPTY, primaryUnit, primaryValue, estimatedSeconds,
  currentStreak, type ExerciseLog, type ExerciseCategory,
} from '@/lib/exercises';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };
const SURFACE = 'hsl(240 10% 7%)'; // chart surface — used as the 2px gap between stacked segments
const GRID_DAYS = 28;

interface Props {
  cutoff: Date;
  height?: number;
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-3 py-2 rounded-md border border-border bg-card">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-xl font-bold font-mono text-foreground leading-tight">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 64, h = 16;
  if (values.length < 2) return <svg width={w} height={h} aria-hidden />;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5}
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function fmtSecs(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ExerciseProgress({ cutoff, height = 240 }: Props) {
  const [logs, setLogs] = useState<ExerciseLog[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const dataVersion = useDataVersion();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/exercises?days=3650&t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => { if (!cancelled) setLogs(Array.isArray(data.logs) ? data.logs : []); })
      .catch(() => { if (!cancelled) { setError(true); setLogs([]); } });
    return () => { cancelled = true; };
  }, [dataVersion]);

  const inPeriod = useMemo(
    () => (logs ?? []).filter(l => new Date(l.date) >= cutoff),
    [logs, cutoff]
  );

  // Per-exercise stats for the scoreboard, in catalog order
  const scoreboard = useMemo(() => {
    return EXERCISES.map(def => {
      const entries = inPeriod
        .filter(l => l.exercise_key === def.key)
        .sort((a, b) => a.date.localeCompare(b.date));
      const values = entries
        .map(primaryValue)
        .filter((v): v is number => v != null);
      if (values.length === 0) return null;
      const first = values[0];
      const latest = values[values.length - 1];
      return {
        def,
        sessions: entries.length,
        values,
        first,
        latest,
        best: Math.max(...values),
        change: latest - first,
        unit: primaryUnit(def.key),
      };
    }).filter((r): r is NonNullable<typeof r> => r !== null);
  }, [inPeriod]);

  // Adherence grid: work-seconds per exercise per day, last GRID_DAYS days
  const { gridDays, gridRows, maxDaySeconds } = useMemo(() => {
    const days: string[] = [];
    const today = new Date();
    for (let i = GRID_DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const byKeyDay = new Map<string, number>();
    let maxSecs = 0;
    for (const log of inPeriod) {
      const k = `${log.exercise_key}|${log.date.slice(0, 10)}`;
      const secs = (byKeyDay.get(k) ?? 0) + estimatedSeconds(log);
      byKeyDay.set(k, secs);
      if (secs > maxSecs) maxSecs = secs;
    }
    const rows = scoreboard.map(r => ({
      def: r.def,
      cells: days.map(d => byKeyDay.get(`${r.def.key}|${d}`) ?? 0),
    }));
    return { gridDays: days, gridRows: rows, maxDaySeconds: maxSecs };
  }, [inPeriod, scoreboard]);

  // Weekly volume in MINUTES, stacked by category
  const weekly = useMemo(() => {
    const byWeek = new Map<string, Record<string, number>>();
    for (const log of inPeriod) {
      const def = EXERCISE_BY_KEY[log.exercise_key];
      if (!def) continue;
      const week = format(startOfWeek(parseISO(log.date.slice(0, 10)), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const row = byWeek.get(week) ?? {};
      row[def.category] = (row[def.category] ?? 0) + estimatedSeconds(log) / 60;
      byWeek.set(week, row);
    }
    return Array.from(byWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, mins]) => ({
        label: format(parseISO(week), 'd MMM'),
        ...Object.fromEntries(CATEGORY_ORDER.map(c => [c, Math.round((mins[c] ?? 0) * 10) / 10])),
      }));
  }, [inPeriod]);

  const progression = useMemo(() => {
    if (!selected) return [];
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

  const loggedDates = Array.from(new Set(inPeriod.map(l => l.date.slice(0, 10))));
  const totalSecs = inPeriod.reduce((s, l) => s + estimatedSeconds(l), 0);
  const streak = currentStreak(loggedDates);
  const selectedDef = selected ? EXERCISE_BY_KEY[selected] : null;

  return (
    <div className="space-y-5">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatTile label="Days logged" value={String(loggedDates.length)} sub="in this period" />
        <StatTile label="Total time" value={fmtSecs(totalSecs)} sub="estimated work" />
        <StatTile label="Streak" value={`${streak}d`} sub={streak > 0 ? 'consecutive' : 'not active'} />
        <StatTile label="Exercises" value={String(scoreboard.length)} sub={`of ${EXERCISES.length} used`} />
      </div>

      {/* A — Adherence grid */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
          Adherence · last {GRID_DAYS} days
        </p>
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full space-y-0.5">
            {gridRows.map(row => (
              <div key={row.def.key} className="flex items-center gap-2">
                <span className="w-[150px] shrink-0 text-[10px] text-muted-foreground truncate" title={row.def.label}>
                  {row.def.label}
                </span>
                <div className="flex gap-[2px]">
                  {row.cells.map((secs, i) => {
                    const ratio = maxDaySeconds > 0 ? secs / maxDaySeconds : 0;
                    const step = secs === 0 ? -1 : Math.min(ADHERENCE_RAMP.length - 1, Math.floor(ratio * ADHERENCE_RAMP.length));
                    return (
                      <div
                        key={i}
                        title={`${row.def.label} · ${format(parseISO(gridDays[i]), 'EEE d MMM')} · ${secs > 0 ? fmtSecs(secs) : 'not logged'}`}
                        style={{
                          width: 10, height: 10, borderRadius: 2,
                          background: step === -1 ? ADHERENCE_EMPTY : ADHERENCE_RAMP[step],
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
          <span>Less</span>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: ADHERENCE_EMPTY }} />
          {ADHERENCE_RAMP.map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: 2, background: c }} />)}
          <span>More</span>
          <span className="ml-1">· shade = time spent that day</span>
        </div>
      </div>

      {/* B — Scoreboard, click a row for detail */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
          Progress by exercise · click for detail
        </p>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-secondary/50 text-muted-foreground">
                <th className="text-left px-3 py-1.5 font-medium">Exercise</th>
                <th className="text-right px-3 py-1.5 font-medium">Latest</th>
                <th className="text-right px-3 py-1.5 font-medium">Best</th>
                <th className="text-right px-3 py-1.5 font-medium">Change</th>
                <th className="text-left px-3 py-1.5 font-medium">Trend</th>
                <th className="text-right px-3 py-1.5 font-medium">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {scoreboard.map(r => {
                const up = r.change > 0, down = r.change < 0;
                return (
                  <tr
                    key={r.def.key}
                    onClick={() => setSelected(selected === r.def.key ? null : r.def.key)}
                    className={cn(
                      'border-b border-border/40 cursor-pointer hover:bg-secondary/30',
                      selected === r.def.key && 'bg-secondary/50'
                    )}
                  >
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CATEGORY_COLOR[r.def.category] }} />
                        {r.def.label}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.latest} {r.unit}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{r.best} {r.unit}</td>
                    <td className={cn('px-3 py-1.5 text-right font-mono',
                      up ? 'text-green-400' : down ? 'text-amber-400' : 'text-muted-foreground')}>
                      {up ? '↑' : down ? '↓' : '→'} {r.change === 0 ? 'same' : `${up ? '+' : ''}${r.change} ${r.unit}`}
                    </td>
                    <td className="px-3 py-1.5">
                      <Sparkline values={r.values} color={CATEGORY_COLOR[r.def.category]} />
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{r.sessions}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* D — Detail chart for the selected exercise, anchored at 0 */}
      {selectedDef && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
            {selectedDef.label} · {primaryUnit(selectedDef.key)}
          </p>
          {progression.length >= 2 ? (
            <ResponsiveContainer width="100%" height={height * 0.6}>
              <ComposedChart data={progression} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
                  interval={Math.max(0, Math.floor(progression.length / 10))} />
                {/* Anchored at 0 so a flat series reads as flat, not as noise */}
                <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} domain={[0, 'auto']} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
                  formatter={(v: number) => [`${v} ${primaryUnit(selectedDef.key)}`, selectedDef.label]} />
                <Line type="monotone" dataKey="value" stroke={CATEGORY_COLOR[selectedDef.category]}
                  strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-20 flex items-center justify-center text-xs text-muted-foreground">
              Need at least 2 logged sessions to show a trend
            </div>
          )}
        </div>
      )}

      {/* C — Weekly volume in minutes, stacked by category */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
          Weekly volume · minutes by category
        </p>
        <ResponsiveContainer width="100%" height={height * 0.7}>
          <ComposedChart data={weekly} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
              interval={Math.max(0, Math.floor(weekly.length / 10))} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
              tickFormatter={v => `${v}m`} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
              formatter={(v: number, n: string) => [`${v} min`, CATEGORY_LABEL[n as ExerciseCategory] ?? n]} />
            <Legend wrapperStyle={{ fontSize: 10, color: 'hsl(240 5% 64.9%)' }} iconSize={8}
              formatter={(n: string) => <span style={{ color: 'hsl(240 5% 64.9%)' }}>{CATEGORY_LABEL[n as ExerciseCategory] ?? n}</span>} />
            {CATEGORY_ORDER.map(c => (
              // 2px surface-coloured stroke gives the segment separation the eye needs
              <Bar key={c} dataKey={c} stackId="a" fill={CATEGORY_COLOR[c]} stroke={SURFACE} strokeWidth={2} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[10px] text-muted-foreground/60 italic">
        Time is estimated work: recorded hold-times × sets, plus grip reps at ~3s each. Grip strength charts your
        peak resistance (kg); Airofit charts session minutes.
      </p>
    </div>
  );
}
