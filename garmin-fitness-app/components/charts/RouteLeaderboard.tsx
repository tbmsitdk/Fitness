'use client';
import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Trophy } from 'lucide-react';

interface RouteEffort {
  id: number;
  title: string;
  date: string;
  distance_km: number;
  duration_seconds: number;
  avg_speed_kmh: number;
  avg_power: number | null;
  avg_hr: number | null;
  rank: number;
  isBest: boolean;
}

interface RouteCluster {
  key: string;
  label: string;
  activity_type: string;
  distance_km: number;
  count: number;
  efforts: RouteEffort[];
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
}

const RANK_STYLES: Record<number, string> = {
  1: 'text-amber-400',
  2: 'text-slate-300',
  3: 'text-orange-400',
};

export default function RouteLeaderboard() {
  const [routes, setRoutes] = useState<RouteCluster[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/routes')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setRoutes(data.routes ?? []);
        setScanned(data.scanned ?? 0);
      })
      .catch(() => { if (!cancelled) setError('Failed to load route data'); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <p className="text-xs text-muted-foreground italic py-6 text-center">{error}</p>;
  }
  if (routes === null) {
    return <p className="text-xs text-muted-foreground italic py-6 text-center">Detecting recurring routes from GPS data…</p>;
  }
  if (routes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic py-6 text-center max-w-md mx-auto">
        No recurring routes detected yet ({scanned} GPS-tagged activities scanned). Routes need at least 3
        efforts that start in the same place and cover a similar distance — keep training and re-check, or
        re-run the sample backfill so more historical activities have GPS data.
      </p>
    );
  }

  const route = routes[active];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {routes.map((r, i) => (
          <button
            key={r.key}
            onClick={() => setActive(i)}
            className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
              i === active ? 'border-emerald-400 text-emerald-400 bg-emerald-500/10' : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {r.label} <span className="text-[10px] opacity-70">· {r.count}×</span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            <p className="text-sm font-semibold">{route.label}</p>
            <span className="text-[10px] text-muted-foreground ml-auto">{route.count} efforts on this route</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="text-left py-1.5 pr-2">#</th>
                  <th className="text-left py-1.5 pr-2">Date</th>
                  <th className="text-left py-1.5 pr-2">Title</th>
                  <th className="text-right py-1.5 pr-2">Time</th>
                  <th className="text-right py-1.5 pr-2">Dist</th>
                  <th className="text-right py-1.5 pr-2">Avg speed</th>
                  <th className="text-right py-1.5 pr-2">Avg power</th>
                  <th className="text-right py-1.5 pl-2">Avg HR</th>
                </tr>
              </thead>
              <tbody>
                {route.efforts.map(e => (
                  <tr key={e.id} className={`border-b border-border/50 ${e.isBest ? 'bg-emerald-500/5' : ''}`}>
                    <td className={`py-1.5 pr-2 font-mono font-semibold ${RANK_STYLES[e.rank] ?? 'text-muted-foreground'}`}>
                      {e.rank}{e.isBest ? ' 🏆' : ''}
                    </td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{format(parseISO(e.date), 'MMM d, yyyy')}</td>
                    <td className="py-1.5 pr-2 truncate max-w-[160px]">{e.title || '—'}</td>
                    <td className={`py-1.5 pr-2 text-right font-mono font-semibold ${e.isBest ? 'text-emerald-400' : ''}`}>{fmtDuration(e.duration_seconds)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-muted-foreground">{e.distance_km.toFixed(2)} km</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-muted-foreground">{e.avg_speed_kmh} km/h</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-muted-foreground">{e.avg_power != null ? `${e.avg_power} W` : '—'}</td>
                    <td className="py-1.5 pl-2 text-right font-mono text-muted-foreground">{e.avg_hr != null ? `${e.avg_hr} bpm` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground/60 italic">
            Routes are detected heuristically from GPS start location + total distance — not exact path matching.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
