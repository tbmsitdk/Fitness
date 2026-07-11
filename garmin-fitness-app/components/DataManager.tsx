'use client';
import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Trash2, Lock, LockOpen, Pencil, Check, X, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { OutlierProposal } from '@/app/api/data/outliers/route';

// ── Types ────────────────────────────────────────────────────────────────────

interface WellnessRow {
  id: number;
  date: string;
  weight_kg: number | null;
  steps: number | null;
  resting_hr: number | null;
  sleep_hours: number | null;
  sleep_score: number | null;
  body_battery: number | null;
  stress_score: number | null;
  body_fat_pct: number | null;
  hrv_rmssd: number | null;
  locked_fields: string; // JSON array
}

interface ActivityRow {
  id: number;
  date: string;
  activity_type: string;
  distance_km: number;
  duration_seconds: number;
  avg_hr: number | null;
  avg_power: number | null;
  calories: number;
  title?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null) return '—';
  return Number(v).toFixed(decimals);
}

function fmtDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function lockedFields(row: WellnessRow): string[] {
  try { return JSON.parse(row.locked_fields) as string[]; }
  catch { return []; }
}

// Shared mutation helper — returns true on success, alerts on failure so a
// failed write can never silently leave the UI out of sync with the DB.
async function mutate(url: string, init?: RequestInit): Promise<boolean> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (e) {
    alert(`Request failed — nothing was changed. (${e instanceof Error ? e.message : e})`);
    return false;
  }
}

