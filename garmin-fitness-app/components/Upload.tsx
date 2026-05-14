'use client';

import { useState, useRef, DragEvent } from 'react';
import { upload } from '@vercel/blob/client';
import { Upload as UploadIcon, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Props { onUploadComplete: () => void; }

type State = 'idle' | 'dragging' | 'uploading' | 'processing' | 'success' | 'error';

export default function Upload({ onUploadComplete }: Props) {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');
  const [stats, setStats] = useState<{ activities: number; wellness: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function fakeProgress(from: number, to: number) {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(from);
    timerRef.current = setInterval(() => {
      setProgress(p => { if (p >= to) { clearInterval(timerRef.current!); return to; } return p + 2; });
    }, 250);
  }

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setState('error');
      setMessage('Upload a .zip from garmin.com → Account → Data Management → Export Your Data');
      return;
    }
    setState('uploading'); fakeProgress(0, 80);
    setMessage('Uploading…');
    try {
      const blob = await upload(`garmin-exports/${Date.now()}-${file.name}`, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
      });
      clearInterval(timerRef.current!); setProgress(85);
      setState('processing'); fakeProgress(85, 98);
      setMessage('Parsing activities…');
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blobUrl: blob.url }),
      });
      clearInterval(timerRef.current!); setProgress(100);
      const json = await res.json();
      if (!res.ok) { setState('error'); setMessage(json.error || 'Processing failed'); return; }
      setState('success');
      setStats({ activities: json.activities_imported, wellness: json.wellness_records_imported });
      setTimeout(onUploadComplete, 1400);
    } catch (err) {
      clearInterval(timerRef.current!);
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setState('error');
      setMessage(msg.toLowerCase().includes('blob') || msg.toLowerCase().includes('token')
        ? 'Vercel Blob not configured — add a Blob store in your Vercel dashboard → Storage.'
        : msg);
    }
  }

  const clickable = state === 'idle' || state === 'error' || state === 'dragging';

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

      {/* Drop zone */}
      <div
        onDrop={e => { e.preventDefault(); setState('idle'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onDragOver={e => { e.preventDefault(); setState('dragging'); }}
        onDragLeave={() => { if (state === 'dragging') setState('idle'); }}
        onClick={() => clickable && fileRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-lg p-10 text-center transition-all cursor-pointer',
          state === 'dragging' && 'border-foreground/40 bg-accent/30',
          state === 'idle' && 'border-border hover:border-border/80 hover:bg-accent/20',
          (state === 'uploading' || state === 'processing') && 'border-border bg-accent/10 cursor-wait',
          state === 'success' && 'border-green-500/30 bg-green-500/5 cursor-default',
          state === 'error' && 'border-red-500/30 bg-red-500/5',
        )}
      >
        <input ref={fileRef} type="file" accept=".zip" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />

        {(state === 'idle' || state === 'dragging') && (
          <>
            <UploadIcon className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium">Drop Garmin ZIP here</p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse · up to 500 MB</p>
          </>
        )}
        {(state === 'uploading' || state === 'processing') && (
          <>
            <div className="w-5 h-5 border border-border border-t-foreground rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium">{message}</p>
            <div className="mt-3 h-0.5 bg-border rounded-full overflow-hidden max-w-[200px] mx-auto">
              <div className="h-full bg-foreground/70 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
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
                <div className="text-center"><p className="text-2xl font-bold">{stats.activities.toLocaleString()}</p><p className="text-xs text-muted-foreground">activities</p></div>
                {stats.wellness > 0 && <div className="text-center"><p className="text-2xl font-bold">{stats.wellness.toLocaleString()}</p><p className="text-xs text-muted-foreground">wellness days</p></div>}
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
