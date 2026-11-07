'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Check, Loader2, Plus, Trash2, Plane } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDataVersion, useRefreshAfter } from '@/lib/data-refresh';
import {
  DESTINATION_ZONES, TRAVEL_MODES, TRAVEL_PURPOSES, zonesCrossed, shiftDirection,
  expectedAdaptationDays, describeTrip, utcOffsetOn, tripStops, totalZonesCrossed, type TravelLog as Trip,
} from '@/lib/travel';
import { loadSettings, DEFAULT_SETTINGS } from '@/lib/settings';

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

interface DraftStop {
  destination: string;
  timezone: string;
  arrive_date: string;
}

interface Draft {
  id?: number;
  depart_date: string;
  return_date: string;
  /** Ordered stops. One entry is an ordinary out-and-back trip. */
  stops: DraftStop[];
  travel_mode: string;
  purpose: string;
  notes: string;
}

/**
 * A fresh trip, with the home side resolved from the Home Base setting FOR THE
 * DEPARTURE DATE — so a July trip from Copenhagen starts at +2 (CEST) and a
 * January one at +1, rather than both at a hardcoded number.
 */
const emptyDraft = (homeZone: string, on = todayStr()): Draft => ({
  depart_date: on,
  return_date: '',
  stops: [{ destination: '', timezone: '', arrive_date: on }],
  travel_mode: 'flight',
  purpose: '',
  notes: '',
});

