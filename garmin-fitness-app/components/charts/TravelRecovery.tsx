'use client';
import { useMemo, useState } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts';
import type { CircadianEvent } from '@/lib/travel';
import { OUTCOMES, type DayMetrics, type OutcomeDef } from '@/lib/nutrition-analysis';
import {
  recoveryCurve, zoneCorrelation, travelEffect, CURVE_FROM, CURVE_TO, MIN_BUCKET_N,
} from '@/lib/travel-analysis';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };
const EAST = '#d95926';   // the harder direction — warm
const WEST = '#3987e5';

interface Props {
  events: CircadianEvent[];
  metricsByDate: Map<string, DayMetrics>;
  height?: number;
}

export default function TravelRecovery({ events, metricsByDate, height = 240 }: Props) {
  const [outcomeKey, setOutcomeKey] = useState('hrv');
  const outcome: OutcomeDef = OUTCOMES.find(o => o.key === outcomeKey) ?? OUTCOMES[0];

  const east = useMemo(() => recoveryCurve(events, metricsByDate, outcome, 'east'), [events, metricsByDate, outcome]);
  const west = useMemo(() => recoveryCurve(events, metricsByDate, outcome, 'west'), [events, metricsByDate, outcome]);

  const corrEast = useMemo(() => zoneCorrelation(events, metricsByDate, outcome, 'east'), [events, metricsByDate, outcome]);
  const corrWest = useMemo(() => zoneCorrelation(events, metricsByDate, outcome, 'west'), [events, metricsByDate, outcome]);
  const effEast = useMemo(() => travelEffect(events, metricsByDate, outcome, 'east'), [events, metricsByDate, outcome]);
  const effWest = useMemo(() => travelEffect(events, metricsByDate, outcome, 'west'), [events, metricsByDate, outcome]);

  const data = useMemo(() => {
    const rows: { offset: number; label: string; east: number | null; west: number | null; nE: number; nW: number }[] = [];
    for (let off = CURVE_FROM; off <= CURVE_TO; off++) {
      const e = east.points.find(p => p.offset === off);
      const w = west.points.find(p => p.offset === off);
      rows.push({
        offset: off,
        label: off === 0 ? 'arrive' : off > 0 ? `+${off}` : String(off),
        east: e?.deviation ?? null,
        west: w?.deviation ?? null,
        nE: e?.n ?? 0,
        nW: w?.n ?? 0,
      });
    }
    return rows;
  }, [east, west]);

  if (east.trips === 0 && west.trips === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 text-center px-6" style={{ height: height + 40 }}>
        <p className="text-sm text-muted-foreground">Not enough to chart yet</p>
        <p className="text-[11px] text-muted-foreground/60 max-w-md">
          Each trip is scored against your own {outcome.label.toLowerCase()} in the 14 days before
          departure, so a trip only counts once that window has at least four readings. Log past
          trips to get an answer from data you already have.
        </p>
      </div>
    );
  }

  const fmt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(outcome.decimals)}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {OUTCOMES.map(o => (
          <button key={o.key} onClick={() => setOutcomeKey(o.key)}
            className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
              o.key === outcomeKey ? 'border-primary bg-primary/10 text-foreground'
                                   : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {o.label}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          {/* Pre-arrival days shade the baseline period they are measured against */}
          <ReferenceArea x1="-3" x2="arrive" fill="hsl(240 5% 40%)" fillOpacity={0.08} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => fmt(v)} />
          {/* Zero is each trip's own pre-departure normal */}
          <ReferenceLine y={0} stroke="hsl(240 5% 50%)" strokeDasharray="4 4"
            label={{ value: 'your baseline', position: 'insideTopRight', fill: 'hsl(240 5% 55%)', fontSize: 9 }} />
          <ReferenceLine x="arrive" stroke="hsl(240 5% 35%)" />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, n: string, item) => {
              const p = item.payload as typeof data[number];
              const n_ = n === 'east' ? p.nE : p.nW;
              return [`${fmt(v)} ${outcome.unit} (n=${n_})`, n === 'east' ? 'Eastward' : 'Westward'];
            }}
            labelFormatter={(l: string) => l === 'arrive' ? 'Arrival day' : `${l} days`} />
          <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8}
            formatter={(n: string) => (
              <span style={{ color: 'hsl(240 5% 64.9%)' }}>
                {n === 'east' ? `Eastward (${east.trips} trips)` : `Westward (${west.trips} trips)`}
              </span>
            )} />
          <Line type="monotone" dataKey="east" name="east" stroke={EAST} strokeWidth={2}
            dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls />
          <Line type="monotone" dataKey="west" name="west" stroke={WEST} strokeWidth={2}
            dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>

      {/* ── Correlations ─────────────────────────────────────────────────── */}
      <div className="rounded border border-border bg-secondary/30 p-2.5 space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Does crossing more zones cost more?
        </p>
        {[corrEast, corrWest].map(c => (
          <div key={c.direction} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px]">
            <span className="w-16 text-muted-foreground capitalize">{c.direction}</span>
            {c.r == null ? (
              <span className="text-muted-foreground">
                too few trips to correlate (need 3+, have {c.n})
              </span>
            ) : (
              <>
                <span className="font-mono">r = {c.r.toFixed(2)}</span>
                {c.perZone != null && (
                  <span className="font-mono text-muted-foreground">
                    ≈ {Math.abs(c.perZone).toFixed(outcome.decimals)} {outcome.unit}/zone
                  </span>
                )}
                <span className={
                  c.significance === 'likely real' ? 'text-amber-400'
                  : c.significance === 'suggestive' ? 'text-muted-foreground'
                  : 'text-muted-foreground/60'
                }>{c.significance}</span>
                <span className="text-muted-foreground/60">n={c.n}</span>
              </>
            )}
          </div>
        ))}
        {[['Eastward', effEast], ['Westward', effWest]].map(([label, e]) => {
          const eff = e as typeof effEast;
          if (eff.delta == null) return null;
          return (
            <div key={label as string} className="flex flex-wrap items-baseline gap-x-3 text-[11px]">
              <span className="w-16 text-muted-foreground">{label as string}</span>
              <span className="text-muted-foreground">
                average while adapting:{' '}
                <span className={`font-mono ${
                  (outcome.higherIsBetter ? eff.delta < 0 : eff.delta > 0) ? 'text-red-400' : 'text-green-400'
                }`}>{fmt(eff.delta)} {outcome.unit}</span>
              </span>
              {eff.unreliable && <span className="text-amber-400">⚠ under {MIN_BUCKET_N} days</span>}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground/60 italic leading-relaxed">
        Day 0 is arrival. Each trip is measured against your own average in the 14 days before it
        departed, so seasonal drift in fitness cannot masquerade as a travel effect, and only the
        deviations are pooled. East and west are never combined — advancing the clock and delaying
        it are different physiology, and averaging them cancels both out.{' '}
        <strong>Correlation here is association, not proof</strong>, and travel brings poor sleep,
        bad food and work stress along with the timezone change — any of which could be doing the
        damage. Treat a strong result as a reason to plan around it, not as a diagnosis.
      </p>
    </div>
  );
}
