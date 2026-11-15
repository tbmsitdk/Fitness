'use client';
import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import type { NutritionLog } from '@/lib/nutrition';
import { historyAverages, historyRows, trendPoints, type HistoryRow, type TotalKey } from '@/lib/nutrition-history';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

const TRENDS: { key: TotalKey; label: string; unit: string; color: string }[] = [
  { key: 'kcal',          label: 'Calories',    unit: ' kcal', color: '#3987e5' },
  { key: 'protein_g',     label: 'Protein',     unit: ' g',    color: '#199e70' },
  { key: 'fibre_g',       label: 'Fibre',       unit: ' g',    color: '#c98500' },
  { key: 'added_sugar_g', label: 'Added sugar', unit: ' g',    color: '#d55181' },
];

const COLUMNS: { key: keyof HistoryRow; label: string; unit?: string }[] = [
  { key: 'kcal', label: 'kcal' }, { key: 'protein_g', label: 'Protein', unit: 'g' }, { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'added_sugar_g', label: 'Added sugar', unit: 'g' }, { key: 'fat_g', label: 'Fat', unit: 'g' }, { key: 'fibre_g', label: 'Fibre', unit: 'g' },
  { key: 'veg_fruit_portions', label: 'Veg & fruit' }, { key: 'evening_kcal_pct', label: 'After 19:00', unit: '%' },
  { key: 'in_between_kcal_pct', label: 'In between', unit: '%' },
  { key: 'alcohol_units', label: 'Alcohol' },
];

const STATUS_LABEL = { complete: 'complete', partial: 'partial', by_hand: 'typed by hand' } as const;
const day = (d: string) => format(parseISO(d), 'EEE d MMM');

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
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(240 5% 55%)' }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 55%)' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v}${def.unit}`, def.label]} />
            <Line type="monotone" dataKey="value" stroke={def.color} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Day-by-day nutrition: trends over complete days, and a table of every logged day. */
export default function NutritionHistory({ logs, expanded }: { logs: NutritionLog[]; expanded?: boolean }) {
  const rows = useMemo(() => historyRows(logs), [logs]);
  const [showAll, setShowAll] = useState(false);
  const complete = rows.filter(r => r.status === 'complete').length;
  const shown = expanded || showAll ? rows : rows.slice(0, 10);

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground py-6 text-center">Nothing logged in this period. Add meals with Quick log.</p>;
  }

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-muted-foreground">
        {complete} complete {complete === 1 ? 'day' : 'days'} of {rows.length} logged in this period. Totals and trends use complete days only;
        on a partial day the amounts are not totalled, because half a day is not a low-intake day. All amounts are estimates.
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        {TRENDS.map(t => <Trend key={t.key} rows={rows} def={t} height={expanded ? 200 : 130} />)}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="text-left font-medium py-1.5 pr-3">Day</th>
              <th className="text-left font-medium py-1.5 pr-3">Status</th>
              {COLUMNS.map(c => <th key={c.key} className="text-right font-medium py-1.5 pl-3 whitespace-nowrap">{c.label}{c.unit ? ` (${c.unit})` : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.date} className={cn('border-t border-border/50', r.status !== 'complete' && 'text-muted-foreground')}>
                <td className="py-1.5 pr-3 whitespace-nowrap">{day(r.date)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {STATUS_LABEL[r.status]}{r.meals != null ? ` · ${r.meals} ${r.meals === 1 ? 'meal' : 'meals'}` : ''}
                </td>
                {COLUMNS.map(c => {
                  const v = r[c.key] as number | null;
                  return <td key={c.key} className="py-1.5 pl-3 text-right">{v == null ? <span className="text-muted-foreground/40">—</span> : v}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!expanded && rows.length > 10 && (
        <button onClick={() => setShowAll(s => !s)} className="text-[11px] text-muted-foreground hover:text-foreground">
          {showAll ? 'Show the last 10 days' : `Show all ${rows.length} days`}
        </button>
      )}
      <p className="text-[11px] text-muted-foreground/70">— means not known, not zero. To see or change a day&apos;s meals, pick the date in the food and drink form.</p>
    </div>
  );
}
