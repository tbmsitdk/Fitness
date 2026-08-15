'use client';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2, Check, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  exercisesByCategory, CATEGORY_COLOR, EXERCISE_BY_KEY,
  type ExerciseLog as ExerciseLogRow, type ExerciseDef,
} from '@/lib/exercises';

const today = () => new Date().toISOString().split('T')[0];

// Field key -> what the user types for this exercise's primary metric
function primaryField(def: ExerciseDef): string {
  switch (def.primaryMetric) {
    case 'reps':     return 'reps';
    case 'duration': return 'duration_seconds';
    case 'load':     return 'load_kg';
    case 'airofit':  return 'duration_seconds';
  }
}

function primaryPlaceholder(def: ExerciseDef): string {
  switch (def.primaryMetric) {
    case 'reps':     return 'reps';
    case 'duration': return 'sec';
    case 'load':     return 'kg';
    case 'airofit':  return 'sec';
  }
}

type DraftValues = Record<string, Record<string, string>>; // exercise_key -> field -> value

export default function ExerciseLog() {
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<DraftValues>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allLogs, setAllLogs] = useState<ExerciseLogRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/exercises?days=3650&t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAllLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setAllLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Rebuild the draft whenever the selected date (or the loaded data) changes
  useEffect(() => {
    const forDate = allLogs.filter(l => l.date.slice(0, 10) === date);
    const next: DraftValues = {};
    for (const log of forDate) {
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(log)) {
        if (v != null && k !== 'id' && k !== 'date' && k !== 'exercise_key') fields[k] = String(v);
      }
      next[log.exercise_key] = fields;
    }
    setDraft(next);
  }, [date, allLogs]);

  function setField(key: string, field: string, value: string) {
    setDraft(prev => ({ ...prev, [key]: { ...(prev[key] ?? {}), [field]: value } }));
    setSavedAt(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Send every exercise — blank ones clear that day's row server-side
      const entries = Object.keys(EXERCISE_BY_KEY).map(key => ({
        exercise_key: key,
        ...(draft[key] ?? {}),
      }));
      const res = await fetch('/api/exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, entries }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSavedAt(Date.now());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function clearDay() {
    if (!confirm(`Delete the entire log for ${date}?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/exercises?date=${date}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDraft({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  const loggedToday = Object.values(draft).filter(f =>
    Object.entries(f).some(([k, v]) => k !== 'notes' && v !== '')
  ).length;

  // Dates that already have entries — quick jump list
  const loggedDates = Array.from(new Set(allLogs.map(l => l.date.slice(0, 10)))).sort().reverse();

  return (
    <div className="space-y-4">
      {/* Header: date + actions */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground block">Date</label>
          <input
            type="date"
            value={date}
            max={today()}
            onChange={e => setDate(e.target.value)}
            className="rounded border border-border bg-secondary px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {loggedToday > 0
            ? <><span className="font-semibold text-foreground">{loggedToday}</span> exercise{loggedToday !== 1 ? 's' : ''} logged for this date</>
            : 'Nothing logged for this date yet'}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {savedAt && <span className="text-[11px] text-green-400 flex items-center gap-1"><Check className="w-3 h-3" />Saved</span>}
          <Button size="sm" onClick={save} disabled={saving || loading}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
            Save log
          </Button>
          {loggedToday > 0 && (
            <Button size="sm" variant="ghost" onClick={clearDay} disabled={saving} title="Delete this day's log">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {loading ? (
        <div className="h-32 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-4">
          {exercisesByCategory().map(group => (
            <div key={group.category} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: CATEGORY_COLOR[group.category] }} />
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</p>
              </div>
              <div className="rounded-md border border-border divide-y divide-border/40">
                {group.exercises.map(def => {
                  const vals = draft[def.key] ?? {};
                  const pField = primaryField(def);
                  const filled = Object.entries(vals).some(([k, v]) => k !== 'notes' && v !== '');
                  return (
                    <div key={def.key} className={cn('flex items-center gap-2 px-3 py-2 flex-wrap', filled && 'bg-secondary/30')}>
                      <div className="min-w-[190px] flex-1">
                        <p className="text-xs font-medium">{def.label}</p>
                        {def.hint && <p className="text-[10px] text-muted-foreground">{def.hint}</p>}
                      </div>

                      {/* Sets — not meaningful for a single dynamometer reading */}
                      {def.primaryMetric !== 'load' && def.primaryMetric !== 'airofit' && (
                        <input
                          type="number" min="0" step="1" placeholder="sets"
                          value={vals.sets ?? ''}
                          onChange={e => setField(def.key, 'sets', e.target.value)}
                          className="w-16 rounded border border-border bg-secondary px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      )}

                      <input
                        type="number" min="0" step={def.primaryMetric === 'load' ? '0.1' : '1'}
                        placeholder={primaryPlaceholder(def)}
                        value={vals[pField] ?? ''}
                        onChange={e => setField(def.key, pField, e.target.value)}
                        className="w-20 rounded border border-border bg-secondary px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                      />

                      {/* Airofit's own device readings */}
                      {def.primaryMetric === 'airofit' && (
                        <>
                          <input type="number" min="0" step="0.1" placeholder="vital cap. (L)"
                            value={vals.vital_capacity_l ?? ''}
                            onChange={e => setField(def.key, 'vital_capacity_l', e.target.value)}
                            className="w-28 rounded border border-border bg-secondary px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
                          <input type="number" min="0" step="0.1" placeholder="insp. strength"
                            value={vals.inspiratory_strength ?? ''}
                            onChange={e => setField(def.key, 'inspiratory_strength', e.target.value)}
                            className="w-28 rounded border border-border bg-secondary px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
                          <input type="number" min="0" step="0.1" placeholder="exp. strength"
                            value={vals.expiratory_strength ?? ''}
                            onChange={e => setField(def.key, 'expiratory_strength', e.target.value)}
                            className="w-28 rounded border border-border bg-secondary px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
                        </>
                      )}

                      <input
                        type="text" placeholder="notes"
                        value={vals.notes ?? ''}
                        onChange={e => setField(def.key, 'notes', e.target.value)}
                        className="flex-1 min-w-[100px] rounded border border-border bg-secondary px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 italic">
        Leave an exercise blank to skip it — clearing a previously-saved value removes it from that day.
        Sets multiply reps/hold-time for the totals; grip strength records your peak dynamometer reading.
      </p>

      {/* Recently logged days */}
      {loggedDates.length > 0 && (
        <div className="pt-3 border-t border-border/60 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Recent logs</p>
          <div className="flex flex-wrap gap-1.5">
            {loggedDates.slice(0, 21).map(d => {
              const count = allLogs.filter(l => l.date.slice(0, 10) === d).length;
              return (
                <button
                  key={d}
                  onClick={() => setDate(d)}
                  className={cn(
                    'px-2 py-1 rounded border text-[11px] font-mono transition-colors',
                    d === date ? 'border-foreground bg-secondary' : 'border-border text-muted-foreground hover:border-foreground/40'
                  )}
                >
                  {format(parseISO(d), 'd MMM')} · {count}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
