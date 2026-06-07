'use client';
import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Activity } from '@/types';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import ActivitySamplesChart from '@/components/charts/ActivitySamplesChart';

interface Props {
  activity: Activity | null;
  onClose: () => void;
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ActivityDetail({ activity, onClose }: Props) {
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!activity) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', handler); document.body.style.overflow = ''; };
  }, [activity, close]);

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

        <div className="p-4 rounded-lg border border-border bg-card">
          <p className="text-xs font-semibold mb-2">Heart Rate / Power / Cadence over time</p>
          <ActivitySamplesChart activityId={activity.id} height={320} />
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
