'use client';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Circle, Loader2, Trash2 } from 'lucide-react';
import { useDataRefresh, useDataVersion } from '@/lib/data-refresh';
import { deriveDay, mealLine, type Meal } from '@/lib/meals';

const PORTIONS: { label: string; factor: number }[] = [
  { label: '½', factor: 0.5 }, { label: '¾', factor: 0.75 }, { label: '1¼', factor: 1.25 }, { label: '1½', factor: 1.5 },
];

/** The meals logged for one day, their totals, and the "that's everything" switch. */
export default function MealDiary({ date }: { date: string }) {
  const dataVersion = useDataVersion();
  const { refreshData } = useDataRefresh();
  const [meals, setMeals] = useState<Meal[] | null>(null);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/meals?date=${date}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMeals(json.meals ?? []); setComplete(json.complete === true); setError('');
    } catch (e) {
      setMeals([]); setError(e instanceof Error ? e.message : String(e));
    }
  }, [date]);
  // Blank the list only when the DAY changes; a refresh of the same day swaps in place.
  useEffect(() => { setMeals(null); }, [date]);
  useEffect(() => { load(); }, [load, dataVersion]);

  async function change(run: () => Promise<Response>) {
    setBusy(true); setError('');
    try {
      const res = await run();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Every card that reads the day's nutrition row needs the new numbers.
      await refreshData();
      await load();
    } catch (e) {
      setError(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }
  const json = (method: string, body: unknown) => fetch('/api/meals', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  if (meals === null) return <p className="text-xs text-muted-foreground">Loading the diary…</p>;

  const real = meals.filter(m => !m.no_alcohol_statement);
  // Same function the server uses, so what is shown is what is stored.
  const day = deriveDay(date, meals, complete);
  const total = (label: string, v: number | null | undefined, unit: string) =>
    v == null ? null : <span key={label} className="whitespace-nowrap"><span className="text-foreground">{v}{unit}</span> {label}</span>;
  const totals = [
    total('kcal', day.kcal, ''), total('protein', day.protein_g, ' g'), total('fibre', day.fibre_g, ' g'),
    total('added sugar', day.added_sugar_g, ' g'), total('veg & fruit', day.veg_fruit_portions, ''),
    total('of calories after 19:00', day.evening_kcal_pct, '%'), total('eating window', day.eating_window_h, ' h'),
  ].filter(Boolean);

  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">Meal diary</p>
          <p className="text-[11px] text-muted-foreground">Add meals with Quick log on the dashboard: a sentence or a photo.</p>
        </div>
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {real.length === 0 && !meals.some(m => m.no_alcohol_statement) && (
        <p className="text-[11px] text-muted-foreground">No meals logged for this day.</p>
      )}

      <ul className="space-y-1.5">
        {meals.map(m => (
          <li key={m.id} className="flex items-start justify-between gap-2">
            <span className="text-[11px] text-muted-foreground leading-snug">{mealLine(m)}</span>
            <span className="flex items-center gap-1 flex-shrink-0">
              {!m.no_alcohol_statement && PORTIONS.map(p => (
                <button key={p.label} disabled={busy} title={`Change the portion to ${p.label} of this`}
                  onClick={() => change(() => json('PATCH', { id: m.id, factor: p.factor }))}
                  className="text-[10px] font-mono px-1 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-40">
                  ×{p.label}
                </button>
              ))}
              <button disabled={busy} title="Delete this entry" aria-label="Delete this entry"
                onClick={() => change(() => fetch(`/api/meals?id=${m.id}`, { method: 'DELETE' }))}
                className="text-muted-foreground hover:text-foreground p-0.5 disabled:opacity-40">
                <Trash2 className="w-3 h-3" />
              </button>
            </span>
          </li>
        ))}
      </ul>

      <button disabled={busy} onClick={() => change(() => json('PATCH', { date, complete: !complete }))}
        className="flex items-start gap-2 text-left disabled:opacity-60">
        {complete ? <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" /> : <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />}
        <span>
          <span className="text-xs font-medium">That&apos;s everything I ate and drank this day</span>
          <span className="block text-[11px] text-muted-foreground leading-snug">
            {complete
              ? 'Day totals count, and anything not in the diary counts as none.'
              : 'Until you tick this, day totals are not calculated and nothing is assumed to be zero.'}
          </span>
        </span>
      </button>

      {complete && totals.length > 0 && (
        <p className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">{totals}</p>
      )}
      {complete && real.length > 0 && day.kcal == null && (
        <p className="text-[11px] text-amber-400">Calories are not totalled because one entry has no estimate (an amount typed by hand earlier).</p>
      )}
    </div>
  );
}