const jsonBody = (body: unknown): RequestInit => ({
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ── Inline cell editor ───────────────────────────────────────────────────────

function EditableCell({
  id, field, value, locked, onSaved,
}: {
  id: number; field: string; value: number | null; locked: boolean;
  onSaved: (field: string, newValue: number | null, newLock: boolean | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  function startEdit() { setDraft(value != null ? String(value) : ''); setEditing(true); setError(false); }

  async function toggleLock() {
    const newLock = !locked;
    const ok = await mutate(`/api/data/wellness/${id}`, jsonBody({ field, value, lock: newLock }));
    if (ok) onSaved(field, value, newLock);
  }

  async function save() {
    setSaving(true);
    const parsed = draft === '' ? null : Number(draft);
    try {
      const res = await fetch(`/api/data/wellness/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Always lock on manual edit — prevents Garmin sync from overwriting
        body: JSON.stringify({ field, value: parsed, lock: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditing(false);
      onSaved(field, parsed, true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-[120px]">
        <input
          autoFocus
          type="number"
          step="any"
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(false); }}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          className={cn(
            'w-20 rounded border bg-secondary px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring',
            error ? 'border-red-500' : 'border-border'
          )}
        />
        <button onClick={save} disabled={saving} className="text-green-400 hover:text-green-300 p-0.5">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
        </button>
        <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground p-0.5">
          <X className="w-3 h-3" />
        </button>
        {error && <span className="text-[10px] text-red-400">Save failed</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group">
      <span
        className={cn('text-xs font-mono cursor-pointer', value == null && 'text-muted-foreground/40')}
        onClick={startEdit}
      >
        {value != null ? Number(value).toFixed(field === 'steps' || field.endsWith('_hr') || field.endsWith('_score') || field === 'body_battery' ? 0 : 1) : '—'}
      </span>
      <button
        onClick={toggleLock}
        title={locked ? 'Locked — click to let Garmin overwrite' : 'Unlocked — click to protect from re-upload'}
        className={cn('p-0.5 shrink-0 transition-colors', locked ? 'text-amber-400' : 'text-muted-foreground/20 opacity-0 group-hover:opacity-100')}
      >
        {locked ? <Lock className="w-2.5 h-2.5" /> : <LockOpen className="w-2.5 h-2.5" />}
      </button>
      <Pencil className="w-2.5 h-2.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer" onClick={startEdit} />
    </div>
  );
}

// ── Wellness table ────────────────────────────────────────────────────────────

function WellnessTable() {
  const [rows, setRows] = useState<WellnessRow[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    const res = await fetch(`/api/data/wellness?page=${p}&t=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    setRows(data.records ?? []);
    setPages(data.pages ?? 1);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, [page]);

  useEffect(() => { load(page); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Optimistic in-place update — no server reload needed, PATCH already saved to DB
  function handleCellSaved(rowId: number, field: string, newValue: number | null, newLock: boolean | undefined) {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const updated = { ...r, [field]: newValue };
      if (newLock === true) {
        const existing = lockedFields(r).filter(f => f !== field);
        updated.locked_fields = JSON.stringify([...existing, field]);
      } else if (newLock === false) {
        updated.locked_fields = JSON.stringify(lockedFields(r).filter(f => f !== field));
      }
      return updated;
    }));
  }

  async function deleteRow(id: number) {
    if (!confirm('Delete this entire wellness record?')) return;
    setDeleting(id);
    const ok = await mutate(`/api/data/wellness/${id}`, { method: 'DELETE' });
    setDeleting(null);
    if (ok) load(page);
  }

  const cols: { key: keyof WellnessRow; label: string }[] = [
    { key: 'weight_kg', label: 'Weight (kg)' },
    { key: 'steps', label: 'Steps' },
    { key: 'resting_hr', label: 'RHR' },
    { key: 'sleep_hours', label: 'Sleep h' },
    { key: 'sleep_score', label: 'Sleep score' },
    { key: 'body_battery', label: 'Battery' },
    { key: 'stress_score', label: 'Stress' },
    { key: 'body_fat_pct', label: 'Body fat %' },
    { key: 'hrv_rmssd', label: 'HRV' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{total.toLocaleString()} wellness records · Click any cell to edit · <Lock className="inline w-2.5 h-2.5 text-amber-400" /> = survives re-upload</p>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
              {cols.map(c => (
                <th key={c.key} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{c.label}</th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length + 2} className="py-8 text-center text-muted-foreground"><Loader2 className="inline w-4 h-4 animate-spin" /></td></tr>
            ) : rows.map(row => {
              const locked = lockedFields(row);
              return (
                <tr key={row.id} className="border-b border-border/40 hover:bg-secondary/20">
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {format(parseISO(row.date.split('T')[0]), 'MMM d, yyyy')}
                  </td>
                  {cols.map(c => (
                    <td key={c.key} className="px-3 py-2">
                      <EditableCell
                        id={row.id}
                        field={c.key}
                        value={row[c.key] as number | null}
                        locked={locked.includes(c.key)}
                        onSaved={(field, val, lock) => handleCellSaved(row.id, field, val, lock)}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <button
                      onClick={() => deleteRow(row.id)}
                      disabled={deleting === row.id}
                      className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                      title="Delete entire row"
                    >
                      {deleting === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 justify-end">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</Button>
          <span className="text-xs text-muted-foreground">Page {page} / {pages}</span>
          <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>→</Button>
        </div>
      )}
    </div>
  );
}

// ── Activities table ──────────────────────────────────────────────────────────

function ActivitiesTable() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;

  useEffect(() => {
    fetch('/api/activities')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: ActivityRow[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  async function deleteActivity(id: number, tombstone: boolean) {
    const msg = tombstone
      ? 'Delete this activity and prevent it from being re-imported on future uploads?'
      : 'Delete this activity? It may reappear on the next data upload.';
    if (!confirm(msg)) return;
    setDeleting(id);
    const ok = await mutate(`/api/data/activities/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tombstone }),
    });
    if (ok) setRows(prev => prev.filter(r => r.id !== id));
    setDeleting(null);
  }

  const paged = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const pages = Math.ceil(rows.length / PER_PAGE);

  const TYPE_COLOR: Record<string, string> = {
    cycling: 'text-green-400', running: 'text-blue-400', walking: 'text-amber-400',
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{rows.length.toLocaleString()} activities · Delete permanently removes; use "Delete + block re-import" to prevent reappearing on next upload</p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Title</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Distance</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Duration</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Avg HR</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Avg Power</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">kcal</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-8 text-center text-muted-foreground"><Loader2 className="inline w-4 h-4 animate-spin" /></td></tr>
            ) : paged.map(row => (
              <tr key={row.id} className="border-b border-border/40 hover:bg-secondary/20">
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                  {format(parseISO(row.date.split('T')[0]), 'MMM d, yyyy')}
                </td>
                <td className={cn('px-3 py-2 font-medium capitalize', TYPE_COLOR[row.activity_type] ?? 'text-foreground')}>
                  {row.activity_type}
                </td>
                <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate">{row.title ?? '—'}</td>
                <td className="px-3 py-2 font-mono">{row.distance_km > 0 ? `${fmt(row.distance_km)} km` : '—'}</td>
                <td className="px-3 py-2 font-mono">{fmtDuration(row.duration_seconds)}</td>
                <td className="px-3 py-2 font-mono">{row.avg_hr != null ? `${row.avg_hr} bpm` : '—'}</td>
                <td className="px-3 py-2 font-mono">{row.avg_power != null ? `${row.avg_power} W` : '—'}</td>
                <td className="px-3 py-2 font-mono">{row.calories > 0 ? row.calories : '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => deleteActivity(row.id, false)}
                      disabled={deleting === row.id}
                      title="Delete (may reappear on re-upload)"
                      className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                    >
                      {deleting === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => deleteActivity(row.id, true)}
                      disabled={deleting === row.id}
                      title="Delete + block re-import"
                      className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 justify-end">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</Button>
          <span className="text-xs text-muted-foreground">Page {page} / {pages}</span>
          <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>→</Button>
        </div>
      )}
    </div>
  );
}

// ── Anomaly detector ──────────────────────────────────────────────────────────

const SEVERITY_STYLE = {
  high: 'border-red-500/30 bg-red-500/10 text-red-400',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  low: 'border-border bg-secondary/30 text-muted-foreground',
};

function AnomalyDetector({ onApplied }: { onApplied: () => void }) {
  const [loading, setLoading] = useState(false);
  const [proposals, setProposals] = useState<OutlierProposal[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState<Set<number>>(new Set());
  const [done, setDone] = useState(false);

  async function detect() {
    setLoading(true);
    setProposals([]);
    setDismissed(new Set());
    setDone(false);
    const res = await fetch('/api/data/outliers', { method: 'POST' });
    const data = await res.json();
    setProposals(data.proposals ?? []);
    setLoading(false);
    setDone(true);
  }

  async function apply(p: OutlierProposal, idx: number) {
    setApplying(prev => new Set(prev).add(idx));
    let ok = false;
    if (p.type === 'wellness_field' && p.field) {
      // lock:true — without it the next Garmin sync would restore the bad value
      ok = await mutate(`/api/data/wellness/${p.id}`, jsonBody({ field: p.field, value: null, lock: true }));
    } else if (p.type === 'wellness_row') {
      ok = await mutate(`/api/data/wellness/${p.id}`, { method: 'DELETE' });
    } else if (p.type === 'activity') {
      ok = await mutate(`/api/data/activities/${p.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tombstone: true }),
      });
    }
    if (ok) {
      setDismissed(prev => new Set(prev).add(idx));
      onApplied();
    }
    setApplying(prev => { const s = new Set(prev); s.delete(idx); return s; });
  }

  const visible = proposals.filter((_, i) => !dismissed.has(i));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">
            Scans the last 180 days of wellness and activity data using AI to identify statistical outliers,
            data entry errors, and implausible values. You review each proposal before anything changes.
          </p>
        </div>
        <Button onClick={detect} disabled={loading} size="sm">
          {loading ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Analysing…</> : <><AlertTriangle className="w-3.5 h-3.5 mr-1.5" />Detect anomalies</>}
        </Button>
      </div>

      {done && proposals.length === 0 && (
        <Card className="border-green-500/30 bg-green-500/10">
          <CardContent className="pt-4 pb-3 text-xs text-green-400">No anomalies detected in the last 180 days — your data looks clean.</CardContent>
        </Card>
      )}

      {visible.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">{visible.length} proposal{visible.length !== 1 ? 's' : ''}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDismissed(new Set(proposals.map((_, i) => i)))}
              className="text-xs"
            >
              Dismiss all
            </Button>
          </div>
          {proposals.map((p, i) => {
            if (dismissed.has(i)) return null;
            return (
              <div key={i} className={cn('rounded-lg border p-3 flex items-start gap-3', SEVERITY_STYLE[p.severity])}>
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium font-mono">{format(parseISO(p.date), 'MMM d, yyyy')}</span>
                    {p.field && <Badge variant="outline" className="text-[10px] py-0">{p.field.replace(/_/g, ' ')}</Badge>}
                    <Badge variant="outline" className={cn('text-[10px] py-0 capitalize', SEVERITY_STYLE[p.severity])}>{p.severity}</Badge>
                  </div>
                  <p className="text-[11px] leading-relaxed">{p.reason}</p>
                  {p.currentValue != null && (
                    <p className="text-[10px] opacity-70">Current value: <span className="font-mono">{String(p.currentValue)}</span></p>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] px-2 border-red-500/50 text-red-400 hover:bg-red-500/10"
                    disabled={applying.has(i)}
                    onClick={() => apply(p, i)}
                  >
                    {applying.has(i) ? <Loader2 className="w-3 h-3 animate-spin" /> : p.type === 'wellness_field' ? 'Clear field' : 'Delete'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px] px-2"
                    onClick={() => setDismissed(prev => new Set(prev).add(i))}
                  >
                    Skip
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type SubTab = 'wellness' | 'activities' | 'anomalies';

export default function DataManager() {
  const [subTab, setSubTab] = useState<SubTab>('wellness');
  const [refreshKey, setRefreshKey] = useState(0);

  const tabs: { id: SubTab; label: string }[] = [
    { id: 'wellness', label: 'Wellness' },
    { id: 'activities', label: 'Activities' },
    { id: 'anomalies', label: 'Anomaly Detector' },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Data Management</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          View, edit, and delete individual data points. Locked fields (<Lock className="inline w-2.5 h-2.5 text-amber-400" />) survive re-uploads.
        </p>
      </div>

      {/* Sub-tab nav */}
      <div className="flex gap-1 border-b border-border/60">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={cn(
              'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
              subTab === t.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4">
          {subTab === 'wellness' && <WellnessTable key={refreshKey} />}
          {subTab === 'activities' && <ActivitiesTable key={refreshKey} />}
          {subTab === 'anomalies' && <AnomalyDetector onApplied={() => setRefreshKey(k => k + 1)} />}
        </CardContent>
      </Card>
    </div>
  );
}
