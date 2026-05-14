'use client';

import { useState, useRef, DragEvent } from 'react';
import { Upload as UploadIcon, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { parseGarminZip } from '@/lib/garmin-parser';

interface Props { onUploadComplete: () => void; }

type State = 'idle' | 'dragging' | 'parsing' | 'inserting' | 'success' | 'error';

const BATCH = 50; // activities per server call

export default function Upload({ onUploadComplete }: Props) {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<{ activities: number; wellness: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setState('error');
      setMessage('Upload a .zip from garmin.com → Account → Data Management → Export Your Data');
      return;
    }

    abortRef.current = false;
    setState('parsing');
    setProgress(0);
    setMessage(`Reading ${(file.size / 1024 / 1024).toFixed(0)} MB file…`);

    try {
      // ── Step 1: parse ZIP in the browser (no server involved) ─────────────
      const buffer = await file.arrayBuffer();
      setProgress(10);
      setMessage('Parsing activities from ZIP…');

      const parsed = await parseGarminZip(buffer);
      const totalActs = parsed.activities.length;
      const totalWell = parsed.wellness.length;

      if (totalActs === 0) {
        setState('error');
        setMessage('No activities found in this ZIP. Make sure it\'s a full Garmin Connect export (not just a single activity).');
        return;
      }

      setProgress(20);
      setMessage(`Found ${totalActs} activities · inserting…`);
      setState('inserting');

      // ── Step 2: init DB tables ─────────────────────────────────────────────
      const initRes = await fetch('/api/init-db', { method: 'POST' });
      if (!initRes.ok) {
        const e = await initRes.json().catch(() => ({}));
        throw new Error(e.error || 'Database initialisation failed — check Neon/Postgres is connected in Vercel Storage');
      }
      setProgress(25);

      // ── Step 3: insert activities in small batches ─────────────────────────
      let insertedActs = 0;
      const actBatches = Math.ceil(totalActs / BATCH);

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
          throw new Error(e.error || `Activity insert failed (batch ${Math.floor(i / BATCH) + 1}/${actBatches})`);
        }
        insertedActs += batch.length;
        // Progress 25 → 75 while inserting activities
        setProgress(25 + Math.round((insertedActs / totalActs) * 50));
        setMessage(`Inserting activities… ${insertedActs}/${totalActs}`);
      }

      // ── Step 4: insert wellness in small batches ───────────────────────────
      let insertedWell = 0;
      const wellBatches = Math.ceil(totalWell / BATCH);

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
          throw new Error(e.error || `Wellness insert failed (batch ${Math.floor(i / BATCH) + 1}/${wellBatches})`);
        }
        insertedWell += batch.length;
        // Progress 75 → 98 while inserting wellness
        setProgress(75 + Math.round((insertedWell / Math.max(totalWell, 1)) * 23));
        setMessage(`Inserting wellness data… ${insertedWell}/${totalWell}`);
      }

      setProgress(100);
      setState('success');
      setStats({ activities: insertedActs, wellness: insertedWell });
      setTimeout(onUploadComplete, 1500);

    } catch (err) {
      setState('error');
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Upload error:', err);
      setMessage(msg);
    }
  }

  const clickable = state === 'idle' || state === 'error' || state === 'dragging';
  const busy = state === 'parsing' || state === 'inserting';

  return (
    <div className="max-w-lg mx-auto space-y-4 pt-8">
      <div className="text-center space-y-1 mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Import Garmin data</h2>
        <p className="text-sm text-muted-foreground">Upload your Garmin Connect export ZIP to begin</p>
        <div className="flex justify-center gap-2 pt-2">
          <Badge variant="run">Running</Badge>
          <Badge variant="cycle">Cycling</Badge>
          <Badge variant="walk">Walking</Badge>
        </div>
      </div>

      <div
        onDrop={e => { e.preventDefault(); setState('idle'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onDragOver={e => { e.preventDefault(); setState('dragging'); }}
        onDragLeave={() => { if (state === 'dragging') setState('idle'); }}
        onClick={() => clickable && fileRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-lg p-10 text-center transition-all',
          state === 'dragging' && 'border-foreground/40 bg-accent/30 cursor-copy',
          state === 'idle' && 'border-border hover:border-border/80 hover:bg-accent/20 cursor-pointer',
          busy && 'border-border bg-accent/10 cursor-wait',
          state === 'success' && 'border-green-500/30 bg-green-500/5 cursor-default',
          state === 'error' && 'border-red-500/30 bg-red-500/5 cursor-pointer',
        )}
      >
        <input ref={fileRef} type="file" accept=".zip" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />

        {(state === 'idle' || state === 'dragging') && (
          <>
            <UploadIcon className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium">Drop Garmin ZIP here</p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse · parsed locally in your browser</p>
          </>
        )}

        {busy && (
          <>
            <div className="w-5 h-5 border border-border border-t-foreground rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium">{message}</p>
            <div className="mt-3 h-1 bg-border rounded-full overflow-hidden max-w-[240px] mx-auto">
              <div
                className="h-full bg-foreground/70 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">{progress}%</p>
          </>
        )}

        {state === 'success' && (
          <>
            <CheckCircle className="w-8 h-8 mx-auto mb-3 text-green-500" />
            <p className="text-sm font-medium text-green-400">Import complete</p>
            {stats && (
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
            )}
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

      <Card>
        <CardContent className="pt-4">
          <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">How to export from Garmin</p>
          <ol className="space-y-2">
            {[
              'Sign in at garmin.com',
              'Account icon → Data Management → Export Your Data',
              'Click Export — Garmin emails you a download link',
              'Download the ZIP and drop it above',
            ].map((s, i) => (
              <li key={i} className="flex gap-2.5 text-xs text-muted-foreground">
                <span className="text-foreground font-mono">{i + 1}.</span>{s}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
