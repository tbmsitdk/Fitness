'use client';
import { useEffect, useState } from 'react';
import { formatDistanceToNow, parseISO, addHours, format } from 'date-fns';

interface SyncEntry {
  id: number;
  synced_at: string;
  status: 'success' | 'error';
  sync_days: number | null;
  activities_synced: number;
  wellness_synced: number;
  error_message: string | null;
  duration_seconds: number | null;
}

function StatusDot({ status }: { status: 'success' | 'error' }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
  );
}

function timeAgo(iso: string) {
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true }); }
  catch { return iso; }
}

function nextSync(lastAt: string): string {
  try {
    // Daily sync runs at 4 AM UTC; estimate next run from last sync
    const last = parseISO(lastAt);
    const next = addHours(last, 24);
    const diff = next.getTime() - Date.now();
    if (diff < 0) return 'overdue — check GitHub Actions';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `in ~${h}h ${m}m` : `in ~${m}m`;
  } catch { return 'daily at 4 AM UTC'; }
}

export default function SyncStatus() {
  const [logs, setLogs]     = useState<SyncEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  useEffect(() => {
    fetch('/api/sync-log')
      .then(r => r.json())
      .then(d => { setLogs(d.logs ?? []); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  const latest = logs[0];

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Garmin Sync Status</h3>
        <a
          href="https://github.com/tbmsitdk/Fitness/actions/workflows/garmin-sync.yml"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-muted-foreground hover:text-foreground underline transition"
        >
          Trigger manual sync ↗
        </a>
      </div>

      {loading && (
        <div className="space-y-2">
          {[0,1].map(i => <div key={i} className="h-4 bg-muted rounded animate-pulse" />)}
        </div>
      )}

      {!loading && error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {!loading && !error && logs.length === 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">No syncs recorded yet.</p>
          <p className="text-[11px] text-muted-foreground/60">
            The daily sync runs at 4 AM UTC via GitHub Actions. After the next run, status will appear here.
          </p>
        </div>
      )}

      {!loading && latest && (
        <div className="space-y-3">
          {/* Latest sync summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Last sync</p>
              <div className="flex items-center gap-1.5">
                <StatusDot status={latest.status} />
                <span className="text-sm font-medium">{timeAgo(latest.synced_at)}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">{format(parseISO(latest.synced_at), 'd MMM yyyy, HH:mm')}</p>
            </div>

            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Next sync</p>
              <p className="text-sm font-medium">{nextSync(latest.synced_at)}</p>
              <p className="text-[10px] text-muted-foreground">Daily at 4 AM UTC</p>
            </div>

            {latest.status === 'success' && (
              <>
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Records synced</p>
                  <p className="text-sm font-medium font-mono">
                    {latest.activities_synced} <span className="text-muted-foreground font-sans text-xs">activities</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">{latest.wellness_synced} wellness days</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Details</p>
                  <p className="text-sm font-medium">{latest.sync_days ?? '—'} day window</p>
                  {latest.duration_seconds != null && (
                    <p className="text-[10px] text-muted-foreground">took {latest.duration_seconds}s</p>
                  )}
                </div>
              </>
            )}

            {latest.status === 'error' && (
              <div className="col-span-2 rounded-md bg-red-500/10 border border-red-500/20 p-2">
                <p className="text-[10px] text-red-400 font-mono break-all">{latest.error_message ?? 'Unknown error'}</p>
              </div>
            )}
          </div>

          {/* History table */}
          {logs.length > 1 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Recent syncs</p>
              <div className="space-y-1">
                {logs.slice(0, 8).map(log => (
                  <div key={log.id} className="flex items-center gap-2 text-[11px]">
                    <StatusDot status={log.status} />
                    <span className="text-muted-foreground w-32 flex-shrink-0">{timeAgo(log.synced_at)}</span>
                    {log.status === 'success'
                      ? <span className="text-foreground">{log.activities_synced} acts · {log.wellness_synced} wellness</span>
                      : <span className="text-red-400 truncate">{log.error_message ?? 'error'}</span>
                    }
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
