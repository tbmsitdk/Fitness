'use client';
import { useMemo } from 'react';
import { Activity } from '@/types';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

interface RaceResult {
  label: string;
  distance_km: number;
  predicted_seconds: number;
  pace_per_km: number;
  confidence: number; // 0-100
}

const RACE_BANDS = [
  { label: '5K',            distance: 5.0,    minKm: 3,  maxKm: 7  },
  { label: '10K',           distance: 10.0,   minKm: 8,  maxKm: 13 },
  { label: 'Half Marathon', distance: 21.0975, minKm: 17, maxKm: 24 },
  { label: 'Marathon',      distance: 42.195, minKm: 36, maxKm: 45 },
] as const;

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatPace(secsPerKm: number): string {
  const m = Math.floor(secsPerKm / 60);
  const s = Math.round(secsPerKm % 60);
  return `${m}:${s.toString().padStart(2, '0')}/km`;
}

function riegelPredict(t1: number, d1: number, d2: number): number {
  return t1 * Math.pow(d2 / d1, 1.06);
}

export default function RacePredictor({ activities }: { activities: Activity[] }) {
  const results = useMemo((): RaceResult[] => {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);

    const runs = activities.filter(
      a => a.activity_type === 'running' &&
        a.distance_km > 0 &&
        a.duration_seconds > 0 &&
        new Date(a.date) >= cutoff
    );

    // Find best (fastest pace) effort per band
    const bestEfforts: { label: string; distance: number; seconds: number }[] = [];
    for (const band of RACE_BANDS) {
      const inBand = runs.filter(a => a.distance_km >= band.minKm && a.distance_km <= band.maxKm);
      if (inBand.length === 0) continue;
      const fastest = inBand.reduce((best, a) => {
        const pace = a.duration_seconds / a.distance_km;
        return pace < best.duration_seconds / best.distance_km ? a : best;
      });
      bestEfforts.push({ label: band.label, distance: fastest.distance_km, seconds: fastest.duration_seconds });
    }

    if (bestEfforts.length === 0) return [];

    // For each target race distance, average the Riegel predictions from all base efforts
    return RACE_BANDS.map(target => {
      const predictions = bestEfforts.map(e => riegelPredict(e.seconds, e.distance, target.distance));
      const avg = predictions.reduce((s, v) => s + v, 0) / predictions.length;
      // Confidence: more base efforts = higher confidence; also penalise if base is far from target
      const confidence = Math.min(100, bestEfforts.length * 25);
      return {
        label: target.label,
        distance_km: target.distance,
        predicted_seconds: avg,
        pace_per_km: avg / target.distance,
        confidence,
      };
    });
  }, [activities]);

  if (results.length === 0) {
    return (
      <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">
        No running activities found in the last 365 days
      </div>
    );
  }

  const maxConf = Math.max(...results.map(r => r.confidence));

  const confLabel = (c: number) => {
    if (c >= 75) return { text: 'High', color: '#22C55E' };
    if (c >= 50) return { text: 'Medium', color: '#F59E0B' };
    return { text: 'Low', color: '#EF4444' };
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {results.map(r => {
          const conf = confLabel(r.confidence);
          return (
            <div key={r.label} className="p-3 rounded-lg border border-border bg-card space-y-1.5">
              <p className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">{r.label}</p>
              <p className="text-xl font-bold font-mono tracking-tight text-foreground">
                {formatTime(r.predicted_seconds)}
              </p>
              <p className="text-[11px] text-muted-foreground">{formatPace(r.pace_per_km)}</p>
              <div className="flex items-center gap-1 pt-1">
                <span className="text-[10px]" style={{ color: conf.color }}>{conf.text} confidence</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Confidence indicator */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>Based on {results.length > 0 ? `${Math.round(maxConf / 25)} effort band(s)` : '0 efforts'} in the last 365 days.</span>
        <span className="text-muted-foreground/60 italic">
          Riegel formula: T2 = T1 × (D2/D1)^1.06. More distance bands = higher confidence.
        </span>
      </div>
    </div>
  );
}
