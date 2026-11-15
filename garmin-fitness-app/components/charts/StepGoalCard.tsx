'use client';
import { useMemo } from 'react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Footprints } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { WellnessRecord } from '@/types';
import { localDateKey } from '@/lib/training-load';
import { stepCoach, STEPS_PER_MINUTE } from '@/lib/step-coach';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };
const AXIS_TICK = { fontSize: 10, fill: 'hsl(240 5% 55%)' };
const HIT = '#199e70';
const MISS = '#3987e5';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Where you stand against the step goal, what your weeks look like, and what to do today. */
export default function StepGoalCard({ wellness, goal }: { wellness: WellnessRecord[]; goal: number }) {
  // The browser's own calendar day: that is the day the person is living through.
  const today = localDateKey(new Date());
  const coach = useMemo(() => stepCoach({ wellness, goal, today }), [wellness, goal, today]);
  const { latest } = coach;

  const data = coach.recent.map(d => ({ label: format(parseISO(d.date), 'EEE d'), date: d.date, steps: d.steps }));
  const pct = latest ? Math.min(100, Math.round((latest.steps / coach.goal) * 100)) : 0;
  const trendWord = coach.trend === 'up' ? 'up on the week before' : coach.trend === 'down' ? 'down on the week before' : coach.trend === 'flat' ? 'level with the week before' : null;

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Footprints className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Step goal</span>
          </div>
          <Badge variant="outline">{fmt(coach.goal)} a day</Badge>
        </div>

        {!latest ? (
          <p className="text-xs text-muted-foreground">No step history yet.</p>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {latest.date === localDateKey(new Date(Date.now() - 86_400_000)) ? 'Yesterday' : format(parseISO(latest.date), 'EEE d MMM')}
                </p>
                <p className="text-sm tabular-nums">
                  <span className="font-medium">{fmt(latest.steps)}</span>
                  <span className="text-muted-foreground"> / {fmt(coach.goal)}</span>
                </p>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
                aria-label={`${pct}% of the step goal`}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: latest.hit ? HIT : MISS }} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {latest.hit ? 'Goal reached.' : `${fmt(latest.gap)} steps short, about ${Math.max(5, Math.round(latest.gap / STEPS_PER_MINUTE / 5) * 5)} minutes of brisk walking.`}
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Last 7 days: goal reached on <span className="text-foreground">{coach.last7.hits} of {coach.last7.n}</span>
              {coach.last7.avg != null && <> · average <span className="text-foreground">{fmt(coach.last7.avg)}</span>{trendWord ? `, ${trendWord}` : ''}</>}
              {coach.streak >= 2 && <> · <span className="text-foreground">{coach.streak}-day</span> streak</>}
            </p>

            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={1} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <ReferenceLine y={coach.goal} stroke="hsl(240 5% 55%)" strokeDasharray="4 4" />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'hsl(240 3.7% 13%)' }}
                  formatter={(v) => [typeof v === 'number' ? `${fmt(v)} steps` : 'no count', '']} />
                <Bar dataKey="steps" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {data.map(d => <Cell key={d.date} fill={d.steps != null && d.steps >= coach.goal ? HIT : MISS} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Your week, last 8 weeks</p>
              <div className="grid grid-cols-7 gap-1 text-center">
                {coach.weekdays.map(w => (
                  <div key={w.weekday} className="rounded border border-border/60 py-1">
                    <p className="text-[10px] text-muted-foreground">{w.name.slice(0, 3)}</p>
                    <p className="text-xs tabular-nums" style={{ color: w.mean != null && w.mean >= coach.goal ? HIT : undefined }}>
                      {w.mean == null ? '—' : `${(w.mean / 1000).toFixed(1)}k`}
                    </p>
                    <p className="text-[10px] text-muted-foreground tabular-nums">{w.hits}/{w.n}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-2">
          <p className="text-xs font-medium">Today, {coach.today.name}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{coach.nudge}</p>
          <p className="text-[11px] text-muted-foreground">
            Check your watch: {coach.today.checkpoints.map(c => `${c.time} ≈ ${fmt(c.steps)}`).join(' · ')} <span className="text-muted-foreground/70">(rule of thumb)</span>
          </p>
        </div>

        <p className="text-[10px] text-muted-foreground/70">
          Counts arrive with the daily Garmin sync, so today&apos;s steps are not shown live and today is never judged. A brisk walk is
          taken as about {STEPS_PER_MINUTE} steps a minute. Days with no count are left out, not counted as zero.
        </p>
      </CardContent>
    </Card>
  );
}
