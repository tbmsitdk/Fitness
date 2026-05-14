'use client';

import { useState, useRef, DragEvent } from 'react';
import { upload } from '@vercel/blob/client';
import { Upload as UploadIcon, CheckCircle, AlertCircle, Activity, Bike, Footprints } from 'lucide-react';
import { clsx } from 'clsx';

interface UploadProps {
  onUploadComplete: () => void;
}

type UploadState = 'idle' | 'dragging' | 'uploading' | 'processing' | 'success' | 'error';

export default function Upload({ onUploadComplete }: UploadProps) {
  const [state, setState] = useState<UploadState>('idle');
  const [message, setMessage] = useState('');
  const [stats, setStats] = useState<{ activities: number; wellness: number } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startFakeProgress(from: number, to: number) {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setUploadProgress(p => {
        if (p >= to) {
          clearInterval(timerRef.current!);
          return to;
        }
        return p + 2;
      });
    }, 300);
    setUploadProgress(from);
  }

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setState('error');
      setMessage('Please upload a .zip file. Export your data from garmin.com → Account → Data Management → Export Your Data.');
      return;
    }

    setState('uploading');
    setUploadProgress(0);
    setMessage('Uploading your Garmin export…');
    startFakeProgress(0, 80);

    try {
      const blob = await upload(
        `garmin-exports/${Date.now()}-${file.name}`,
        file,
        {
          access: 'public',
          handleUploadUrl: '/api/upload',
        }
      );

      if (timerRef.current) clearInterval(timerRef.current);
      setUploadProgress(85);

      setState('processing');
      setMessage('Parsing activities and wellness data…');
      startFakeProgress(85, 98);

      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blobUrl: blob.url }),
      });

      if (timerRef.current) clearInterval(timerRef.current);
      setUploadProgress(100);

      const json = await res.json();
      if (!res.ok) {
        setState('error');
        setMessage(json.error || 'Processing failed');
        return;
      }

      setState('success');
      setStats({ activities: json.activities_imported, wellness: json.wellness_records_imported });
      setMessage('Import complete!');
      setTimeout(onUploadComplete, 1500);
    } catch (err) {
      if (timerRef.current) clearInterval(timerRef.current);
      setState('error');
      const msg = err instanceof Error ? err.message : 'Upload failed';
      if (msg.toLowerCase().includes('blob') || msg.toLowerCase().includes('token')) {
        setMessage('Vercel Blob storage not configured. Please add a Blob store in your Vercel dashboard → Storage tab, then redeploy.');
      } else {
        setMessage(msg);
      }
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setState('idle');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setState('dragging');
  }

  function onDragLeave() {
    if (state === 'dragging') setState('idle');
  }

  const isClickable = state === 'idle' || state === 'error' || state === 'dragging';

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center space-y-3">
        <div className="flex justify-center gap-3 mb-4">
          {[
            { icon: <Activity className="w-5 h-5" />, label: 'Running', color: 'text-garmin-green bg-green-50' },
            { icon: <Bike className="w-5 h-5" />, label: 'Cycling', color: 'text-garmin-blue bg-blue-50' },
            { icon: <Footprints className="w-5 h-5" />, label: 'Walking', color: 'text-garmin-orange bg-orange-50' },
          ].map(s => (
            <div key={s.label} className={clsx('flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', s.color)}>
              {s.icon} {s.label}
            </div>
          ))}
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Upload your Garmin data</h2>
        <p className="text-slate-500 text-sm">Drop your Garmin Connect export ZIP to unlock AI-powered fitness analytics, training load, and longevity insights.</p>
      </div>

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => isClickable && fileRef.current?.click()}
        className={clsx(
          'relative border-2 border-dashed rounded-2xl p-12 text-center transition-all',
          state === 'dragging' && 'border-garmin-blue bg-blue-50 scale-[1.01] cursor-copy',
          state === 'idle' && 'border-slate-200 hover:border-garmin-blue hover:bg-slate-50 cursor-pointer',
          (state === 'uploading' || state === 'processing') && 'border-garmin-blue bg-blue-50 cursor-wait',
          state === 'success' && 'border-garmin-green bg-green-50 cursor-default',
          state === 'error' && 'border-red-300 bg-red-50 cursor-pointer',
        )}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />

        {(state === 'idle' || state === 'dragging') && (
          <>
            <div className="w-16 h-16 bg-garmin-blue/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <UploadIcon className="w-8 h-8 text-garmin-blue" />
            </div>
            <p className="text-lg font-semibold text-slate-700">Drop your Garmin ZIP here</p>
            <p className="text-sm text-slate-400 mt-1">or click to browse · .zip only · up to 500 MB</p>
          </>
        )}

        {(state === 'uploading' || state === 'processing') && (
          <>
            <div className="w-16 h-16 bg-garmin-blue/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <div className="w-8 h-8 border-[3px] border-garmin-blue border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-lg font-semibold text-slate-700">{message}</p>
            <div className="mt-4 bg-slate-200 rounded-full h-2 overflow-hidden max-w-xs mx-auto">
              <div
                className="h-full bg-garmin-blue rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-sm text-slate-400 mt-2">{uploadProgress}%</p>
          </>
        )}

        {state === 'success' && (
          <>
            <div className="w-16 h-16 bg-garmin-green/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-garmin-green" />
            </div>
            <p className="text-lg font-semibold text-garmin-green">{message}</p>
            {stats && (
              <div className="flex justify-center gap-8 mt-4">
                <div className="text-center">
                  <p className="text-3xl font-bold text-slate-900">{stats.activities.toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-0.5">activities</p>
                </div>
                {stats.wellness > 0 && (
                  <div className="text-center">
                    <p className="text-3xl font-bold text-slate-900">{stats.wellness.toLocaleString()}</p>
                    <p className="text-xs text-slate-500 mt-0.5">wellness days</p>
                  </div>
                )}
              </div>
            )}
            <p className="text-sm text-slate-400 mt-4">Loading your dashboard…</p>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <p className="text-base font-semibold text-red-700">{message}</p>
            <p className="text-sm text-slate-400 mt-2">Click to try again</p>
          </>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-900 mb-4">How to export from Garmin Connect</h3>
        <ol className="space-y-3 text-sm text-slate-600">
          {[
            'Go to garmin.com and sign in to your account',
            'Click your account icon → Data Management → Export Your Data',
            'Click Export and wait for the email (can take up to 24 hours)',
            'Download the ZIP attachment and drop it above',
          ].map((step, i) => (
            <li key={i} className="flex gap-3 items-start">
              <span className="flex-shrink-0 w-5 h-5 bg-garmin-blue text-white rounded-full text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
