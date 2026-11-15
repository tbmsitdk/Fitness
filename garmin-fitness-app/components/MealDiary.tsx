'use client';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Circle, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useDataRefresh, useDataVersion } from '@/lib/data-refresh';
import { GRAMS_PER_UNIT } from '@/lib/nutrition';
import { MEAL_TYPES, MEAL_TYPE_LABEL, deriveDay, kcalByMealType, mealLine, untimedFood, type Meal } from '@/lib/meals';

const PORTIONS: { label: string; factor: number }[] = [
  { label: '½', factor: 0.5 }, { label: '¾', factor: 0.75 }, { label: '1¼', factor: 1.25 }, { label: '1½', factor: 1.5 },
];

/** The edit form's fields, as text: an empty box means "not known", never zero. */
type Draft = Record<
  'description' | 'time' | 'meal_type' | 'kcal' | 'protein_g' | 'carbs_g' | 'added_sugar_g' | 'fat_g' | 'fibre_g' |
  'veg_fruit_portions' | 'alcohol_units' | 'candy_portions' | 'savoury_snacks' | 'sugary_drinks', string
> & { caffeine: boolean };

const text = (v: number | null) => (v == null ? '' : String(v));

function draftOf(m: Meal): Draft {
  return {
    description: m.description, time: m.time ?? '', meal_type: m.meal_type ?? '',
    kcal: text(m.kcal), protein_g: text(m.protein_g), carbs_g: text(m.carbs_g), added_sugar_g: text(m.added_sugar_g),
    fat_g: text(m.fat_g), fibre_g: text(m.fibre_g), veg_fruit_portions: text(m.veg_fruit_portions),
    // Shown in units, to one decimal, so a correction is typed the way it is thought of.
    alcohol_units: String(Math.round((m.alcohol_g / GRAMS_PER_UNIT) * 10) / 10),
    candy_portions: String(m.candy_portions), savoury_snacks: String(m.savoury_snacks), sugary_drinks: String(m.sugary_drinks),
    caffeine: m.caffeine,
  };
}

/** What is sent to the server. Empty estimate → null (unknown). Empty count → 0. */
function payloadOf(d: Draft) {
  const unknownIfEmpty = (v: string) => (v.trim() === '' ? null : Number(v));
  const zeroIfEmpty = (v: string) => (v.trim() === '' ? 0 : Number(v));
  return {
    description: d.description, time: d.time || null, meal_type: d.meal_type || null,
    kcal: unknownIfEmpty(d.kcal), protein_g: unknownIfEmpty(d.protein_g), carbs_g: unknownIfEmpty(d.carbs_g),
    added_sugar_g: unknownIfEmpty(d.added_sugar_g), fat_g: unknownIfEmpty(d.fat_g), fibre_g: unknownIfEmpty(d.fibre_g),
    veg_fruit_portions: unknownIfEmpty(d.veg_fruit_portions),
    alcohol_units: zeroIfEmpty(d.alcohol_units), candy_portions: zeroIfEmpty(d.candy_portions),
    savoury_snacks: zeroIfEmpty(d.savoury_snacks), sugary_drinks: zeroIfEmpty(d.sugary_drinks),
    caffeine: d.caffeine,
  };
}

const NUMBER_FIELDS: { key: keyof Draft; label: string; step: string }[] = [
  { key: 'kcal', label: 'Calories (kcal)', step: '10' }, { key: 'protein_g', label: 'Protein (g)', step: '1' },
  { key: 'carbs_g', label: 'Carbs (g)', step: '1' }, { key: 'added_sugar_g', label: 'Added sugar (g)', step: '1' },
  { key: 'fat_g', label: 'Fat (g)', step: '1' }, { key: 'fibre_g', label: 'Fibre (g)', step: '1' },
  { key: 'veg_fruit_portions', label: 'Veg & fruit (portions)', step: '0.5' },
  { key: 'alcohol_units', label: 'Alcohol (units)', step: '0.5' },
  { key: 'candy_portions', label: 'Candy (portions)', step: '0.5' }, { key: 'savoury_snacks', label: 'Savoury snacks', step: '0.5' },
  { key: 'sugary_drinks', label: 'Sugary drinks', step: '1' },
];

const INPUT = 'w-full rounded border border-border bg-secondary px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring';

