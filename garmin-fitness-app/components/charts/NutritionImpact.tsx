'use client';
import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import type { NutritionLog } from '@/lib/nutrition';
import {
  doseResponse, OUTCOMES, ALCOHOL_BUCKETS, CANDY_BUCKETS, MIN_BUCKET_N,
  weekendSplit, addDays, OUTCOME_LAG_DAYS, availableOutcomes, stressStandsInForHrv,
  type DayMetrics, type OutcomeDef,
} from '@/lib/nutrition-analysis';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };
const GOOD = '#199e70';
const BAD = '#d55181';
const NEUTRAL = 'hsl(240 5% 45%)';
const UNRELIABLE = 'hsl(240 5% 28%)';

type Exposure = 'alcohol' | 'candy';

interface Props {
  logs: NutritionLog[];
  metricsByDate: Map<string, DayMetrics>;
  exposure: Exposure;
  height?: number;
}

export default function NutritionImpact({ logs, metricsByDate, exposure, height = 200 }: Props) {
  // Only offer outcomes the device actually records. Defaulting to HRV on a
  // tracker that exports no RMSSD produced "0 days have an HRV reading" next to
  // a full HRV chart elsewhere in the app.
  const outcomes = useMemo(() => availableOutcomes(metricsByDate), [metricsByDate]);
  const hrvIsStress = useMemo(() => stressStandsInForHrv(metricsByDate), [metricsByDate]);
  const [requested, setRequested] = useState<string | null>(null);
  const outcome: OutcomeDef = outcomes.find(o => o.key === requested) ?? outcomes[0] ?? OUTCOMES[0];
  const setOutcomeKey = setRequested;
  const outcomeKey = outcome.key;

  const buckets = exposure === 'alcohol' ? ALCOHOL_BUCKETS : CANDY_BUCKETS;
  const intakeOf = exposure === 'alcohol'
    ? (l: NutritionLog) => l.alcohol_units
    : (l: NutritionLog) => l.candy_portions;

  const dr = useMemo(
    () => doseResponse(logs, metricsByDate, intakeOf, buckets, outcome),
    [logs, metricsByDate, intakeOf, buckets, outcome],
  );

  // Does the effect survive inside weekdays and weekends separately? If it only
  // appears when the two are pooled, the weekend is doing the work, not the drink.
  const split = useMemo(() => weekendSplit(
    logs, metricsByDate,
    l => {
      const v = intakeOf(l);
      return v == null ? null : v > 0;
    },
    outcome,
  ), [logs, metricsByDate, intakeOf, outcome]);

  const data = dr.buckets
    .filter(b => b.n > 0)
    .map(b => ({ ...b, display: b.value == null ? 0 : Number(b.value.toFixed(outcome.decimals)) }));

  if (data.length < 2) {
    // A generic "not enough data" leaves the reader guessing which of three
    // different things is missing. Work out which one it actually is.
    const recorded = logs.filter(l => intakeOf(l) != null);
    const zeroDays = recorded.filter(l => intakeOf(l) === 0).length;
    const someDays = recorded.filter(l => (intakeOf(l) ?? 0) > 0).length;
    const withOutcome = recorded.filter(l =>
      metricsByDate.get(addDays(l.date, OUTCOME_LAG_DAYS))?.[outcome.key] != null).length;

    const noun = exposure === 'alcohol' ? 'alcohol' : 'sweets';
    const cleanWord = exposure === 'alcohol' ? 'dry' : 'sugar-free';

    let reason: React.ReactNode;
    let shortfall: string;
    if (recorded.length === 0) {
      reason = <>Nothing logged for {noun} yet.</>;
      shortfall = `Log at least ${MIN_BUCKET_N} days with and ${MIN_BUCKET_N} without.`;
    } else if (zeroDays === 0) {
      reason = <>
        You have <strong>{someDays}</strong> day{someDays === 1 ? '' : 's'} with {noun} logged, but
        <strong> no days recorded as zero</strong>. There is nothing to compare against.
      </>;
      shortfall = `Enter 0 on ${cleanWord} days. A day you simply didn't open the form counts as unknown rather than zero, so it cannot serve as the baseline — only an explicit 0 can.`;
    } else if (someDays === 0) {
      reason = <>
        You have <strong>{zeroDays}</strong> {cleanWord} day{zeroDays === 1 ? '' : 's'} logged but none
        with {noun}, so there is no exposure to measure.
      </>;
      shortfall = 'This will fill in on its own next time you log a day with some.';
    } else if (withOutcome < 2) {
      reason = <>
        {recorded.length} days logged, but only <strong>{withOutcome}</strong> have
        a {outcome.label.toLowerCase()} reading the <em>morning after</em>.
      </>;
      shortfall = 'The watch needs to capture the following night for a logged day to count.';
    } else {
      reason = <>
        {zeroDays} {cleanWord} and {someDays} with {noun}, but they do not yet span two different bands.
      </>;
      shortfall = 'Keep logging — a wider range of amounts will separate them.';
    }

    return (
      <div className="flex flex-col items-center justify-center gap-2 text-center px-6" style={{ height: height + 40 }}>
        <p className="text-sm text-muted-foreground">Not enough data yet</p>
        <p className="text-[11px] text-muted-foreground/80 max-w-md">{reason}</p>
        <p className="text-[11px] text-muted-foreground/60 max-w-md">{shortfall}</p>
        <p className="text-[10px] text-muted-foreground/50 max-w-md pt-1">
          A readable comparison needs {MIN_BUCKET_N} days on each side; you have{' '}
          <span className="font-mono">{zeroDays}</span> and <span className="font-mono">{someDays}</span>.
        </p>
      </div>
    );
  }

  const baseline = dr.buckets[0]?.value ?? null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {outcomes.map(o => (
          <button key={o.key} onClick={() => setOutcomeKey(o.key)}
            className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
              o.key === outcomeKey
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}>
            {o.label}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
            domain={['dataMin - 2', 'dataMax + 2']} />
          {baseline != null && (
            <ReferenceLine y={baseline} stroke={NEUTRAL} strokeDasharray="4 4" />
          )}
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, _n, item) => {
              const p = item.payload as typeof data[number];
              const d = p.delta == null ? '' : ` (${p.delta > 0 ? '+' : ''}${p.delta.toFixed(outcome.decimals)})`;
              return [`${v}${outcome.unit ? ' ' + outcome.unit : ''}${d} · n=${p.n}${p.unreliable ? ' ⚠' : ''}`, outcome.label];
            }} />
          <Bar dataKey="display" radius={[3, 3, 0, 0]}>
            {data.map(b => {
              const isBaseline = b.delta == null;
              const worse = !outcome.behavioural && b.delta != null
                && (outcome.higherIsBetter ? b.delta < 0 : b.delta > 0);
              return (
                <Cell key={b.label}
                  fill={b.unreliable ? UNRELIABLE
                    : isBaseline || outcome.behavioural ? NEUTRAL
                    : worse ? BAD : GOOD} />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="space-y-0.5">
        {dr.buckets.filter(b => b.n > 0).map(b => (
          <div key={b.label} className="flex items-center gap-2 text-[10px]">
            <span className="w-20 text-muted-foreground">{b.label}</span>
            <span className="font-mono w-16 text-right">
              {b.value != null ? b.value.toFixed(outcome.decimals) : '—'}
            </span>
            <span className={`font-mono w-16 text-right ${
              b.delta == null || outcome.behavioural ? 'text-muted-foreground'
                : (outcome.higherIsBetter ? b.delta < 0 : b.delta > 0) ? 'text-red-400' : 'text-green-400'
            }`}>
              {b.delta != null ? `${b.delta > 0 ? '+' : ''}${b.delta.toFixed(outcome.decimals)}`
                : dr.buckets[0]?.label === b.label ? 'baseline'
                : baseline != null ? '—' : 'no baseline'}
            </span>
            <span className="text-muted-foreground">n={b.n}</span>
            {b.unreliable && <span className="text-amber-400">⚠ under {MIN_BUCKET_N} days</span>}
          </div>
        ))}
      </div>

      {/* Weekend confounding, stated rather than buried */}
      {split.weekday.delta != null && split.weekend.delta != null && (
        <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
          Split by day type: weekdays {split.weekday.delta > 0 ? '+' : ''}
          {split.weekday.delta.toFixed(outcome.decimals)} (n={split.weekday.nExposed}),
          weekends {split.weekend.delta > 0 ? '+' : ''}
          {split.weekend.delta.toFixed(outcome.decimals)} (n={split.weekend.nExposed}).
          {Math.sign(split.weekday.delta) === Math.sign(split.weekend.delta)
            ? ' The effect appears in both, so it is probably not just the weekend.'
            : ' The two disagree — this may be weekend habits rather than the intake itself.'}
        </p>
      )}

      {outcome.behavioural && (
        <p className="text-[10px] text-amber-400/80 italic leading-relaxed">
          Next-day load is how hard you <em>chose</em> to train, not something that happened to you,
          so it carries no good/bad reading. Use Resting HR, Sleep score, Body battery or Stress to
          judge whether a habit cost you anything.
        </p>
      )}

      {hrvIsStress && outcome.key === 'stress' && (
        <p className="text-[10px] text-muted-foreground/70 italic">
          Your tracker exports no raw HRV (RMSSD), so stress score is the HRV-derived metric here —
          Garmin computes it from beat-to-beat intervals. Lower is better, so a positive difference
          is a worse outcome.
        </p>
      )}

      <p className="text-[10px] text-muted-foreground/60 italic leading-relaxed">
        Measured the morning after, so tonight&apos;s intake is compared against tomorrow&apos;s
        numbers. Only days you actually logged are counted; a blank day is never treated as zero.
        This is your own data over time, which is decent personal evidence — but it shows
        association, not proof of cause.
      </p>
    </div>
  );
}
