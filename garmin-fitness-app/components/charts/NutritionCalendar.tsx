'use client';
import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import type { NutritionLog } from '@/lib/nutrition';

const ALCOHOL_RAMP = ['#4a2d6b', '#6b3fa0', '#8b5cc7', '#b088e0'];
const CANDY_RAMP   = ['#7a3d18', '#a8541f', '#d95926', '#e88a5c'];
const EMPTY_CELL   = 'hsl(240 3.7% 12%)';
const UNLOGGED     = 'hsl(240 3.7% 8%)';

interface Props {
  logs: NutritionLog[];
  cutoff: Date;
}

/** Intensity step for a value, or -1 for an explicit zero. */
function step(value: number | null, ramp: string[], max: number): number {
  if (value == null) return -2;          // never logged
  if (value === 0) return -1;            // logged, none
  const ratio = max > 0 ? value / max : 0;
  return Math.min(ramp.length - 1, Math.floor(ratio * ramp.length));
}

function colour(s: number, ramp: string[]): string {
  if (s === -2) return UNLOGGED;
  if (s === -1) return EMPTY_CELL;
  return ramp[s];
}

export default function NutritionCalendar({ logs, cutoff }: Props) {
  const { days, byDate, maxAlcohol, maxCandy, stats } = useMemo(() => {
    const DAY_MS = 86_400_000;
    const p = (n: number) => String(n).padStart(2, '0');
    const iso = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(cutoff); start.setHours(0, 0, 0, 0);
    const span = Math.max(1, Math.round((today.getTime() - start.getTime()) / DAY_MS) + 1);

    const list: string[] = [];
    for (let i = span - 1; i >= 0; i--) list.push(iso(new Date(today.getTime() - i * DAY_MS)));

    const map = new Map<string, NutritionLog>();
    for (const l of logs) map.set(l.date.slice(0, 10), l);

    const inWindow = list.map(d => map.get(d)).filter((l): l is NutritionLog => l != null);
    const alc = inWindow.map(l => l.alcohol_units).filter((v): v is number => v != null);
    const cnd = inWindow.map(l => l.candy_portions).filter((v): v is number => v != null);

    return {
      days: list,
      byDate: map,
      maxAlcohol: Math.max(1, ...alc),
      maxCandy: Math.max(1, ...cnd),
      stats: {
        logged: inWindow.length,
        span,
        dryDays: alc.filter(v => v === 0).length,
        drinkingDays: alc.filter(v => v > 0).length,
        totalUnits: alc.reduce((s, v) => s + v, 0),
        candyDays: cnd.filter(v => v > 0).length,
        totalPortions: cnd.reduce((s, v) => s + v, 0),
      },
    };
  }, [logs, cutoff]);

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-28 gap-1.5 text-center px-6">
        <p className="text-sm text-muted-foreground">Nothing logged yet</p>
        <p className="text-[11px] text-muted-foreground/60 max-w-md">
          Log alcohol, candy and sugary drinks under Data → Food &amp; Drink. Once a few weeks
          exist, the impact cards below will compare your recovery on those days against clean ones.
        </p>
      </div>
    );
  }

  const gap = days.length > 120 ? 1 : 2;
  const coverage = Math.round((stats.logged / stats.span) * 100);

  const row = (label: string, ramp: string[], max: number, get: (l: NutritionLog) => number | null, unit: string) => (
    <div className="flex items-center gap-2">
      <span className="w-[110px] shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <div className="flex flex-1 min-w-0" style={{ gap }}>
        {days.map(d => {
          const log = byDate.get(d);
          const v = log ? get(log) : null;
          const s = step(v, ramp, max);
          return (
            <div key={d} className="flex-1 min-w-0"
              title={`${format(parseISO(d), 'EEE d MMM')} · ${
                v == null ? 'not logged' : v === 0 ? `no ${unit}` : `${v} ${unit}`}`}
              style={{ height: 12, borderRadius: 2, background: colour(s, ramp) }} />
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Dry days', value: `${stats.dryDays}`, sub: `of ${stats.logged} logged` },
          { label: 'Drinking days', value: `${stats.drinkingDays}`, sub: `${stats.totalUnits.toFixed(1)} units total` },
          { label: 'Candy days', value: `${stats.candyDays}`, sub: `${stats.totalPortions.toFixed(1)} portions total` },
          { label: 'Coverage', value: `${coverage}%`, sub: `${stats.logged} of ${stats.span} days` },
        ].map(s => (
          <div key={s.label} className="rounded-md border border-border bg-card px-3 py-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</p>
            <p className="text-xl font-bold font-mono leading-tight">{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        {row('Alcohol', ALCOHOL_RAMP, maxAlcohol, l => l.alcohol_units, 'units')}
        {row('Candy', CANDY_RAMP, maxCandy, l => l.candy_portions, 'portions')}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <div style={{ width: 10, height: 10, borderRadius: 2, background: UNLOGGED }} />
        <span>not logged</span>
        <div style={{ width: 10, height: 10, borderRadius: 2, background: EMPTY_CELL }} className="ml-2" />
        <span>none</span>
        <span className="ml-2">then</span>
        {ALCOHOL_RAMP.map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: 2, background: c }} />)}
        <span>more</span>
      </div>

      {coverage < 60 && (
        <p className="text-[10px] text-amber-400/80 italic">
          Only {coverage}% of days in this period are logged. The impact analysis below only uses
          days you actually recorded — gaps don&apos;t bias it, but they do make it slower to
          reach a reliable answer.
        </p>
      )}
    </div>
  );
}
