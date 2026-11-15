'use client';
import { useMemo } from 'react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format, parseISO } from 'date-fns';
import type { WellnessRecord } from '@/types';
import { localDateKey } from '@/lib/training-load';
import { stepCoach } from '@/lib/step-coach';
import { stepTracking } from '@/lib/step-tracking';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };
const AXIS_TICK = { fontSize: 10, fill: 'hsl(240 5% 55%)' };
const GRID_LINE = 'hsl(240 5% 55%)';
const HIT = '#199e70';
const MISS = '#3987e5';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'hit' | 'miss' }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums mt-0.5" style={{ color: tone === 'hit' ? HIT : tone === 'miss' ? MISS : undefined }}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

interface Props {
  /** The period the dashboard is set to. */
  wellness: WellnessRecord[];
  /** Full history, used only for today's coaching line, which needs eight weeks whatever the period. */
  allWellness: WellnessRecord[];
  goal: number;
  height?: number;
}

/** How steps track against the goal over the selected period, and what is holding them back. */
export default function StepsVsTarget({ wellness, allWellness, goal, height = 200 }: Props) {
  const today = localDateKey(new Date());
  const t = useMemo(() => stepTracking({ wellness, goal, today }), [wellness, goal, today]);
  const coach = useMemo(() => stepCoach({ wellness: allWellness, goal, today }), [allWellness, goal, today]);

  // Weekly bars for up to ~80 weeks; beyond that, months, or the bars become slivers.
  const monthly = t.weeks.length > 80;
  const series = monthly
    ? t.months.map(m => ({ key: m.month, label: format(parseISO(`${m.month}-01`), "MMM ''yy"), avg: m.avg, days: m.days, hits: m.hits, partial: false }))
    : t.weeks.filter(w => !w.partial).map(w => ({ key: w.start, label: format(parseISO(w.start), 'd MMM'), avg: w.avg, days: w.days, hits: w.hits, partial: false }));
  const partialWeeks = monthly ? 0 : t.weeks.filter(w => w.partial).length;

  if (t.days === 0) {
    return <p className="text-xs text-muted-foreground py-6 text-center">No step counts in this period.</p>;
  }

  const maxAvg = Math.max(...series.map(s => s.avg), t.goal);
  const ahead = t.vsTarget >= 0;

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        {format(parseISO(t.from!), 'd MMM yyyy')} to {format(parseISO(t.to!), 'd MMM yyyy')}: goal of <span className="text-foreground">{fmt(t.goal)}</span> steps reached on{' '}
        <span className="text-foreground">{t.hits} of {t.days} days ({t.hitRate}%)</span>.
        {t.missing > 0 && <> {t.missing} {t.missing === 1 ? 'day has' : 'days have'} no count and {t.missing === 1 ? 'is' : 'are'} left out, not counted as zero.</>}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Average a day" value={fmt(t.avg!)}
          sub={`${signed(t.avgGap!)} against the goal · median ${fmt(t.median!)}`} tone={t.avgGap! >= 0 ? 'hit' : 'miss'} />
        <Tile label="Goal reached" value={`${t.hitRate}%`} sub={`${t.hits} of ${t.days} days`} />
        <Tile label="Streak" value={`${t.streak.current} ${t.streak.current === 1 ? 'day' : 'days'}`}
          sub={t.streak.longest ? `longest here: ${t.streak.longest.days} ${t.streak.longest.days === 1 ? 'day' : 'days'}` : 'goal not reached in this period'} />
        <Tile label="Against target" value={`${t.vsTargetPct}%`}
          sub={`${fmt(t.total)} walked of ${fmt(t.targetTotal)} · ${ahead ? 'ahead by' : 'behind by'} ${fmt(Math.abs(t.vsTarget))}`}
          tone={ahead ? 'hit' : 'miss'} />
      </div>

      {t.last4weeks.avg != null && (
        <p className="text-xs text-muted-foreground">
          Last four weeks: <span className="text-foreground">{fmt(t.last4weeks.avg)}</span> a day
          {t.last4weeks.change != null && t.last4weeks.previousAvg != null && (
            <>, {t.last4weeks.change === 0 ? 'level with' : t.last4weeks.change > 0 ? `${fmt(t.last4weeks.change)} up on` : `${fmt(-t.last4weeks.change)} down on`} the four weeks before ({fmt(t.last4weeks.previousAvg)}).</>
          )}
          {t.last4weeks.change == null && <> (too few days to compare with the four weeks before).</>}
        </p>
      )}

      <div>
        <p className="text-xs font-medium mb-1">{monthly ? 'Average steps by month' : 'Average steps by week'} against the goal</p>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={series} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={22} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} domain={[0, Math.ceil((maxAvg * 1.1) / 1000) * 1000]}
              tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
            <ReferenceLine y={t.goal} stroke={GRID_LINE} strokeDasharray="4 4"
              label={{ value: `goal ${fmt(t.goal)}`, position: 'insideTopRight', fill: GRID_LINE, fontSize: 9 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'hsl(240 3.7% 13%)' }}
              formatter={(v, _n, item) => {
                const p = item.payload as typeof series[number];
                return [`${fmt(Number(v))} a day · goal reached on ${p.hits} of ${p.days} days`, monthly ? 'Month' : 'Week'];
              }}
              labelFormatter={(l) => (monthly ? String(l) : `Week of ${l}`)} />
            <Bar dataKey="avg" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {series.map(s => <Cell key={s.key} fill={s.avg >= t.goal ? HIT : MISS} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-muted-foreground/70">
          Green = the average for that {monthly ? 'month' : 'week'} reached the goal. Each bar averages the days that have a count.
          {partialWeeks > 0 && ` ${partialWeeks} short ${partialWeeks === 1 ? 'week' : 'weeks'} (under ${4} counted days) at the edges of the period ${partialWeeks === 1 ? 'is' : 'are'} not drawn.`}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <p className="text-xs font-medium mb-1">Which days of the week</p>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left font-medium py-1">Day</th>
                <th className="text-right font-medium py-1">Average</th>
                <th className="text-right font-medium py-1">vs goal</th>
                <th className="text-right font-medium py-1">Reached</th>
              </tr>
            </thead>
            <tbody>
              {t.weekdays.map(w => (
                <tr key={w.weekday} className="border-t border-border/50">
                  <td className="py-1">{w.name}</td>
                  <td className="py-1 text-right">{w.mean == null ? '—' : fmt(w.mean)}</td>
                  <td className="py-1 text-right" style={{ color: w.gap == null ? undefined : w.gap >= 0 ? HIT : MISS }}>{w.gap == null ? '—' : signed(w.gap)}</td>
                  <td className="py-1 text-right text-muted-foreground">{w.hits}/{w.n}{w.hitRate != null ? ` · ${w.hitRate}%` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <p className="text-xs font-medium mb-1">How your days are spread</p>
          <div className="space-y-1.5">
            {t.bands.map(b => (
              <div key={b.label} className="text-xs">
                <div className="flex items-baseline justify-between">
                  <span className="text-muted-foreground">{b.label}</span>
                  <span className="tabular-nums">{b.n} {b.n === 1 ? 'day' : 'days'} · {b.share}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${b.share}%`, background: b.reachesGoal ? HIT : MISS }} />
                </div>
              </div>
            ))}
          </div>
          {t.best && <p className="text-[11px] text-muted-foreground mt-2">Best day: {fmt(t.best.steps)} on {format(parseISO(t.best.date), 'd MMM yyyy')}.</p>}
        </div>
      </div>

      {t.months.length > 1 && (
        <div>
          <p className="text-xs font-medium mb-1">Month by month</p>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left font-medium py-1">Month</th>
                <th className="text-right font-medium py-1">Average</th>
                <th className="text-right font-medium py-1">vs goal</th>
                <th className="text-right font-medium py-1">Days reached</th>
              </tr>
            </thead>
            <tbody>
              {[...t.months].reverse().slice(0, 12).map(m => (
                <tr key={m.month} className="border-t border-border/50">
                  <td className="py-1">{format(parseISO(`${m.month}-01`), 'MMM yyyy')}</td>
                  <td className="py-1 text-right">{fmt(m.avg)}</td>
                  <td className="py-1 text-right" style={{ color: m.avg >= t.goal ? HIT : MISS }}>{signed(m.avg - t.goal)}</td>
                  <td className="py-1 text-right text-muted-foreground">{m.hits}/{m.days} · {m.hitRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-1">
        <p className="text-xs font-medium">Today, {coach.today.name}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{coach.nudge}</p>
      </div>

      <p className="text-[10px] text-muted-foreground/70">
        Only finished days count: counts arrive with the daily Garmin sync, so today is never judged. The goal is set in Settings.
      </p>
    </div>
  );
}
