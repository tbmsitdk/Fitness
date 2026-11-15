'use client';
import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import type { WellnessRecord } from '@/types';
import type { NutritionLog } from '@/lib/nutrition';
import { historyAverages, historyRows, trendPoints, type HistoryRow, type TotalKey } from '@/lib/nutrition-history';
import { describeNet, energyDays, energySummary, type EnergyDay } from '@/lib/energy-balance';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };
const AXIS_TICK = { fontSize: 10, fill: 'hsl(240 5% 55%)' };
const GRID = 'hsl(240 3.7% 13%)';

// A deficit is not "good" and a surplus is not "bad" — that depends on the
// goal — so the two get neutral, clearly different hues rather than green/red.
const DEFICIT_COLOR = '#3987e5';
const SURPLUS_COLOR = '#c98500';

const TRENDS: { key: TotalKey; label: string; unit: string; color: string }[] = [
  { key: 'kcal',          label: 'Calories in', unit: ' kcal', color: '#3987e5' },
  { key: 'protein_g',     label: 'Protein',     unit: ' g',    color: '#199e70' },
  { key: 'fibre_g',       label: 'Fibre',       unit: ' g',    color: '#c98500' },
  { key: 'added_sugar_g', label: 'Added sugar', unit: ' g',    color: '#d55181' },
];

const COLUMNS: { key: keyof HistoryRow; label: string; unit?: string }[] = [
  { key: 'protein_g', label: 'Protein', unit: 'g' }, { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'added_sugar_g', label: 'Added sugar', unit: 'g' }, { key: 'fat_g', label: 'Fat', unit: 'g' }, { key: 'fibre_g', label: 'Fibre', unit: 'g' },
  { key: 'veg_fruit_portions', label: 'Veg & fruit' }, { key: 'evening_kcal_pct', label: 'After 19:00', unit: '%' },
  { key: 'in_between_kcal_pct', label: 'In between', unit: '%' },
  { key: 'alcohol_units', label: 'Alcohol' },
];

const STATUS_LABEL = { complete: 'complete', partial: 'partial', by_hand: 'typed by hand', none: 'no diary' } as const;
const day = (d: string) => format(parseISO(d), 'EEE d MMM');
const dash = <span className="text-muted-foreground/40">—</span>;

