'use client';

import { useState, useRef } from 'react';
import { Upload as UploadIcon, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { parseGarminZip } from '@/lib/garmin-parser';
import { parseAppleHealthZip, isAppleHealthZip } from '@/lib/apple-health-parser';

interface Props { onUploadComplete: () => void; }

type State = 'idle' | 'dragging' | 'parsing' | 'inserting' | 'success' | 'error';
type Source = 'garmin' | 'apple' | null;

const BATCH = 50;

export default function Upload({ onUploadComplete }: Props) {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<{ activities: number; wellness: number; source: Source } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setState('error');
      setMessage('Please upload a .zip file (Garmin Connect export or Apple Health export).');
      return;
    }

    abortRef.current = false;
    setState('parsing');
    setProgress(0);
    setMessage(`Reading ${(file.size / 1024 / 1024).toFixed(0)} MB file…`);

    try {
      const buffer = await file.arrayBuffer();
      setProgress(5);

      // ── Auto-detect source ───────────────────────────────────────────────
      setMessage('Detecting export format…');
      const isApple = await isAppleHealthZip(buffer);
      const source: Source = isApple ? 'apple' : 'garmin';

      setProgress(10);
      setMessage(isApple
        ? 'Apple Health export detected — parsing workouts and health records…'
        : 'Garmin export detected — parsing activities…'
      );

      // ── Parse ────────────────────────────────────────────────────────────
      const parsed = isApple
        ? await parseAppleHealthZip(buffer)
        : await parseGarminZip(buffer);

      const totalActs = parsed.activities.length;
      const totalWell = parsed.wellness.length;

      if (totalActs === 0 && totalWell === 0) {
        setState('error');
        setMessage(isApple
          ? 'No workouts or health records found. Make sure this is a full Apple Health export (Health app → avatar → Export All Health Data).'
          : 'No activities found. Make sure this is a full Garmin Connect export (not a single activity file).'
        );
        return;
      }

      setProgress(20);
      setMessage(`Found ${totalActs} activities · ${totalWell} wellness days — saving to database…`);
      setState('inserting');

      // ── Init DB ──────────────────────────────────────────────────────────
      const initRes = await fetch('/api/init-db', { method: 'POST' });
      if (!initRes.ok) {
        const e = await initRes.json().catch(() => ({}));
        throw new Error(e.error || 'Database initialisation failed — check Vercel Postgres is connected in Storage settings.');
      }
      setProgress(25);

      // ── Insert activities in batches ─────────────────────────────────────
      let insertedActs = 0;
      for (let i = 0; i < totalActs; i += BATCH) {
        if (abortRef.current) throw new Error('Cancelled');
        const batch = parsed.activities.slice(i, i + BATCH);
        const res = await fetch('/api/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activities: batch, wellness: [] }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || `Activity insert failed (batch ${Math.floor(i / BATCH) + 1})`);
        }
        insertedActs += batch.length;
        setProgress(25 + Math.round((insertedActs / Math.max(totalActs, 1)) * 50));
        setMessage(`Inserting activities… ${insertedActs} / ${totalActs}`);
      }

      // ── Insert wellness in batches ───────────────────────────────────────
      let insertedWell = 0;
      for (let i = 0; i < totalWell; i += BATCH) {
        if (abortRef.current) throw new Error('Cancelled');
        const batch = parsed.wellness.slice(i, i + BATCH);
        const res = await fetch('/api/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activities: [], wellness: batch }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || `Wellness insert failed (batch ${Math.floor(i / BATCH) + 1})`);
        }
        insertedWell += batch.length;
        setProgress(75 + Math.round((insertedWell / Math.max(totalWell, 1)) * 23));
        setMessage(`Inserting wellness data… ${insertedWell} / ${totalWell}`);
      }

      setProgress(100);
      setStats({ activities: insertedActs, wellness: insertedWell, source });

      // NOTE: per-second HR/power/cadence backfill is intentionally NOT done
      // from the bulk ZIP export here. We confirmed (via a diagnostic scan of
      // a real export: 352 files, zero .fit files) that Garmin's "Export Your
      // Data" bulk download contains only JSON/DB dumps — no raw .fit activity
      // files at all. That data is only obtainable per-activity via the Garmin
      // Connect API, which is what scripts/garmin_sync.py already does on its
      // own schedule — that's the sole source of per-second sample data.

      setProgress(100);
      setState('success');
      setTimeout(onUploadComplete, 1500);

    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Unknown error');
      console.error('Upload error:', err);
    }
  }

  const clickable = state === 'idle' || state === 'error' || state === 'dragging';
  const busy      = state === 'parsing' || state === 'inserting';

  return (
    <div className="max-w-lg mx-auto space-y-4 pt-8">
      <div className="text-center space-y-1 mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Import fitness data</h2>
        <p className="text-sm text-muted-foreground">Upload a Garmin Connect export or Apple Health export ZIP</p>
        <div className="flex justify-center gap-2 pt-2">
          <Badge variant="run">Running</Badge>
          <Badge variant="cycle">Cycling</Badge>
          <Badge variant="walk">Walking</Badge>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDrop={e => { e.preventDefault(); setState('idle'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onDragOver={e => { e.preventDefault(); setState('dragging'); }}
        onDragLeave={() => { if (state === 'dragging') setState('idle'); }}
        onClick={() => clickable && fileRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-lg p-10 text-center transition-all',
          state === 'dragging'  && 'border-foreground/40 bg-accent/30 cursor-copy',
          state === 'idle'      && 'border-border hover:border-border/80 hover:bg-accent/20 cursor-pointer',
          busy                  && 'border-border bg-accent/10 cursor-wait',
          state === 'success'   && 'border-green-500/30 bg-green-500/5 cursor-default',
          state === 'error'     && 'border-red-500/30 bg-red-500/5 cursor-pointer',
        )}
      >
        <input ref={fileRef} type="file" accept=".zip" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />

        {(state === 'idle' || state === 'dragging') && (
          <>
            <UploadIcon className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium">Drop your export ZIP here</p>
            <p className="text-xs text-muted-foreground mt-1">Garmin Connect or Apple Health · parsed locally in your browser</p>
          </>
        )}

        {busy && (
          <>
            <div className="w-5 h-5 border border-border border-t-foreground rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium">{message}</p>
            <div className="mt-3 h-1 bg-border rounded-full overflow-hidden max-w-[240px] mx-auto">
              <div className="h-full bg-foreground/70 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">{progress}%</p>
          </>
        )}

        {state === 'success' && stats && (
          <>
            <CheckCircle className="w-8 h-8 mx-auto mb-3 text-green-500" />
            <p className="text-sm font-medium text-green-400">
              {stats.source === 'apple' ? 'Apple Health import complete' : 'Garmin import complete'}
            </p>
            <div className="flex justify-center gap-6 mt-3">
              <div className="text-center">
                <p className="text-2xl font-bold">{stats.activities.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">activities</p>
              </div>
              {stats.wellness > 0 && (
                <div className="text-center">
                  <p className="text-2xl font-bold">{stats.wellness.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">wellness days</p>
                </div>
              )}
            </div>
          </>
        )}

        {state === 'error' && (
          <>
            <AlertCircle className="w-8 h-8 mx-auto mb-3 text-red-500" />
            <p className="text-sm font-medium text-red-400">{message}</p>
            <p className="text-xs text-muted-foreground mt-1">Click to try again</p>
          </>
        )}
      </div>

      {/* Instructions for both sources */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Garmin Connect</p>
            <ol className="space-y-1.5">
              {[
                'Sign in at garmin.com',
                'Account → Data Management → Export Your Data',
                'Garmin emails you a download link',
                'Download the ZIP and drop it above',
              ].map((s, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                  <span className="text-foreground font-mono shrink-0">{i + 1}.</span>{s}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Apple Health</p>
            <ol className="space-y-1.5">
              {[
                'Open the Health app on iPhone',
                'Tap your avatar (top right)',
                'Export All Health Data',
                'Share the ZIP to your Mac and drop it above',
              ].map((s, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                  <span className="text-foreground font-mono shrink-0">{i + 1}.</span>{s}
                </li>
              ))}
            </ol>
            <p className="text-[10px] text-muted-foreground/60 mt-2 italic">
              Large exports (5+ years) may take 1–2 min to parse in the browser.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
