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
  ADHERENCE_RAMP, ADHERENCE_EMPTY, primaryUnit, primaryValue, primaryDisplay, estimatedSeconds,
  currentStreak, type ExerciseLog, type ExerciseCategory,
} from '@/lib/exercises';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };
const SURFACE = 'hsl(240 10% 7%)'; // chart surface — used as the 2px gap between stacked segments
/** Above this many days the adherence grid groups by week instead of by day. */
const DAILY_CELL_LIMIT = 120;

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
      // Keep each value tied to its log so the table can show the components
      // of a compound metric (grip strength's kg x reps) next to the trend.
      const scored = entries
        .map(l => ({ log: l, value: primaryValue(l) }))
        .filter((e): e is { log: typeof e.log; value: number } => e.value != null);
      if (scored.length === 0) return null;
      const values = scored.map(e => e.value);
      const first = values[0];
      const latest = scored[scored.length - 1];
      const best = scored.reduce((a, b) => (b.value > a.value ? b : a));
      return {
        def,
        sessions: entries.length,
        values,
        first,
        latest: latest.value,
        latestLabel: primaryDisplay(latest.log),
        best: best.value,
        bestLabel: primaryDisplay(best.log),
        change: latest.value - first,
        unit: primaryUnit(def.key),
      };
    }).filter((r): r is NonNullable<typeof r> => r !== null);
  }, [inPeriod]);

  // Adherence grid: work-seconds per exercise per bucket, spanning the period
  // selected at the top of the dashboard.
  //
  // One cell per day stops being readable somewhere past a few months — a year
  // of daily cells is 365 slivers plus 365 gaps. Past DAILY_CELL_LIMIT we group
  // into ISO weeks instead, which keeps a cell wide enough to see while still
  // covering the whole period. The label and tooltip say which unit is in use.
  const { gridBuckets, gridRows, maxBucketSeconds, byWeek } = useMemo(() => {
    const DAY_MS = 86_400_000;
    const midnight = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const iso = (d: Date) => {
      // Local-time date string — toISOString() would shift the day in any
      // timezone behind UTC and misfile evening sessions.
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    /** Monday of the week containing d. */
    const weekStart = (d: Date) => {
      const x = midnight(d);
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
      return x;
    };

    const today = midnight(new Date());
    const start = midnight(cutoff);
    const spanDays = Math.max(1, Math.round((today.getTime() - start.getTime()) / DAY_MS) + 1);
    const grouped = spanDays > DAILY_CELL_LIMIT;

    // Bucket start dates, oldest first.
    const buckets: string[] = [];
    if (grouped) {
      for (let d = weekStart(start); d <= today; d.setDate(d.getDate() + 7)) buckets.push(iso(d));
    } else {
      for (let i = spanDays - 1; i >= 0; i--) {
        buckets.push(iso(new Date(today.getTime() - i * DAY_MS)));
      }
    }

    const bucketKey = (dateStr: string) =>
      grouped ? iso(weekStart(parseISO(dateStr))) : dateStr;

    const byKeyBucket = new Map<string, number>();
    let maxSecs = 0;
    for (const log of inPeriod) {
      const k = `${log.exercise_key}|${bucketKey(log.date.slice(0, 10))}`;
      const secs = (byKeyBucket.get(k) ?? 0) + estimatedSeconds(log);
      byKeyBucket.set(k, secs);
      if (secs > maxSecs) maxSecs = secs;
    }
    const rows = scoreboard.map(r => ({
      def: r.def,
      cells: buckets.map(b => byKeyBucket.get(`${r.def.key}|${b}`) ?? 0),
    }));
    return { gridBuckets: buckets, gridRows: rows, maxBucketSeconds: maxSecs, byWeek: grouped };
  }, [inPeriod, scoreboard, cutoff]);

  // Gaps become the dominant visual once there are many cells — shrink them so
  // a long period reads as a density strip rather than a picket fence.
  const cellGap = gridBuckets.length > 60 ? 1 : 2;

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
          Adherence · {gridBuckets.length} {byWeek ? 'weeks' : 'days'}
          <span className="normal-case tracking-normal text-muted-foreground/60">
            {' '}· {format(parseISO(gridBuckets[0]), 'd MMM yyyy')} → today
          </span>
        </p>
        {/* Cells flex to fill the available width, so the grid spans the card
            at any period length rather than trailing off mid-row. */}
        <div className="space-y-0.5">
          {gridRows.map(row => (
            <div key={row.def.key} className="flex items-center gap-2">
              <span className="w-[110px] sm:w-[150px] shrink-0 text-[10px] text-muted-foreground truncate" title={row.def.label}>
                {row.def.label}
              </span>
              <div className="flex flex-1 min-w-0" style={{ gap: cellGap }}>
                {row.cells.map((secs, i) => {
                  const ratio = maxBucketSeconds > 0 ? secs / maxBucketSeconds : 0;
                  const step = secs === 0 ? -1 : Math.min(ADHERENCE_RAMP.length - 1, Math.floor(ratio * ADHERENCE_RAMP.length));
                  const when = byWeek
                    ? `week of ${format(parseISO(gridBuckets[i]), 'd MMM yyyy')}`
                    : format(parseISO(gridBuckets[i]), 'EEE d MMM');
                  return (
                    <div
                      key={i}
                      title={`${row.def.label} · ${when} · ${secs > 0 ? fmtSecs(secs) : 'not logged'}`}
                      className="flex-1 min-w-0"
                      style={{
                        height: 10, borderRadius: 2,
                        background: step === -1 ? ADHERENCE_EMPTY : ADHERENCE_RAMP[step],
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
          <span>Less</span>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: ADHERENCE_EMPTY }} />
          {ADHERENCE_RAMP.map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: 2, background: c }} />)}
          <span>More</span>
          <span className="ml-1">· shade = time spent that {byWeek ? 'week' : 'day'}</span>
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
                    <td className="px-3 py-1.5 text-right font-mono whitespace-nowrap">{r.latestLabel}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground whitespace-nowrap">{r.bestLabel}</td>
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
