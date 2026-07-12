'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import HRZoneChart from './HRZoneChart';
import { HRZoneData } from '@/types';

interface ZoneResponse {
  zones: HRZoneData[];
  sampledHours: number;
  approxHours: number;
}

interface Props {
  cutoff: Date;
  fallbackMaxHR: number;
  sport?: string;
  height?: number;
}

// Fetches true time-in-HR-zone from /api/hr-zones (per-second samples where
// available, rolling measured max HR per activity date) and renders HRZoneChart.
export default function HRZoneDistribution({ cutoff, fallbackMaxHR, sport, height }: Props) {
  const [resp, setResp] = useState<ZoneResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResp(null);
    setError(false);
    const params = new URLSearchParams({
      cutoff: cutoff.toISOString(),
      fallback: String(fallbackMaxHR),
    });
    if (sport) params.set('sport', sport);
    fetch(`/api/hr-zones?${params}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: ZoneResponse) => { if (!cancelled) setResp(data); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [cutoff, fallbackMaxHR, sport]);

  if (error) {
    return <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Could not load HR zone distribution</div>;
  }
  if (!resp) {
    return <div className="h-32 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div>
      <HRZoneChart data={resp.zones} height={height} />
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
        Zones from rolling measured max HR at each workout's date.
        {' '}{resp.sampledHours}h from per-second HR recordings
        {resp.approxHours > 0 && `, ${resp.approxHours}h approximated from workout averages`}.
      </p>
    </div>
  );
}
