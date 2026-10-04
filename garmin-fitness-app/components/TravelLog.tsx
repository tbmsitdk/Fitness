'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Check, Loader2, Plus, Trash2, Plane } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDataVersion, useRefreshAfter } from '@/lib/data-refresh';
import {
  TIMEZONE_PRESETS, TRAVEL_MODES, TRAVEL_PURPOSES, zonesCrossed, shiftDirection,
  expectedAdaptationDays, describeTrip, type TravelLog as Trip,
} from '@/lib/travel';

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

interface Draft {
  id?: number;
  destination: string;
  depart_date: string;
  arrive_date: string;
  return_date: string;
  home_utc_offset: string;
  dest_utc_offset: string;
  travel_mode: string;
  purpose: string;
  notes: string;
}

const emptyDraft = (): Draft => ({
  destination: '',
  depart_date: todayStr(),
  arrive_date: todayStr(),
  return_date: '',
  home_utc_offset: '1',          // Copenhagen standard time
  dest_utc_offset: '',
  travel_mode: 'flight',
  purpose: '',
  notes: '',
});

const inputCls =
  'rounded border border-border bg-secondary px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring';

export default function TravelLog() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataVersion = useDataVersion();

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/travel?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setTrips(Array.isArray(d.trips) ? d.trips : []);
    } catch {
      setTrips([]);
      setError('Could not load trips');
    }
  }, []);

  useEffect(() => { load(); }, [load, dataVersion]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft(d => {
      const next = { ...d, [k]: v };
      // Most trips arrive the day they depart; keep them in step until the user
      // says otherwise, rather than making them fill the same date twice.
      if (k === 'depart_date' && d.arrive_date === d.depart_date) next.arrive_date = v as string;
      return next;
    });
    setSaved(false);
  };

  const doSave = useCallback(async (): Promise<boolean> => {
    setSaving(true); setError(null);
    try {
      const r = await fetch('/api/travel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draft.id,
          destination: draft.destination,
          depart_date: draft.depart_date,
          arrive_date: draft.arrive_date || draft.depart_date,
          return_date: draft.return_date || null,
          home_utc_offset: Number(draft.home_utc_offset),
          dest_utc_offset: Number(draft.dest_utc_offset),
          travel_mode: draft.travel_mode || null,
          purpose: draft.purpose || null,
          notes: draft.notes,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      setSaved(true);
      setDraft(emptyDraft());
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed — not stored');
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, load]);

  const save = useRefreshAfter(doSave);

  const doDelete = useCallback(async (id: number): Promise<boolean> => {
    try {
      const r = await fetch(`/api/travel?id=${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      await load();
      return true;
    } catch {
      setError('Delete failed');
      return false;
    }
  }, [load]);

  const remove = useRefreshAfter(doDelete);

  // Live preview of the circadian consequence, so the offsets can be sanity
  // checked before saving rather than discovered as a wrong chart later.
  const preview = useMemo(() => {
    const home = Number(draft.home_utc_offset);
    const dest = Number(draft.dest_utc_offset);
    if (!Number.isFinite(home) || !Number.isFinite(dest) || draft.dest_utc_offset === '') return null;
    const z = zonesCrossed(home, dest);
    return { zones: z, direction: shiftDirection(z), days: expectedAdaptationDays(z) };
  }, [draft.home_utc_offset, draft.dest_utc_offset]);

  const canSave = draft.destination.trim() !== '' && draft.depart_date !== '' && draft.dest_utc_offset !== '';

  const tzSelect = (k: 'home_utc_offset' | 'dest_utc_offset') => (
    <select value={draft[k]} onChange={e => set(k, e.target.value)} className={`${inputCls} w-full`}>
      <option value="">Select…</option>
      {TIMEZONE_PRESETS.map(t => (
        <option key={`${t.label}-${t.offset}`} value={String(t.offset)}>
          UTC{t.offset >= 0 ? '+' : ''}{t.offset} · {t.label}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground border-l-2 border-border pl-2.5 leading-relaxed">
        Log one row per trip — the days away and the body-clock adaptation window are worked out
        from these fields, so there is nothing to enter daily. Only trips that change your timezone
        produce a circadian effect, but logging a same-zone trip is still useful: it separates
        travel strain from jet lag.
      </p>

      {/* ── New trip ─────────────────────────────────────────────────────── */}
      <div className="rounded-md border border-border bg-card p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Plane className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">{draft.id ? 'Edit trip' : 'New trip'}</span>
          {saved && <span className="text-[11px] text-green-400 flex items-center gap-1"><Check className="w-3 h-3" />Saved</span>}
          {error && <span className="text-[11px] text-red-400">{error}</span>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Destination</label>
            <input type="text" placeholder="e.g. Tokyo" value={draft.destination}
              onChange={e => set('destination', e.target.value)} className={`${inputCls} w-full mt-0.5`} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Home timezone</label>
            <div className="mt-0.5">{tzSelect('home_utc_offset')}</div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Destination timezone</label>
            <div className="mt-0.5">{tzSelect('dest_utc_offset')}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Departed home</label>
            <input type="date" value={draft.depart_date} max={todayStr()}
              onChange={e => set('depart_date', e.target.value)} className={`${inputCls} w-full mt-0.5 font-mono`} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Arrived there</label>
            <input type="date" value={draft.arrive_date} max={todayStr()}
              onChange={e => set('arrive_date', e.target.value)} className={`${inputCls} w-full mt-0.5 font-mono`} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Home again <span className="normal-case">(blank if still away)</span>
            </label>
            <input type="date" value={draft.return_date} max={todayStr()}
              onChange={e => set('return_date', e.target.value)} className={`${inputCls} w-full mt-0.5 font-mono`} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Mode</label>
            <select value={draft.travel_mode} onChange={e => set('travel_mode', e.target.value)}
              className={`${inputCls} w-full mt-0.5`}>
              {TRAVEL_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Purpose</label>
            <select value={draft.purpose} onChange={e => set('purpose', e.target.value)}
              className={`${inputCls} w-full mt-0.5`}>
              <option value="">—</option>
              {TRAVEL_PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Notes</label>
            <input type="text" placeholder="optional" value={draft.notes}
              onChange={e => set('notes', e.target.value)} className={`${inputCls} w-full mt-0.5`} />
          </div>
        </div>

        {preview && (
          <div className="rounded border border-border bg-secondary/40 px-2.5 py-2">
            {preview.direction === 'none' ? (
              <p className="text-[11px] text-muted-foreground">
                No timezone change — travel strain only, no body-clock shift. Still worth logging.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                <span className="font-mono text-foreground">
                  {Math.abs(preview.zones)} zone{Math.abs(preview.zones) === 1 ? '' : 's'} {preview.direction}
                </span>
                {' · '}typically ~{preview.days} day{preview.days === 1 ? '' : 's'} to adapt
                {preview.direction === 'east'
                  ? ' — eastward advances the clock, the harder direction.'
                  : ' — westward delays the clock, which the body tolerates better.'}
                {' '}You will shift back the other way on the return.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" onClick={() => save()} disabled={saving || !canSave}
            title={canSave ? 'Save trip' : 'Destination, departure date and destination timezone are required'}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
            {draft.id ? 'Update trip' : 'Add trip'}
          </Button>
          {draft.id && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(emptyDraft())}>Cancel</Button>
          )}
        </div>
      </div>

      {/* ── Logged trips ─────────────────────────────────────────────────── */}
      {trips == null ? (
        <div className="h-20 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
      ) : trips.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-4">
          No trips logged yet. Add past trips too — the analysis works on history you already have
          recovery data for, so backfilling gives you an answer immediately.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1 text-left font-medium">Trip</th>
                <th className="px-2 py-1 text-left font-medium">Dates</th>
                <th className="px-2 py-1 text-right font-medium">Shift</th>
                <th className="px-2 py-1 text-left font-medium">Purpose</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {trips.map(t => {
                const z = zonesCrossed(t.home_utc_offset, t.dest_utc_offset);
                const dir = shiftDirection(z);
                return (
                  <tr key={t.id} className="border-t border-border/50">
                    <td className="px-2 py-1.5 text-[11px]">
                      {t.destination}
                      {!t.return_date && <span className="ml-1.5 text-[10px] text-amber-400">still away</span>}
                    </td>
                    <td className="px-2 py-1.5 text-[11px] text-muted-foreground font-mono whitespace-nowrap">
                      {t.depart_date} → {t.return_date ?? '…'}
                    </td>
                    <td className="px-2 py-1.5 text-[11px] font-mono text-right whitespace-nowrap">
                      {dir === 'none' ? <span className="text-muted-foreground">same zone</span>
                        : <span className={dir === 'east' ? 'text-amber-400' : 'text-blue-400'}>
                            {Math.abs(z)} {dir}
                          </span>}
                    </td>
                    <td className="px-2 py-1.5 text-[11px] text-muted-foreground">{t.purpose ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button onClick={() => setDraft({
                        id: t.id,
                        destination: t.destination,
                        depart_date: t.depart_date,
                        arrive_date: t.arrive_date,
                        return_date: t.return_date ?? '',
                        home_utc_offset: String(t.home_utc_offset),
                        dest_utc_offset: String(t.dest_utc_offset),
                        travel_mode: t.travel_mode ?? 'flight',
                        purpose: t.purpose ?? '',
                        notes: t.notes ?? '',
                      })} className="text-[10px] text-muted-foreground hover:text-foreground mr-2">edit</button>
                      <button onClick={() => t.id && remove(t.id)}
                        className="text-muted-foreground hover:text-red-400" title={`Delete ${describeTrip(t, todayStr())}`}>
                        <Trash2 className="w-3 h-3 inline" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