/** Local-date arithmetic for defaulting a new stop's arrival. */
function addDaysStr(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const inputCls =
  'rounded border border-border bg-secondary px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring';

export default function TravelLog() {
  // Settings live in localStorage, so read after mount to keep server and
  // client markup identical.
  const [homeZone, setHomeZone] = useState(DEFAULT_SETTINGS.homeTimezone);
  useEffect(() => { setHomeZone(loadSettings().homeTimezone ?? DEFAULT_SETTINGS.homeTimezone); }, []);

  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(DEFAULT_SETTINGS.homeTimezone));
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
      // Most trips reach the first stop the day they leave; keep them in step
      // until the user says otherwise, rather than asking for the same date
      // twice. Later stops are never touched — they have their own dates.
      if (k === 'depart_date' && d.stops[0]?.arrive_date === d.depart_date) {
        next.stops = d.stops.map((st, i) => (i === 0 ? { ...st, arrive_date: v as string } : st));
      }
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
          // First stop fills the legacy single-destination columns, which are
          // NOT NULL and are what older readers fall back to.
          destination: draft.stops[0]?.destination ?? '',
          depart_date: draft.depart_date,
          arrive_date: draft.stops[0]?.arrive_date || draft.depart_date,
          return_date: draft.return_date || null,
          home_utc_offset: utcOffsetOn(homeZone, draft.depart_date) ?? 1,
          dest_utc_offset: utcOffsetOn(draft.stops[0]?.timezone ?? '', draft.stops[0]?.arrive_date ?? draft.depart_date) ?? 0,
          home_timezone: homeZone,
          dest_timezone: draft.stops[0]?.timezone ?? '',
          stops: draft.stops.filter(st => st.destination.trim() && st.timezone && st.arrive_date),
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
      setDraft(emptyDraft(homeZone));
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed — not stored');
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, load, homeZone]);

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
  /** Every hop in the itinerary, including the flight home. */
  const preview = useMemo(() => {
    const valid = draft.stops.filter(st => st.timezone && st.arrive_date);
    if (valid.length === 0) return null;
    const home = utcOffsetOn(homeZone, draft.depart_date);
    if (home == null) return null;

    const hops: { label: string; date: string; zones: number; days: number }[] = [];
    let current = home;
    for (const st of valid) {
      const to = utcOffsetOn(st.timezone, st.arrive_date);
      if (to == null) continue;
      const z = zonesCrossed(current, to);
      hops.push({ label: st.destination || st.timezone.split('/').pop()!.replace(/_/g, ' '),
                  date: st.arrive_date, zones: z, days: expectedAdaptationDays(z) });
      current = to;
    }
    if (draft.return_date) {
      const z = zonesCrossed(current, home);
      hops.push({ label: 'Home', date: draft.return_date, zones: z, days: expectedAdaptationDays(z) });
    }
    const total = hops.reduce((sum, h) => sum + Math.abs(h.zones), 0);
    return { hops, total };
  }, [draft.stops, draft.depart_date, draft.return_date, homeZone]);

  const canSave = draft.depart_date !== ''
    && draft.stops.some(st => st.destination.trim() !== '' && st.timezone !== '' && st.arrive_date !== '');

  const setStop = (i: number, patch: Partial<DraftStop>) =>
    setDraft(d => ({ ...d, stops: d.stops.map((st, j) => (j === i ? { ...st, ...patch } : st)) }));
  const addStop = () => setDraft(d => ({
    ...d,
    // Default the new stop to the day after the previous arrival — the common
    // case is a short hop, and a date earlier than the previous stop would
    // produce a negative-length stay.
    stops: [...d.stops, { destination: '', timezone: '',
      arrive_date: addDaysStr(d.stops[d.stops.length - 1]?.arrive_date || d.depart_date, 1) }],
  }));
  const removeStop = (i: number) =>
    setDraft(d => ({ ...d, stops: d.stops.length > 1 ? d.stops.filter((_, j) => j !== i) : d.stops }));

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

        <p className="text-[10px] text-muted-foreground">
          Home base: <span className="font-mono text-foreground">{homeZone.replace(/_/g, ' ')}</span>
          {' '}— change it in Settings. Both timezones are resolved on the arrival date, so summer
          time is handled per zone: Copenhagen and Frankfurt read as the same zone all year, while a
          trip to New York shifts by an hour in the weeks when only one side has changed over.
        </p>

        {/* Stops, in order. Each is its own circadian shift. */}
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Stops <span className="normal-case">— add one per place you slept, in order</span>
          </label>
          {draft.stops.map((st, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1.2fr_2fr_1fr_auto] gap-2 items-end">
              <div>
                {i === 0 && <span className="text-[10px] text-muted-foreground/60">Destination</span>}
                <input type="text" placeholder={i === 0 ? 'e.g. Delhi' : 'e.g. Singapore'}
                  value={st.destination} onChange={e => setStop(i, { destination: e.target.value })}
                  className={`${inputCls} w-full`} />
              </div>
              <div>
                {i === 0 && <span className="text-[10px] text-muted-foreground/60">Timezone</span>}
                <select value={st.timezone} onChange={e => setStop(i, { timezone: e.target.value })}
                  className={`${inputCls} w-full`}>
                  <option value="">Select…</option>
                  {DESTINATION_ZONES.map(t => (
                    <option key={t.zone} value={t.zone}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                {i === 0 && <span className="text-[10px] text-muted-foreground/60">Arrived</span>}
                <input type="date" value={st.arrive_date} max={todayStr()}
                  onChange={e => setStop(i, { arrive_date: e.target.value })}
                  className={`${inputCls} w-full font-mono`} />
              </div>
              <button type="button" onClick={() => removeStop(i)} disabled={draft.stops.length === 1}
                title={draft.stops.length === 1 ? 'A trip needs at least one stop' : 'Remove this stop'}
                className="px-2 py-1.5 text-muted-foreground hover:text-red-400 disabled:opacity-30 disabled:hover:text-muted-foreground">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={addStop} className="text-[11px]">
            <Plus className="w-3 h-3 mr-1" />Add stop
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Departed home</label>
            <input type="date" value={draft.depart_date} max={todayStr()}
              onChange={e => set('depart_date', e.target.value)} className={`${inputCls} w-full mt-0.5 font-mono`} />
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

        {preview && preview.hops.length > 0 && (
          <div className="rounded border border-border bg-secondary/40 px-2.5 py-2 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Body-clock shifts on this itinerary
            </p>
            {preview.hops.map((h, i) => {
              const dir = h.zones > 0 ? 'east' : h.zones < 0 ? 'west' : 'none';
              return (
                <p key={i} className="text-[11px] text-muted-foreground">
                  <span className="font-mono text-foreground/70">{h.date}</span>{' '}
                  → <span className="text-foreground">{h.label}</span>{' · '}
                  {dir === 'none' ? (
                    <span>no timezone change — travel strain only</span>
                  ) : (
                    <>
                      <span className="font-mono text-foreground">
                        {Math.abs(h.zones)} zone{Math.abs(h.zones) === 1 ? '' : 's'} {dir}
                      </span>
                      {' · '}~{h.days}d to adapt
                      {dir === 'east' ? ' (advancing the clock, the harder way)' : ''}
                    </>
                  )}
                </p>
              );
            })}
            <p className="text-[11px] text-muted-foreground/70 pt-0.5">
              {preview.total} zone{preview.total === 1 ? '' : 's'} crossed in total across{' '}
              {preview.hops.length} shift{preview.hops.length === 1 ? '' : 's'}.
              {!draft.return_date && ' Add a return date to include the flight home.'}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" onClick={() => save()} disabled={saving || !canSave}
            title={canSave ? 'Save trip' : 'A departure date and at least one complete stop are required'}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
            {draft.id ? 'Update trip' : 'Add trip'}
          </Button>
          {draft.id && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(emptyDraft(homeZone))}>Cancel</Button>
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
                const stops = tripStops(t);
                const total = totalZonesCrossed(t);
                return (
                  <tr key={t.id} className="border-t border-border/50">
                    <td className="px-2 py-1.5 text-[11px]">
                      {stops.map(st => st.destination).join(' → ')}
                      {!t.return_date && <span className="ml-1.5 text-[10px] text-amber-400">still away</span>}
                    </td>
                    <td className="px-2 py-1.5 text-[11px] text-muted-foreground font-mono whitespace-nowrap">
                      {t.depart_date} → {t.return_date ?? '…'}
                    </td>
                    <td className="px-2 py-1.5 text-[11px] font-mono text-right whitespace-nowrap">
                      {/* Total across every hop — a Delhi/Singapore trip crosses
                          far more than the single out-and-back figure implied. */}
                      {total === 0 ? <span className="text-muted-foreground">same zone</span>
                        : <span className="text-foreground">
                            {total} zone{total === 1 ? '' : 's'}
                            {stops.length > 1 && (
                              <span className="text-muted-foreground"> · {stops.length} stops</span>
                            )}
                          </span>}
                    </td>
                    <td className="px-2 py-1.5 text-[11px] text-muted-foreground">{t.purpose ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button onClick={() => setDraft({
                        id: t.id,
                        depart_date: t.depart_date,
                        return_date: t.return_date ?? '',
                        // tripStops rebuilds a single stop from the legacy
                        // columns for trips saved before multi-stop support,
                        // so editing an old trip works without migration.
                        stops: tripStops(t).map(st => ({
                          destination: st.destination,
                          timezone: st.timezone,
                          arrive_date: st.arrive_date,
                        })),
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
