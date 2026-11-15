'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, Loader2, RefreshCw, Sunrise } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useDataVersion } from '@/lib/data-refresh';
import type { StoredBrief } from '@/lib/daily-brief';

/** The morning brief and the early-warning check, written after each Garmin sync. */
export default function MorningBrief() {
  const dataVersion = useDataVersion();
  const [brief, setBrief] = useState<StoredBrief | null>(null);
  const [today, setToday] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/daily-brief');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setBrief(json.brief ?? null); setToday(json.today ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoaded(true); }
  }, []);

  useEffect(() => { load(); }, [load, dataVersion]);

  async function generate(force: boolean) {
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/daily-brief${force ? '?force=1' : ''}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setBrief(json.brief ?? null); setToday(json.today ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (!loaded) return null;

  const isToday = brief?.date === today;
  const level = brief?.warning.level ?? 'none';
  const border = level === 'warning' ? 'border-red-500/30 bg-red-500/5' : level === 'watch' ? 'border-amber-500/30 bg-amber-500/5' : '';

  return (
    <Card className={cn(border)}>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Sunrise className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm font-medium">Morning brief</span>
            {brief && <span className="text-[11px] text-muted-foreground truncate">{isToday ? 'today' : `from ${brief.date}`}</span>}
            {level === 'warning' && <Badge variant="outline" className="border-red-500/30 text-red-400"><AlertTriangle className="w-3 h-3 mr-1" />Early warning</Badge>}
            {level === 'watch' && <Badge variant="outline" className="border-amber-500/30 text-amber-400"><Eye className="w-3 h-3 mr-1" />Keep an eye on it</Badge>}
          </div>
          <button onClick={() => generate(Boolean(brief && isToday))} disabled={busy}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-secondary flex-shrink-0">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {busy ? 'Writing…' : brief && isToday ? 'Rewrite' : "Write today's"}
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {!brief && !error && (
          <p className="text-xs text-muted-foreground">No brief yet. One is written after each Garmin sync; you can also write today&apos;s now.</p>
        )}

        {brief && (
          <div className="space-y-2">
            <p className="text-sm">{brief.brief.headline}</p>
            <p className="text-xs text-muted-foreground">{brief.brief.recovery}</p>
            <p className="text-xs"><span className="font-medium">Today: </span><span className="text-muted-foreground">{brief.brief.today}</span></p>
            {brief.brief.watch && <p className="text-xs"><span className="font-medium">Watch: </span><span className="text-muted-foreground">{brief.brief.watch}</span></p>}
            {brief.brief.steps && <p className="text-xs"><span className="font-medium">Steps: </span><span className="text-muted-foreground">{brief.brief.steps}</span></p>}

            {brief.warning.signals.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {brief.warning.signals.map(s => (
                  <Badge key={s.key} variant="outline" title={`${s.daysOff} of the last ${s.recentReadings} readings were off`}>
                    {s.label} {s.latest}{s.unit} · usual {s.baseline}{s.unit}
                  </Badge>
                ))}
              </div>
            )}
            {brief.warning.explanations.length > 0 && (
              <p className="text-[11px] text-muted-foreground">Likely explanation: {brief.warning.explanations.join(' ')}</p>
            )}
            {brief.warning.stale && <p className="text-[11px] text-muted-foreground">{brief.warning.reason}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
