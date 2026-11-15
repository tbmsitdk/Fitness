'use client';
import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import type { NutritionLog } from '@/lib/nutrition';
import {
  doseResponse, OUTCOMES, MIN_BUCKET_N, availableOutcomes, isWeekend,
  type DayMetrics, type OutcomeDef,
} from '@/lib/nutrition-analysis';
import {
  MIN_DAYS_FOR_THIRDS, formatValue, thirdsBuckets, thirdsOf, valuesOf, type DetailExposure,
} from '@/lib/nutrition-detail';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };
const GOOD = '#199e70';
const BAD = '#d55181';
const NEUTRAL = 'hsl(240 5% 45%)';

interface Props {
  logs: NutritionLog[];
  metricsByDate: Map<string, DayMetrics>;
  exposures: DetailExposure[];
  height?: number;
}

/**
 * Recovery the morning after, by how much you ate of something that day:
 * your lowest third of days against the middle and the highest third. The
 * measures come from the meal diary, so only days marked complete take part.
 */
export default function NutritionDetailImpact({ logs, metricsByDate, exposures, height = 200 }: Props) {
  const outcomes = useMemo(() => availableOutcomes(metricsByDate), [metricsByDate]);
  const [exposureKey, setExposureKey] = useState<string | null>(null);
  const [outcomeKey, setOutcomeKey] = useState<string | null>(null);
  const [dayType, setDayType] = useState<'all' | 'weekday' | 'weekend'>('all');

  // Prefer a measure that already has enough days to split.
  const splittable = useMemo(() => exposures.filter(e => thirdsOf(valuesOf(logs, e)) != null), [exposures, logs]);
  const exposure = exposures.find(e => e.key === exposureKey) ?? splittable[0] ?? exposures[0];
  const outcome: OutcomeDef = outcomes.find(o => o.key === outcomeKey) ?? outcomes[0] ?? OUTCOMES[0];

  const values = useMemo(() => (exposure ? valuesOf(logs, exposure) : []), [logs, exposure]);
  // Cut-offs come from ALL days, so they stay put when the day-type filter changes.
  const thirds = useMemo(() => thirdsOf(values), [values]);
  const scoped = useMemo(() => logs.filter(l =>
    dayType === 'all' ? true : dayType === 'weekend' ? isWeekend(l.date) : !isWeekend(l.date),
  ), [logs, dayType]);

  const dr = useMemo(
    () => (exposure && thirds ? doseResponse(scoped, metricsByDate, exposure.of, thirdsBuckets(thirds), outcome) : null),
    [scoped, metricsByDate, exposure, thirds, outcome],
  );

  const picker = (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
        Measure
        <select value={exposure?.key ?? ''} onChange={e => setExposureKey(e.target.value)}
          className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[11px] text-foreground">
          {exposures.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-1">
        {outcomes.map(o => (
          <button key={o.key} onClick={() => setOutcomeKey(o.key)}
            className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
              o.key === outcome.key ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (!exposure || values.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-center px-6" style={{ height: height + 40 }}>
        <p className="text-sm text-muted-foreground">Nothing to compare yet</p>
        <p className="text-[11px] text-muted-foreground/80 max-w-md">
          This card uses the totals from your meal diary, and a day only has totals once you tick
          &ldquo;That&apos;s everything I ate and drank&rdquo; and every entry has an estimate.
        </p>
      </div>
    );
  }

  if (!thirds || !dr) {
    return (
      <div className="space-y-3">
        {picker}
        <div className="flex flex-col items-center justify-center gap-1.5 text-center px-6" style={{ height }}>
          <p className="text-sm text-muted-foreground">Not enough days for this measure yet</p>
          <p className="text-[11px] text-muted-foreground/80 max-w-md">
            Your days are split into a lowest, middle and highest third, which needs at least {MIN_DAYS_FOR_THIRDS} days
            with a value and some spread between them. You have <span className="font-mono">{values.length}</span>.
          </p>
        </div>
      </div>
    );
  }

  const decimals = outcome.decimals;
  const rangeOf = (i: number) =>
    i === 0 ? `up to ${formatValue(exposure, thirds.low)}`
    : i === 2 ? `${formatValue(exposure, thirds.high)} or more`
    : `${formatValue(exposure, thirds.low)} to ${formatValue(exposure, thirds.high)}`;

  const data = dr.buckets.map((b, i) => ({ ...b, range: rangeOf(i), change: i === 0 ? 0 : b.delta == null ? null : Number(b.delta.toFixed(decimals)) }))
    .filter(b => b.n > 0);
  const baseline = dr.buckets[0];
  const worse = (delta: number) => (outcome.higherIsBetter ? delta < 0 : delta > 0);
  const usable = baseline.n > 0 && baseline.value != null && data.length >= 2;

  return (
    <div className="space-y-2">
      {picker}

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-muted-foreground mr-1">Days:</span>
        {([['all', 'All'], ['weekday', 'Weekdays'], ['weekend', 'Weekends']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setDayType(k)}
            className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
              dayType === k ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>

      {usable ? (
        <>
          <p className="text-[10px] text-muted-foreground">
            Change in {outcome.label.toLowerCase()} the morning after, versus your <strong>lowest third</strong> of days
            ({rangeOf(0)}), which averaged{' '}
            <span className="font-mono text-foreground">{baseline.value!.toFixed(decimals)}{outcome.unit ? ` ${outcome.unit}` : ''}</span>.{' '}
            <strong>{outcome.higherIsBetter ? 'Higher is better' : 'Lower is better'}</strong> for this metric, so red is the bad direction.
          </p>
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} width={52}
                tickFormatter={(v: number) => (v > 0 ? `+${v}` : String(v))} />
              <ReferenceLine y={0} stroke={NEUTRAL} strokeDasharray="4 4" />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
                formatter={(_v: number, _n, item) => {
                  const p = item.payload as typeof data[number];
                  const actual = p.value != null ? `${p.value.toFixed(decimals)}${outcome.unit ? ' ' + outcome.unit : ''}` : '—';
                  const d = p.delta == null ? ' (baseline)' : ` (${p.delta > 0 ? '+' : ''}${p.delta.toFixed(decimals)})`;
                  return [`${actual}${d} · ${p.range} · n=${p.n}${p.unreliable ? ' ⚠' : ''}`, outcome.label];
                }} />
              <Bar dataKey="change" radius={[3, 3, 0, 0]}>
                {data.map(b => (
                  <Cell key={b.label}
                    fill={b.delta == null || b.change === 0 ? NEUTRAL : worse(b.delta) ? BAD : GOOD}
                    fillOpacity={b.unreliable ? 0.45 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      ) : (
        <div style={{ height }} className="flex items-center justify-center text-center px-6">
          <p className="text-[11px] text-muted-foreground/80 max-w-md">
            {dayType === 'all'
              ? 'No morning-after readings for the lowest third yet, so there is nothing to measure against.'
              : 'Too few of these days in the selected day type. Try All.'}
          </p>
        </div>
      )}

      <div className="space-y-0.5">
        {data.map(b => (
          <div key={b.label} className="flex flex-wrap items-center gap-x-2 text-[10px]">
            <span className="w-24 text-muted-foreground">{b.label}</span>
            <span className="w-32 text-muted-foreground/70">{b.range}</span>
            <span className="font-mono w-14 text-right">{b.value != null ? b.value.toFixed(decimals) : '—'}</span>
            <span className={`font-mono w-14 text-right ${b.delta == null ? 'text-muted-foreground' : worse(b.delta) ? 'text-red-400' : 'text-green-400'}`}>
              {b.delta != null ? `${b.delta > 0 ? '+' : ''}${b.delta.toFixed(decimals)}` : 'baseline'}
            </span>
            <span className="text-muted-foreground">n={b.n}</span>
            {b.unreliable && <span className="text-amber-400">⚠ under {MIN_BUCKET_N} days</span>}
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/60 italic leading-relaxed">
        <strong>Method:</strong> your complete diary days are split into thirds on this measure, so &ldquo;high&rdquo; means high
        for you rather than against a textbook figure. Each third is compared with the morning after, the same way as the
        Alcohol and Sugar cards. <strong>Limits:</strong> hard training days mean more food and a bigger calorie deficit, and this card does
        not separate that from the food itself; weekends change eating and sleep together, so check Weekdays and
        Weekends before believing a pattern. Amounts are estimates, and this is association in your own data, not proof of cause.
      </p>
    </div>
  );
}
