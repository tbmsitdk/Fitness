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
  // A behavioural metric has no "worse" direction — see OutcomeDef.behavioural.
  const isWorse = (delta: number) =>
    outcome.behavioural ? false : (outcome.higherIsBetter ? delta < 0 : delta > 0);
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

  // The worst group, judged in the metric's own direction.
  const worst = present
    .filter(c => c.delta != null)
    .sort((a, b) => (isWorse(a.delta!) ? -Math.abs(a.delta!) : Math.abs(a.delta!))
                  - (isWorse(b.delta!) ? -Math.abs(b.delta!) : Math.abs(b.delta!)))[0];

  const data = present.map(c => ({
    label: c.label,
    value: c.value == null ? 0 : Number(c.value.toFixed(outcome.decimals)),
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
        <Tile label={outcome.behavioural ? 'Highest group' : 'Worst group'} value={worst?.label ?? '—'}
          sub={worst?.delta != null ? `${signed(worst.delta)} ${outcome.unit} vs clean` : ''}
          tone={worst?.delta != null && isWorse(worst.delta) ? 'bad' : undefined} />
        <Tile label="Combination" value={result.interactionLabel ?? '—'}
          sub={result.interaction != null ? `${signed(result.interaction)} vs the two added up` : 'needs all four groups'} />
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
            domain={['dataMin - 2', 'dataMax + 2']} />
          {result.cells.neither.value != null && (
            <ReferenceLine y={Number(result.cells.neither.value.toFixed(outcome.decimals))}
              stroke={BASE} strokeDasharray="4 4"
              label={{ value: 'clean days', position: 'insideTopRight', fill: BASE, fontSize: 9 }} />
          )}
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, _n, item) => {
              const p = item.payload as typeof data[number];
              const d = p.delta == null ? '' : ` (${signed(p.delta)})`;
              return [`${v}${outcome.unit ? ' ' + outcome.unit : ''}${d} · n=${p.n}${p.unreliable ? ' ⚠' : ''}`, outcome.label];
            }} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {data.map(d => (
              <Cell key={d.label}
                fill={d.unreliable || outcome.behavioural || d.delta == null
                  ? (d.unreliable ? THIN : BASE)
                  : isWorse(d.delta) ? WORSE : BETTER} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="space-y-0.5">
        {present.map(c => (
          <div key={c.key} className="flex items-center gap-2 text-[10px]">
            <span className="w-24 text-muted-foreground">{c.label}</span>
            <span className="font-mono w-16 text-right">{c.value != null ? fmt(c.value) : '—'}</span>
            <span className={`font-mono w-16 text-right ${
              c.delta == null || outcome.behavioural ? 'text-muted-foreground'
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
            ? <>Together they cost <strong>more than the two separately</strong> — {signed(result.interaction!)} {outcome.unit} beyond what adding the single effects would predict. If that holds up, separating them matters more than moderating either one.</>
            : result.interactionLabel === 'additive'
            ? <>The combination costs about what the two separately predict — they appear to act independently rather than amplifying each other.</>
            : <>Together they cost <strong>less than the two separately</strong> would predict. That usually means one is doing most of the damage, or the groups overlap in some other way.</>}
        </p>
      )}

      {outcome.behavioural && (
        <p className="text-[10px] text-amber-400/80 italic leading-relaxed">
          Next-day load is how hard you <em>chose</em> to train, not something that happened to
          you — so it is shown without a good/bad reading. A higher figure after drinking does not
          mean drinking helped; it means you trained anyway, or that day happened to fall before a
          planned session. For whether a habit cost you something, use Resting HR, Sleep score,
          Body battery or Stress.
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
