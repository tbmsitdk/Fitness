'use client';

import { useState } from 'react';

export default function AppleHealthSetupPage() {
  const [secret, setSecret] = useState('');
  const [error, setError]   = useState('');

  function download() {
    const clean = secret.trim();
    if (!clean) {
      setError('Paste your SYNC_SECRET first.');
      return;
    }
    setError('');
    // Trigger the download — works on iPhone Safari too
    window.location.href = `/api/apple-health-shortcut?token=${encodeURIComponent(clean)}`;
  }

  return (
    <div className="min-h-screen flex items-start justify-center p-6 pt-16">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Apple Health auto-sync</h1>
          <p className="text-sm text-muted-foreground">
            Download a one-tap iOS Shortcut that pushes your daily Apple Health data to this app.
          </p>
        </div>

        <div className="rounded-lg border border-border p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Step 1 — Download
          </p>
          <label className="block">
            <span className="text-xs text-muted-foreground">SYNC_SECRET (from your GitHub repo secrets)</span>
            <input
              type="password"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              placeholder="paste here"
              className="mt-1 w-full px-3 py-2 rounded bg-background border border-border
                         focus:border-foreground/40 focus:outline-none font-mono text-sm"
            />
          </label>
          <button
            onClick={download}
            disabled={!secret.trim()}
            className="w-full py-2.5 rounded-lg bg-foreground text-background font-medium
                       disabled:opacity-40 disabled:cursor-not-allowed hover:bg-foreground/90 transition"
          >
            Download apple_health_sync.shortcut
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <p className="text-[11px] text-muted-foreground/70 leading-snug">
            The file embeds your secret so the shortcut can authenticate. Don&apos;t share it.
          </p>
        </div>

        <div className="rounded-lg border border-border p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Step 2 — Install on iPhone
          </p>
          <ol className="space-y-2 text-sm">
            <li className="flex gap-2"><span className="text-foreground font-mono shrink-0">1.</span>
              AirDrop the downloaded file from your Mac to your iPhone, OR open this page directly on your iPhone and tap Download.</li>
            <li className="flex gap-2"><span className="text-foreground font-mono shrink-0">2.</span>
              On the iPhone, tap the file → it opens in the Shortcuts app → tap <strong>Add Shortcut</strong>.</li>
            <li className="flex gap-2"><span className="text-foreground font-mono shrink-0">3.</span>
              The first time it runs, iOS will ask permission to read Health data — tap <strong>Allow All</strong>.</li>
          </ol>
        </div>

        <div className="rounded-lg border border-border p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Step 3 — Run it daily, automatically
          </p>
          <ol className="space-y-2 text-sm">
            <li className="flex gap-2"><span className="text-foreground font-mono shrink-0">1.</span>
              Open the <strong>Shortcuts</strong> app → bottom tab <strong>Automation</strong>.</li>
            <li className="flex gap-2"><span className="text-foreground font-mono shrink-0">2.</span>
              Tap <strong>+</strong> (top right) → <strong>Time of Day</strong>.</li>
            <li className="flex gap-2"><span className="text-foreground font-mono shrink-0">3.</span>
              Pick a time (e.g. <strong>7:00 AM</strong>) → frequency <strong>Daily</strong>.</li>
            <li className="flex gap-2"><span className="text-foreground font-mono shrink-0">4.</span>
              Turn OFF <strong>Ask Before Running</strong> (otherwise it requires a tap each morning).</li>
            <li className="flex gap-2"><span className="text-foreground font-mono shrink-0">5.</span>
              Tap <strong>Next</strong> → action <strong>Run Shortcut</strong> → pick <strong>Sync Apple Health</strong>.</li>
            <li className="flex gap-2"><span className="text-foreground font-mono shrink-0">6.</span>
              Tap <strong>Done</strong>. That&apos;s it — every morning your Apple Health data syncs automatically.</li>
          </ol>
        </div>

        <div className="rounded-lg border border-border/50 p-4 space-y-2 bg-accent/10">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Test it</p>
          <p className="text-sm">
            After installing, go to Shortcuts → My Shortcuts → tap <strong>Sync Apple Health</strong> once.
            You should see a &ldquo;Health Synced&rdquo; notification. The wellness page in this app will show yesterday&apos;s data.
          </p>
        </div>

        <div className="text-[11px] text-muted-foreground/60 text-center pt-4">
          Syncs: steps · resting heart rate · HRV · weight · sleep (yesterday&apos;s data, once per day)
        </div>
      </div>
    </div>
  );
}