function EditForm({ meal, busy, onSave, onCancel }: {
  meal: Meal; busy: boolean; onSave: (payload: ReturnType<typeof payloadOf>) => void; onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftOf(meal));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(prev => ({ ...prev, [k]: v }));
  const invalid = d.description.trim() === ''
    || NUMBER_FIELDS.some(f => { const v = d[f.key] as string; return v.trim() !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0); });

  return (
    <div className="rounded-md border border-border bg-secondary/30 p-2.5 space-y-2">
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">What it was</span>
        <input type="text" value={d.description} maxLength={200} onChange={e => set('description', e.target.value)} className={INPUT} />
      </label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Meal</span>
          <select value={d.meal_type} onChange={e => set('meal_type', e.target.value)} className={INPUT}>
            <option value="">Not sorted</option>
            {MEAL_TYPES.map(t => <option key={t} value={t}>{MEAL_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Time</span>
          <input type="time" value={d.time} onChange={e => set('time', e.target.value)} className={INPUT} />
        </label>
        {NUMBER_FIELDS.map(f => (
          <label key={f.key} className="block">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{f.label}</span>
            <input type="number" min="0" step={f.step} value={d[f.key] as string}
              onChange={e => set(f.key, e.target.value as never)} className={`${INPUT} font-mono`} />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={d.caffeine} onChange={e => set('caffeine', e.target.checked)} className="rounded border-border" />
          Contains caffeine
        </label>
        <span className="flex gap-2">
          <button onClick={onCancel} disabled={busy} className="text-[11px] px-2 py-1 rounded text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={() => onSave(payloadOf(d))} disabled={busy || invalid}
            className="text-[11px] px-2.5 py-1 rounded bg-foreground text-background disabled:opacity-40">Save changes</button>
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground/70">
        Leave an estimate empty if you do not know it; it is then left out of the day&apos;s total instead of counting as zero. 1 alcohol unit = 12 g pure alcohol.
      </p>
    </div>
  );
}

/** The meals logged for one day, their totals, and the "that's everything" switch. */
export default function MealDiary({ date }: { date: string }) {
  const dataVersion = useDataVersion();
  const { refreshData } = useDataRefresh();
  const [meals, setMeals] = useState<Meal[] | null>(null);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<number | null>(null);

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
  useEffect(() => { setMeals(null); setEditing(null); }, [date]);
  useEffect(() => { load(); }, [load, dataVersion]);

  async function change(run: () => Promise<Response>): Promise<boolean> {
    setBusy(true); setError('');
    try {
      const res = await run();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      // Every card that reads the day's nutrition row needs the new numbers.
      await refreshData();
      await load();
      return true;
    } catch (e) {
      setError(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
      return false;
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
    total('of calories after 19:00', day.evening_kcal_pct, '%'), total('of calories in between meals', day.in_between_kcal_pct, '%'),
    total('eating window', day.eating_window_h, ' h'),
  ].filter(Boolean);

  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">Meal diary</p>
          <p className="text-[11px] text-muted-foreground">Add meals with Quick log on the dashboard: a sentence or a photo. Use the pencil to correct an entry.</p>
        </div>
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {real.length === 0 && !meals.some(m => m.no_alcohol_statement) && (
        <p className="text-[11px] text-muted-foreground">No meals logged for this day.</p>
      )}

      {kcalByMealType(meals).map(group => (
        <div key={group.label}>
          <p className="text-[11px] font-medium flex items-baseline justify-between">
            <span>{group.label}</span>
            <span className="text-muted-foreground tabular-nums">{group.kcal == null ? '' : `~${group.kcal} kcal`}</span>
          </p>
          <ul className="mt-1 space-y-1.5">
            {group.meals.map(m => (
              <li key={m.id}>
                {editing === m.id ? (
                  <EditForm meal={m} busy={busy} onCancel={() => setEditing(null)}
                    onSave={async payload => { if (await change(() => json('PATCH', { id: m.id, meal: payload }))) setEditing(null); }} />
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    {/* The group heading already names the meal; show the rest of the line. */}
                    <span className="text-[11px] text-muted-foreground leading-snug">{mealLine({ ...m, meal_type: null })}</span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {PORTIONS.map(p => (
                        <button key={p.label} disabled={busy} title={`Change the portion to ${p.label} of this`}
                          onClick={() => change(() => json('PATCH', { id: m.id, factor: p.factor }))}
                          className="text-[10px] font-mono px-1 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-40">
                          ×{p.label}
                        </button>
                      ))}
                      <button disabled={busy} title="Edit this entry" aria-label="Edit this entry" onClick={() => setEditing(m.id ?? null)}
                        className="text-muted-foreground hover:text-foreground p-0.5 disabled:opacity-40">
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button disabled={busy} title="Delete this entry" aria-label="Delete this entry"
                        onClick={() => change(() => fetch(`/api/meals?id=${m.id}`, { method: 'DELETE' }))}
                        className="text-muted-foreground hover:text-foreground p-0.5 disabled:opacity-40">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {meals.filter(m => m.no_alcohol_statement).map(m => (
        <p key={m.id} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>No alcohol today</span>
          <button disabled={busy} title="Remove this statement" aria-label="Remove this statement"
            onClick={() => change(() => fetch(`/api/meals?id=${m.id}`, { method: 'DELETE' }))}
            className="hover:text-foreground p-0.5 disabled:opacity-40">
            <Trash2 className="w-3 h-3" />
          </button>
        </p>
      ))}

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

      {untimedFood(meals).length > 0 && (
        <p className="text-[11px] text-amber-400">
          No time on: {untimedFood(meals).map(m => m.description.split(':')[0].slice(0, 40)).join('; ')}. Last food, the eating window and the
          after-19:00 share stay unknown until each has one: use the pencil, or add the time when you log.
        </p>
      )}

      {complete && totals.length > 0 && (
        <p className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">{totals}</p>
      )}
      {complete && real.length > 0 && day.kcal == null && (
        <p className="text-[11px] text-amber-400">Calories are not totalled because one entry has no estimate. Use the pencil on that entry to give it one, or delete it.</p>
      )}
    </div>
  );
}