function Trend({ rows, def, height }: { rows: HistoryRow[]; def: typeof TRENDS[number]; height: number }) {
  const points = trendPoints(rows, def.key).map(p => ({ ...p, label: format(parseISO(p.date), 'd MMM') }));
  const avg = historyAverages(rows).find(a => a.key === def.key)!;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium">{def.label}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {avg.mean == null ? 'no complete days' : `average ${Math.round(avg.mean)}${def.unit} over ${avg.n} ${avg.n === 1 ? 'day' : 'days'}`}
        </p>
      </div>
      {points.length < 2 ? (
        <p className="text-[11px] text-muted-foreground py-6 text-center">
          {points.length === 0 ? 'Shown once a day is marked complete.' : 'One complete day so far; a line needs two.'}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={points} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v}${def.unit}`, def.label]} />
            <Line type="monotone" dataKey="value" stroke={def.color} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Calories in against calories burned, day by day, with the net as bars. */
function EnergyBalance({ energy, height }: { energy: EnergyDay[]; height: number }) {
  const summary = energySummary(energy);
  const points = energy.filter(d => d.net != null)
    .map(d => ({ label: format(parseISO(d.date), 'd MMM'), date: d.date, net: d.net as number, intake: d.intake, burned: d.burned }))
    .reverse();
  const waitingForBurn = energy.some(d => d.intakeStatus === 'complete' && d.burnStatus !== 'final');
  const noBurnAtAll = energy.every(d => d.burnStatus === 'none');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xs font-medium">Calories in vs burned</p>
        <p className="text-[11px] text-muted-foreground flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: DEFICIT_COLOR }} />deficit (burned more than eaten)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: SURPLUS_COLOR }} />surplus</span>
        </p>
      </div>

      {summary.days === 0 ? (
        <p className="text-[11px] text-muted-foreground py-4">
          {noBurnAtAll
            ? 'No calories-burned data yet. It arrives with the next Garmin sync; earlier days need a backfill (run Daily Garmin Sync with a larger "days back").'
            : 'No day has both halves yet. A day gets a net figure once its diary is marked complete and the watch\'s total for that day has synced, which happens the morning after.'}
        </p>
      ) : (
        <>
          <p className="text-sm">
            Average <span className="font-medium">{describeNet(summary.avgNet!)}</span> a day
            <span className="text-muted-foreground"> over {summary.days} {summary.days === 1 ? 'day' : 'days'}: {summary.avgIntake!.toLocaleString()} kcal in, {summary.avgBurned!.toLocaleString()} burned. {summary.deficitDays} deficit {summary.deficitDays === 1 ? 'day' : 'days'}, {summary.surplusDays} surplus.</span>
          </p>
          {summary.kgPerWeek != null && summary.kgPerWeek !== 0 && (
            <p className="text-[11px] text-muted-foreground">
              Held steady, that is roughly {Math.abs(summary.kgPerWeek)} kg {summary.kgPerWeek < 0 ? 'lost' : 'gained'} a week (at about 7,700 kcal per kg).
              Treat it as a direction, not a forecast: the weight trend on the scale is the real check.
            </p>
          )}
          {points.length >= 2 && (
            <ResponsiveContainer width="100%" height={height}>
              <BarChart data={points} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <ReferenceLine y={0} stroke="hsl(240 5% 40%)" />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'hsl(240 3.7% 13%)' }}
                  formatter={(v: number, _n, item) => [`${describeNet(v)} (${item.payload.intake} in, ${item.payload.burned} burned)`, 'Net']} />
                <Bar dataKey="net" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                  {points.map(p => <Cell key={p.date} fill={p.net < 0 ? DEFICIT_COLOR : SURPLUS_COLOR} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </>
      )}

      {waitingForBurn && summary.days > 0 && (
        <p className="text-[11px] text-muted-foreground">Some complete days are still waiting for the watch&apos;s final total; it syncs the morning after.</p>
      )}
      <p className="text-[11px] text-muted-foreground/70">
        Both sides are estimates: food from descriptions and photos, burn from the watch (resting plus active). Expect the daily net to be
        off by a few hundred kcal either way; the average over weeks is the useful number.
      </p>
    </div>
  );
}

interface Props {
  logs: NutritionLog[];
  /** Wellness rows for the same period: the source of calories burned. */
  wellness: WellnessRecord[];
  expanded?: boolean;
}

/** Day-by-day nutrition: energy balance, trends over complete days, and a table of every day. */
export default function NutritionHistory({ logs, wellness, expanded }: Props) {
  const rows = useMemo(() => historyRows(logs), [logs]);
  const energy = useMemo(() => energyDays(logs, wellness), [logs, wellness]);
  const [showAll, setShowAll] = useState(false);

  // The table lists every day that has a diary entry, a hand-typed entry, or a net figure.
  const table = useMemo(() => {
    const byDate = new Map(rows.map(r => [r.date, r]));
    const energyByDate = new Map(energy.map(e => [e.date, e]));
    const dates = new Set([...byDate.keys(), ...energy.filter(e => e.intakeStatus !== 'none').map(e => e.date)]);
    return [...dates].sort((a, b) => b.localeCompare(a)).map(date => ({ date, row: byDate.get(date) ?? null, energy: energyByDate.get(date) ?? null }));
  }, [rows, energy]);

  const complete = rows.filter(r => r.status === 'complete').length;
  const shown = expanded || showAll ? table : table.slice(0, 10);

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground py-6 text-center">Nothing logged in this period. Add meals with Quick log.</p>;
  }

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-muted-foreground">
        {complete} complete {complete === 1 ? 'day' : 'days'} of {rows.length} logged in this period. Totals and trends use complete days only;
        on a partial day the amounts are not totalled, because half a day is not a low-intake day. All amounts are estimates.
      </p>

      <EnergyBalance energy={energy} height={expanded ? 240 : 160} />

      <div className="grid gap-5 sm:grid-cols-2">
        {TRENDS.map(t => <Trend key={t.key} rows={rows} def={t} height={expanded ? 200 : 130} />)}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="text-left font-medium py-1.5 pr-3">Day</th>
              <th className="text-left font-medium py-1.5 pr-3">Status</th>
              <th className="text-right font-medium py-1.5 pl-3 whitespace-nowrap">In (kcal)</th>
              <th className="text-right font-medium py-1.5 pl-3 whitespace-nowrap">Burned (kcal)</th>
              <th className="text-right font-medium py-1.5 pl-3 whitespace-nowrap">Net</th>
              {COLUMNS.map(c => <th key={c.key} className="text-right font-medium py-1.5 pl-3 whitespace-nowrap">{c.label}{c.unit ? ` (${c.unit})` : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ date, row, energy: e }) => {
              const status = row?.status ?? 'none';
              return (
                <tr key={date} className={cn('border-t border-border/50', status !== 'complete' && 'text-muted-foreground')}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{day(date)}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {STATUS_LABEL[status]}{row?.meals != null ? ` · ${row.meals} ${row.meals === 1 ? 'meal' : 'meals'}` : ''}
                  </td>
                  <td className="py-1.5 pl-3 text-right">{row?.kcal ?? dash}</td>
                  <td className="py-1.5 pl-3 text-right" title={e?.burnStatus === 'partial' ? 'The watch total for this day has not finished syncing' : undefined}>
                    {e?.burned ?? (e?.burnStatus === 'partial' ? <span className="text-muted-foreground/60">pending</span> : dash)}
                  </td>
                  <td className="py-1.5 pl-3 text-right whitespace-nowrap">
                    {e?.net == null ? dash : (
                      <span style={{ color: e.net < 0 ? DEFICIT_COLOR : e.net > 0 ? SURPLUS_COLOR : undefined }}>
                        {e.net > 0 ? '+' : e.net < 0 ? '−' : ''}{Math.abs(e.net).toLocaleString()} {e.net < 0 ? 'deficit' : e.net > 0 ? 'surplus' : ''}
                      </span>
                    )}
                  </td>
                  {COLUMNS.map(c => {
                    const v = row ? (row[c.key] as number | null) : null;
                    return <td key={c.key} className="py-1.5 pl-3 text-right">{v == null ? dash : v}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!expanded && table.length > 10 && (
        <button onClick={() => setShowAll(s => !s)} className="text-[11px] text-muted-foreground hover:text-foreground">
          {showAll ? 'Show the last 10 days' : `Show all ${table.length} days`}
        </button>
      )}
      <p className="text-[11px] text-muted-foreground/70">— means not known, not zero. To see or change a day&apos;s meals, pick the date in the food and drink form.</p>
    </div>
  );
}
