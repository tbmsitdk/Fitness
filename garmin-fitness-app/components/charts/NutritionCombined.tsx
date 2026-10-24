'use client';
import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';
import type { NutritionLog } from '@/lib/nutrition';
import {
  combinedImpact, availableOutcomes, stressStandsInForHrv, OUTCOMES, MIN_BUCKET_N,
  type DayMetrics, type OutcomeDef, type CombinedCell,
} from '@/lib/nutrition-analysis';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };
const BASE = 'hsl(240 5% 45%)';
const WORSE = '#d55181';
const BETTER = '#199e70';
const THIN = 'hsl(240 5% 28%)';

interface Props {
  logs: NutritionLog[];
  metricsByDate: Map<string, DayMetrics>;
  height?: number;
}

function Tile({ label, value, sub, tone }: {
  label: string; value: string; sub: string; tone?: 'bad' | 'good';
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold font-mono leading-tight ${
        tone === 'bad' ? 'text-red-400' : tone === 'good' ? 'text-green-400' : ''}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

export default function NutritionCombined({ logs, metricsByDate, height = 220 }: Props) {
  const outcomes = useMemo(() => availableOutcomes(metricsByDate), [metricsByDate]);
  const hrvIsStress = useMemo(() => stressStandsInForHrv(metricsByDate), [metricsByDate]);
  const [requested, setRequested] = useState<string | null>(null);
  const outcome: OutcomeDef = outcomes.find(o => o.key === requested) ?? outcomes[0] ?? OUTCOMES[0];

  const result = useMemo(
    () => combinedImpact(logs, metricsByDate, outcome),
    [logs, metricsByDate, outcome],
  );

  const order: CombinedCell[] = [
    result.cells.neither, result.cells.alcoholOnly, result.cells.sugarOnly, result.cells.both,
  ];
  const present = order.filter(c => c.n > 0);

  const fmt = (v: number) => v.toFixed(outcome.decimals);
  const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(outcome.decimals)}`;
  const isWorse = (delta: number) => (outcome.higherIsBetter ? delta < 0 : delta > 0);
  const hasBaseline = result.cells.neither.value != null;

  if (present.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-center px-6" style={{ height: height + 60 }}>
        <p className="text-sm text-muted-foreground">Not enough data yet</p>
        <p className="text-[11px] text-muted-foreground/80 max-w-md">
          This splits days four ways — neither, alcohol only, sugar only, both — so it needs days
          in at least two of them. Right now {present.length === 0 ? 'no day falls' : 'only one group falls'} into a group.
        </p>
        {result.unclassified > 0 && (
          <p className="text-[11px] text-muted-foreground/60 max-w-md">
            <strong>{result.unclassified}</strong> day{result.unclassified === 1 ? '' : 's'} could
            not be placed because only one of the two was recorded. A day with alcohol entered but
            candy left blank might be &ldquo;alcohol only&rdquo; or &ldquo;both&rdquo; — enter 0 for
            whichever you had none of so the day can be used.
          </p>
        )}
      </div>
    );
  }

  // The worst group, judged in the metric's own direction — and ONLY among
  // groups that are genuinely worse than clean days. Previously this sorted
  // every group and took one end, so on a metric where everything beat the
  // baseline it labelled the smallest IMPROVEMENT as "worst": sleep score
  // +6.5 was being reported as the worst group.
  const harmed = present.filter(c => c.delta != null && isWorse(c.delta));
  const worst = harmed.sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))[0] ?? null;

  /**
   * Bars show HARM, not the raw metric: the change from clean days, flipped so
   * that UP IS ALWAYS WORSE whatever direction the underlying metric runs.
   * A drop in sleep score and a rise in resting HR are both damage, and
   * plotting raw values made the reader work that out per metric.
   */
  const harmOf = (delta: number | null) =>
    delta == null ? null : Number((outcome.higherIsBetter ? -delta : delta).toFixed(outcome.decimals));

  const data = present.map(c => ({
    label: c.label,
    harm: c.key === 'neither' ? 0 : harmOf(c.delta),
    value: c.value,
    n: c.n,
    delta: c.delta,
    unreliable: c.unreliable,
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {outcomes.map(o => (
          <button key={o.key} onClick={() => setRequested(o.key)}
            className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
              o.key === outcome.key ? 'border-primary bg-primary/10 text-foreground'
                                    : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {o.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Clean days" value={String(result.cells.neither.n)}
          sub={result.cells.neither.value != null ? `${outcome.label.toLowerCase()} ${fmt(result.cells.neither.value)}` : 'no baseline yet'} />
        <Tile label="Both together" value={String(result.cells.both.n)}
          sub={result.cells.both.delta != null ? `${signed(result.cells.both.delta)} ${outcome.unit}` : 'not enough data'}
          tone={result.cells.both.delta != null ? (isWorse(result.cells.both.delta) ? 'bad' : 'good') : undefined} />
        <Tile label="Worst group"
          value={worst ? worst.label : hasBaseline ? 'None' : '—'}
          sub={worst
            ? `${signed(worst.delta!)} ${outcome.unit} vs clean`
            : hasBaseline ? 'no group worse than clean days' : 'needs clean days to compare'}
          tone={worst ? 'bad' : undefined} />
        <Tile label="Combination" value={result.interactionLabel ?? '—'}
          sub={result.interaction != null ? `${signed(result.interaction)} vs the two added up` : 'needs all four groups'} />
      </div>

      {hasBaseline && (
        <p className="text-[10px] text-muted-foreground">
          How much <strong>worse</strong> than your clean days — taller is worse.
          {' '}Clean days averaged{' '}
          <span className="font-mono text-foreground">
            {fmt(result.cells.neither.value!)}{outcome.unit ? ` ${outcome.unit}` : ''}
          </span>{' '}{outcome.label.toLowerCase()}.
        </p>
      )}

      {hasBaseline ? (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
              width={52}
              tickFormatter={(v: number) => (v > 0 ? `+${v}` : String(v))}
              label={{ value: 'worse →', angle: -90, position: 'insideLeft',
                       fill: 'hsl(240 5% 55%)', fontSize: 9, offset: 12 }} />
            {/* Zero is a clean day; bars rise into harm and fall into benefit. */}
            <ReferenceLine y={0} stroke={BASE} strokeDasharray="4 4"
              label={{ value: 'clean days', position: 'insideTopRight', fill: BASE, fontSize: 9 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
              formatter={(_v: number, _n, item) => {
                const p = item.payload as typeof data[number];
                const dir = p.harm == null || p.harm === 0 ? 'baseline' : p.harm > 0 ? 'worse' : 'better';
                const actual = p.value != null ? `${fmt(p.value)}${outcome.unit ? ' ' + outcome.unit : ''}` : '—';
                const d = p.delta == null ? '' : ` (${signed(p.delta)})`;
                return [`${actual}${d} · ${dir} · n=${p.n}${p.unreliable ? ' ⚠' : ''}`, outcome.label];
              }} />
            <Bar dataKey="harm" radius={[3, 3, 0, 0]}>
              {/* Thin groups fade rather than turning grey — see NutritionImpact. */}
              {data.map(d => (
                <Cell key={d.label}
                  fill={d.harm == null || d.harm === 0 ? BASE : d.harm > 0 ? WORSE : BETTER}
                  fillOpacity={d.unreliable ? 0.45 : 1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ height }} className="flex flex-col items-center justify-center gap-1.5 text-center px-6">
          <p className="text-[11px] text-muted-foreground/80 max-w-md">
            No clean days logged, so there is nothing to measure impact against — the chart plots the
            change from a day with neither, and without one there is no zero.
          </p>
          <p className="text-[11px] text-muted-foreground/60">
            Enter 0 for alcohol, candy and sugary drinks on any ordinary day. The values are listed below meanwhile.
          </p>
        </div>
      )}

      <div className="space-y-0.5">
        {present.map(c => (
          <div key={c.key} className="flex items-center gap-2 text-[10px]">
            <span className="w-24 text-muted-foreground">{c.label}</span>
            <span className="font-mono w-16 text-right">{c.value != null ? fmt(c.value) : '—'}</span>
            <span className={`font-mono w-16 text-right ${
              c.delta == null ? 'text-muted-foreground'
                : isWorse(c.delta) ? 'text-red-400' : 'text-green-400'}`}>
              {c.delta != null ? signed(c.delta)
                : c.key === 'neither' ? 'baseline'
                : hasBaseline ? '—' : 'no baseline'}
            </span>
            <span className="text-muted-foreground">n={c.n}</span>
            {c.unreliable && <span className="text-amber-400">⚠ under {MIN_BUCKET_N} days</span>}
          </div>
        ))}
      </div>

      {result.interactionLabel && (
        <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
          {result.interactionLabel === 'compounding'
            ? <>Together the result is <strong>worse than the two separately predict</strong> — {signed(result.interaction!)} {outcome.unit} away from what adding the single effects would give. If that holds up, keeping them apart matters more than moderating either one.</>
            : result.interactionLabel === 'additive'
            ? <>The combination lands about where the two separately predict — they appear to act independently rather than amplifying each other.</>
            : <>Together the result is <strong>better than the two separately predict</strong>. That usually means one is doing most of the work, or the groups overlap in some other way.</>}
        </p>
      )}


      {hrvIsStress && outcome.key === 'stress' && (
        <p className="text-[10px] text-muted-foreground/70 italic">
          Your tracker exports no raw HRV (RMSSD), so stress score is the HRV-derived metric here.
          Lower is better, so a bar above the clean-day line is a worse outcome.
        </p>
      )}

      {result.unclassified > 0 && (
        <p className="text-[10px] text-amber-400/80 italic">
          {result.unclassified} logged day{result.unclassified === 1 ? '' : 's'} excluded because only
          one of the two was recorded — a day with alcohol entered but candy blank cannot be told
          apart from a &ldquo;both&rdquo; day. Enter 0 for whichever you had none of.
        </p>
      )}

      <p className="text-[10px] text-muted-foreground/60 italic leading-relaxed">
        Bars show the change from your clean days with the sign flipped so <strong>up is always
        worse</strong>, whatever direction the metric itself runs — a drop in sleep score and a rise
        in resting HR both rise here. The numbers under the chart are the real values.
        Sugar here means candy or sugary drinks; crisps are savoury and tracked separately.
        Measured the morning after. The four groups are compared against your own clean days, and
        the combination is judged against what the two single effects would predict if they simply
        added up.{' '}
        <strong>With this few days per group the interaction is indicative only</strong> — it is the
        most data-hungry number on the page, since it depends on all four groups at once.
      </p>
    </div>
  );
}
