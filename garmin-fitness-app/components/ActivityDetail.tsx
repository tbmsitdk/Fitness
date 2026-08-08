'use client';
import { useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Activity } from '@/types';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import ActivitySamplesChart from '@/components/charts/ActivitySamplesChart';
import {
  computeBestEfforts, computeDecoupling, computeVariabilityIndex,
  computeWorkAboveFtp, computeCardiacLag, type ActivitySample,
} from '@/lib/activity-analysis';

interface Props {
  activity: Activity | null;
  onClose: () => void;
  ftp?: number | null;
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const DECOUPLING_COLORS: Record<string, string> = {
  excellent: 'text-emerald-400',
  good:      'text-sky-400',
  moderate:  'text-amber-400',
  high:      'text-red-400',
};

const VI_COLORS: Record<string, string> = {
  steady: 'text-emerald-400',
  variable: 'text-amber-400',
  'highly variable': 'text-red-400',
};

const DECOUPLING_NOTES: Record<string, string> = {
  excellent: 'Your aerobic system held the power:HR ratio steady — strong endurance fitness for this effort.',
  good:      'Slight drift — normal for this duration/intensity. Aerobic base is solid.',
  moderate:  'Noticeable drift — could indicate accumulated fatigue, heat, dehydration, or under-fueling.',
  high:      'Significant drift — HR rose well above what power justified. Consider more easy-aerobic volume to build durability.',
};

export default function ActivityDetail({ activity, onClose, ftp }: Props) {
  const close = useCallback(() => onClose(), [onClose]);
  const [samples, setSamples] = useState<ActivitySample[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activity) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', handler); document.body.style.overflow = ''; };
  }, [activity, close]);

  useEffect(() => {
    if (!activity) { setSamples(null); return; }
    let cancelled = false;
    setSamples(null);
    setError(null);
    fetch(`/api/activities/${activity.id}/samples`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setSamples(data.samples ?? []); })
      .catch(() => { if (!cancelled) setError('Failed to load detailed data'); });
    return () => { cancelled = true; };
  }, [activity]);

  const bestEfforts = useMemo(() => samples ? computeBestEfforts(samples) : [], [samples]);
  const decoupling = useMemo(() => {
    if (!samples || activity?.activity_type !== 'cycling') return null;
    return computeDecoupling(samples);
  }, [samples, activity]);
  const variability = useMemo(() => {
    if (!samples || activity?.activity_type !== 'cycling') return null;
    return computeVariabilityIndex(samples);
  }, [samples, activity]);
  const workAboveFtp = useMemo(() => {
    if (!samples || activity?.activity_type !== 'cycling') return null;
    return computeWorkAboveFtp(samples, ftp);
  }, [samples, activity, ftp]);
  const cardiacLag = useMemo(() => {
    if (!samples || activity?.activity_type !== 'cycling') return null;
    return computeCardiacLag(samples);
  }, [samples, activity]);

  if (!activity || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div>
          <p className="text-sm font-semibold">{activity.title || activity.activity_type}</p>
          <p className="text-[11px] text-muted-foreground">{format(parseISO(activity.date), 'PPP p')} · {activity.activity_type}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={close} className="gap-1.5">
          <X className="w-3.5 h-3.5" />
          <span className="text-xs">Close</span>
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Duration" value={fmtDuration(activity.duration_seconds)} />
          <Stat label="Distance" value={`${activity.distance_km.toFixed(2)} km`} />
          <Stat label="Avg HR" value={activity.avg_hr != null ? `${activity.avg_hr} bpm` : '—'} />
          <Stat label="Max HR" value={activity.max_hr != null ? `${activity.max_hr} bpm` : '—'} />
          <Stat label="Avg Power" value={activity.avg_power != null ? `${activity.avg_power} W` : '—'} />
          <Stat label="Max Power" value={activity.max_power != null ? `${activity.max_power} W` : '—'} />
          <Stat label="Avg Cadence" value={activity.avg_cadence != null ? `${activity.avg_cadence} rpm` : '—'} />
          <Stat label="Calories" value={`${activity.calories}`} />
        </div>

        {/* Best Efforts — power/HR curve within this single workout */}
        {bestEfforts.length > 0 && (
          <div className="p-4 rounded-lg border border-border bg-card">
            <p className="text-xs font-semibold mb-3">Best Efforts (this workout)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {bestEfforts.map(e => (
                <div key={e.windowSeconds} className="p-3 rounded-lg border border-border space-y-1">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{e.label}</p>
                  {e.power != null && <p className="text-sm font-mono font-semibold text-blue-400">{e.power} W</p>}
                  {e.hr != null && <p className="text-xs font-mono text-red-400">{e.hr} bpm</p>}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/60 italic mt-2">Best sustained average over each window, derived from 10s samples</p>
          </div>
        )}

        {/* Aerobic decoupling — cycling with power data only */}
        {decoupling && (
          <div className="p-4 rounded-lg border border-border bg-card space-y-1.5">
            <p className="text-xs font-semibold">Aerobic Decoupling (Power:HR drift)</p>
            <p className={`text-2xl font-mono font-bold ${DECOUPLING_COLORS[decoupling.interpretation]}`}>
              {decoupling.pctDrift > 0 ? '+' : ''}{decoupling.pctDrift}%
            </p>
            <p className="text-[11px] text-muted-foreground">
              First half ratio {decoupling.firstHalfRatio} W/bpm → second half {decoupling.secondHalfRatio} W/bpm
            </p>
            <p className="text-[11px] text-muted-foreground/80">{DECOUPLING_NOTES[decoupling.interpretation]}</p>
            <p className="text-[10px] text-muted-foreground/60 italic">Rule of thumb: &lt;5% = strong aerobic durability for this effort</p>
          </div>
        )}

        {/* Variability Index, Work above FTP, Cardiac Lag — cycling with power only */}
        {(variability || workAboveFtp || cardiacLag) && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {variability && (
              <div className="p-4 rounded-lg border border-border bg-card space-y-1">
                <p className="text-xs font-semibold">Variability Index</p>
                <p className={`text-2xl font-mono font-bold ${VI_COLORS[variability.interpretation]}`}>{variability.vi.toFixed(2)}</p>
                <p className="text-[11px] text-muted-foreground">
                  NP {variability.normalizedPower} W ÷ Avg {variability.avgPower} W
                </p>
                <p className="text-[11px] text-muted-foreground/80 capitalize">{variability.interpretation} effort</p>
                <p className="text-[10px] text-muted-foreground/60 italic">~1.0 = steady-state; higher = surgy/interval effort</p>
              </div>
            )}
            {workAboveFtp && (
              <div className="p-4 rounded-lg border border-border bg-card space-y-1">
                <p className="text-xs font-semibold">Work Above FTP</p>
                <p className="text-2xl font-mono font-bold text-orange-400">+{workAboveFtp.avgWattsAboveFtp} W avg</p>
                <p className="text-[11px] text-muted-foreground">
                  Peak +{workAboveFtp.peakWattsAboveFtp} W · {fmtDuration(workAboveFtp.secondsAboveFtp)} above FTP ({workAboveFtp.pctTimeAboveFtp}% of ride)
                </p>
                <p className="text-[10px] text-muted-foreground/60 italic">Excess power beyond FTP — proxy for anaerobic-reserve depletion</p>
              </div>
            )}
            {cardiacLag && (
              <div className="p-4 rounded-lg border border-border bg-card space-y-1">
                <p className="text-xs font-semibold">Cardiac Lag</p>
                <p className="text-2xl font-mono font-bold text-purple-400">{cardiacLag.lagSeconds}s</p>
                <p className="text-[11px] text-muted-foreground">
                  Best fit r = {cardiacLag.correlation} ({cardiacLag.confidence} confidence)
                </p>
                <p className="text-[10px] text-muted-foreground/60 italic">
                  Time for HR to respond to power changes — most meaningful for interval workouts
                </p>
              </div>
            )}
          </div>
        )}

        <div className="p-4 rounded-lg border border-border bg-card">
          <p className="text-xs font-semibold mb-2">Heart Rate / Power / Cadence over time</p>
          {error ? (
            <p className="text-xs text-muted-foreground italic py-6 text-center">{error}</p>
          ) : (
            <ActivitySamplesChart samples={samples} height={320} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg border border-border bg-card space-y-0.5">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-sm font-mono font-semibold">{value}</p>
    </div>
  );
}
