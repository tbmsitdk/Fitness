'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Check, Loader2, Info, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDataVersion, useRefreshAfter } from '@/lib/data-refresh';
import {
  NUTRITION_FIELDS, MEAL_QUALITY_LEVELS, ALCOHOL_REFERENCE, CANDY_REFERENCE,
  hasAnyEntry, type NutritionLog as NLog, type FieldDef,
} from '@/lib/nutrition';

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

type Draft = {
  alcohol_units: string; candy_portions: string; sugary_drinks: string;
  last_food_time: string; caffeine_after_14: boolean; meal_quality: string; notes: string;
};

const EMPTY: Draft = {
  alcohol_units: '', candy_portions: '', sugary_drinks: '',
  last_food_time: '', caffeine_after_14: false, meal_quality: '', notes: '',
};

/** The written definition for one field — collapsed by default, never removed. */
function Definition({ def, extra }: { def: FieldDef; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
        <Info className="w-3 h-3" />
        {open ? 'Hide definition' : 'What counts?'}
      </button>
      {open && (
        <div className="mt-1.5 rounded border border-border bg-secondary/40 p-2.5 space-y-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-green-400 mb-1">Counts</p>
            <ul className="space-y-0.5">
              {def.counts.map((c, i) => (
                <li key={i} className="text-[11px] text-muted-foreground leading-snug">· {c}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-400 mb-1">Does not count</p>
            <ul className="space-y-0.5">
              {def.doesNotCount.map((c, i) => (
                <li key={i} className="text-[11px] text-muted-foreground leading-snug">· {c}</li>
              ))}
            </ul>
          </div>
          {extra}
        </div>
      )}
    </div>
  );
}

function RefTable({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{title}</p>
      <table className="w-full">
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <td className="text-[11px] text-muted-foreground py-0.5 pr-2">{r.label}</td>
              <td className="text-[11px] font-mono text-right text-foreground">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function NutritionLog() {
  const [date, setDate] = useState(todayStr);
  const [all, setAll] = useState<NLog[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dataVersion = useDataVersion();

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/nutrition?days=3650&t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setAll(Array.isArray(d.logs) ? d.logs : []);
    } catch {
      setAll([]);
      setError('Could not load existing entries');
    }
  }, []);

  useEffect(() => { load(); }, [load, dataVersion]);

  // Show exactly what is stored for the selected day; a day with nothing saved
  // stays blank rather than pre-filling zeros that were never entered.
  useEffect(() => {
    const row = (all ?? []).find(l => l.date.slice(0, 10) === date);
    setSavedAt(null);
    if (!row) { setDraft(EMPTY); return; }
    setDraft({
      alcohol_units: row.alcohol_units?.toString() ?? '',
      candy_portions: row.candy_portions?.toString() ?? '',
      sugary_drinks: row.sugary_drinks?.toString() ?? '',
      last_food_time: row.last_food_time ?? '',
      caffeine_after_14: row.caffeine_after_14 === true,
      meal_quality: row.meal_quality?.toString() ?? '',
      notes: row.notes ?? '',
    });
  }, [all, date]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft(d => ({ ...d, [k]: v }));

  const doSave = useCallback(async (payload: Draft): Promise<boolean> => {
    setSaving(true); setError(null);
    try {
      const r = await fetch('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          alcohol_units: payload.alcohol_units === '' ? null : Number(payload.alcohol_units),
          candy_portions: payload.candy_portions === '' ? null : Number(payload.candy_portions),
          sugary_drinks: payload.sugary_drinks === '' ? null : Number(payload.sugary_drinks),
          last_food_time: payload.last_food_time || null,
          caffeine_after_14: payload.caffeine_after_14,
          meal_quality: payload.meal_quality === '' ? null : Number(payload.meal_quality),
          notes: payload.notes,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSavedAt(new Date().toLocaleTimeString());
      await load();
      return true;
    } catch {
      setError('Save failed — not stored');
      return false;
    } finally {
      setSaving(false);
    }
  }, [date, load]);

  const save = useRefreshAfter(doSave);

  const field = (k: string) => NUTRITION_FIELDS.find(f => f.key === k)!;
  const loggedDays = useMemo(() => (all ?? []).length, [all]);

  const nothingEntered = !hasAnyEntry({
    alcohol_units: draft.alcohol_units === '' ? null : Number(draft.alcohol_units),
    candy_portions: draft.candy_portions === '' ? null : Number(draft.candy_portions),
    sugary_drinks: draft.sugary_drinks === '' ? null : Number(draft.sugary_drinks),
    meal_quality: draft.meal_quality === '' ? null : Number(draft.meal_quality),
    last_food_time: draft.last_food_time || null,
    caffeine_after_14: draft.caffeine_after_14,
  });

  const numInput = (k: 'alcohol_units' | 'candy_portions' | 'sugary_drinks', step: string, ph: string) => (
    <input
      type="number" min="0" step={step} placeholder={ph}
      value={draft[k]} onChange={e => set(k, e.target.value)}
      className="w-24 rounded border border-border bg-secondary px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)}
          className="rounded border border-border bg-secondary px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
        <span className="text-[11px] text-muted-foreground">
          {loggedDays} day{loggedDays !== 1 ? 's' : ''} logged
        </span>
        <div className="ml-auto flex items-center gap-2">
          {savedAt && <span className="text-[11px] text-green-400 flex items-center gap-1"><Check className="w-3 h-3" />Saved</span>}
          {error && <span className="text-[11px] text-red-400">{error}</span>}
          {/* Writes real zeros. Without this, a day you simply never opened would
              be indistinguishable from a day with nothing to report — and every
              forgotten day would quietly count as sober and sugar-free. */}
          <Button size="sm" variant="ghost" disabled={saving}
            title="Record explicit zeros for alcohol, candy and sugary drinks"
            onClick={() => {
              const clean = { ...draft, alcohol_units: '0', candy_portions: '0', sugary_drinks: '0' };
              setDraft(clean); save(clean);
            }}>
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />Clean day
          </Button>
          <Button size="sm" onClick={() => save(draft)} disabled={saving || nothingEntered}
            title={nothingEntered ? 'Nothing entered yet' : 'Save this day'}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
            Save day
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground border-l-2 border-border pl-2.5 leading-relaxed">
        This is not calorie tracking. It records a few things that are easy to recall and
        plausibly affect your sleep and training. <strong>Leave a field blank if you genuinely
        don&apos;t know</strong> — a blank means &ldquo;not recorded&rdquo;, while a 0 means
        &ldquo;none today&rdquo;, and the analysis treats them very differently.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Alcohol */}
        <div className="rounded-md border border-border bg-card p-3">
          <label className="text-xs font-semibold">{field('alcohol_units').label}</label>
          <p className="text-[11px] text-muted-foreground mb-2">{field('alcohol_units').summary}</p>
          <div className="flex items-center gap-2">
            {numInput('alcohol_units', '0.5', 'units')}
            <span className="text-[11px] text-muted-foreground">units</span>
          </div>
          <Definition def={field('alcohol_units')}
            extra={<RefTable title="Reference" rows={ALCOHOL_REFERENCE.map(r => ({ label: r.label, value: r.units }))} />} />
        </div>

        {/* Candy */}
        <div className="rounded-md border border-border bg-card p-3">
          <label className="text-xs font-semibold">{field('candy_portions').label}</label>
          <p className="text-[11px] text-muted-foreground mb-2">{field('candy_portions').summary}</p>
          <div className="flex items-center gap-2">
            {numInput('candy_portions', '0.5', 'portions')}
            <span className="text-[11px] text-muted-foreground">portions</span>
          </div>
          <Definition def={field('candy_portions')}
            extra={<RefTable title="Reference" rows={CANDY_REFERENCE.map(r => ({ label: r.label, value: r.portions }))} />} />
        </div>

        {/* Sugary drinks */}
        <div className="rounded-md border border-border bg-card p-3">
          <label className="text-xs font-semibold">{field('sugary_drinks').label}</label>
          <p className="text-[11px] text-muted-foreground mb-2">{field('sugary_drinks').summary}</p>
          <div className="flex items-center gap-2">
            {numInput('sugary_drinks', '1', 'servings')}
            <span className="text-[11px] text-muted-foreground">servings of 25–33 cl</span>
          </div>
          <Definition def={field('sugary_drinks')} />
        </div>

        {/* Last food + caffeine */}
        <div className="rounded-md border border-border bg-card p-3">
          <label className="text-xs font-semibold">{field('last_food_time').label}</label>
          <p className="text-[11px] text-muted-foreground mb-2">{field('last_food_time').summary}</p>
          <div className="flex items-center gap-3">
            <input type="time" value={draft.last_food_time}
              onChange={e => set('last_food_time', e.target.value)}
              className="rounded border border-border bg-secondary px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={draft.caffeine_after_14}
                onChange={e => set('caffeine_after_14', e.target.checked)}
                className="rounded border-border" />
              Caffeine after 14:00
            </label>
          </div>
          <Definition def={field('last_food_time')} />
          <Definition def={field('caffeine_after_14')} />
        </div>
      </div>

      {/* Meal quality — anchored levels, chosen not scored */}
      <div className="rounded-md border border-border bg-card p-3">
        <label className="text-xs font-semibold">{field('meal_quality').label}</label>
        <p className="text-[11px] text-muted-foreground mb-2">{field('meal_quality').summary}</p>
        <div className="space-y-1">
          {MEAL_QUALITY_LEVELS.map(lvl => {
            const selected = draft.meal_quality === String(lvl.value);
            return (
              <button key={lvl.value} type="button"
                onClick={() => set('meal_quality', selected ? '' : String(lvl.value))}
                className={`w-full text-left rounded border px-2.5 py-1.5 transition-colors ${
                  selected ? 'border-primary bg-primary/10' : 'border-border bg-secondary/30 hover:border-muted-foreground/40'
                }`}>
                <span className="text-[11px] font-mono text-muted-foreground mr-2">{lvl.value}</span>
                <span className="text-[11px] font-semibold">{lvl.label}</span>
                <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">{lvl.description}</span>
              </button>
            );
          })}
        </div>
        <Definition def={field('meal_quality')} />
      </div>

      <input type="text" placeholder="notes (optional) — anything unusual about today"
        value={draft.notes} onChange={e => set('notes', e.target.value)}
        className="w-full rounded border border-border bg-secondary px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
    </div>
  );
}
