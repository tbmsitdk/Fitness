'use client';

import { useState, useEffect, useRef } from 'react';

type Status = 'idle' | 'submitting' | 'submitted' | 'error';

export default function GarminSetupPage() {
  const [code, setCode]       = useState('');
  const [status, setStatus]   = useState<Status>('idle');
  const [error, setError]     = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus the input on mount (and select existing text on re-mount)
  useEffect(() => { inputRef.current?.focus(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'submitting') return;
    const clean = code.trim().replace(/\s+/g, '');
    if (!/^\d{4,8}$/.test(clean)) {
      setError('That doesn\'t look like an SMS code — should be 4–8 digits.');
      return;
    }
    setStatus('submitting'); setError('');
    try {
      const r = await fetch('/api/garmin-mfa-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: clean }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setStatus('submitted');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Garmin SMS code</h1>
          <p className="text-sm text-muted-foreground">
            Paste the 6-digit code from your SMS so the token-refresh workflow can complete.
          </p>
        </div>

        {status !== 'submitted' && (
          <form onSubmit={submit} className="space-y-3">
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{4,8}"
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value)}
              disabled={status === 'submitting'}
              className="w-full text-center text-2xl tracking-[0.4em] py-4 rounded-lg
                         bg-background border border-border focus:border-foreground/40
                         focus:outline-none disabled:opacity-50 font-mono"
            />
            <button
              type="submit"
              disabled={status === 'submitting' || code.length < 4}
              className="w-full py-3 rounded-lg bg-foreground text-background
                         font-medium disabled:opacity-40 disabled:cursor-not-allowed
                         hover:bg-foreground/90 transition"
            >
              {status === 'submitting' ? 'Sending…' : 'Submit code'}
            </button>
            {error && (
              <p className="text-sm text-red-400 text-center">{error}</p>
            )}
          </form>
        )}

        {status === 'submitted' && (
          <div className="space-y-3 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-base font-medium">Code submitted</h2>
            <p className="text-sm text-muted-foreground">
              The GitHub Actions workflow should pick it up within a few seconds and
              finish the login. Refresh the workflow run page to see the new token.
            </p>
            <button
              onClick={() => { setStatus('idle'); setCode(''); }}
              className="text-xs text-muted-foreground underline"
            >
              Submit a different code
            </button>
          </div>
        )}

        <div className="text-xs text-muted-foreground/70 text-center pt-4 border-t border-border/50">
          <p>
            Don&apos;t share this URL — anyone with it can submit codes during a token refresh.
          </p>
        </div>
      </div>
    </div>
  );
}
