'use client';
import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface Sample {
  elapsed_seconds: number;
  hr: number | null;
  power: number | null;
  cadence: number | null;
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ActivitySamplesChart({ activityId, height = 280 }: { activityId: number; height?: number }) {
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState({ hr: true, power: true, cadence: false });

  useEffect(() => {
    let cancelled = false;
    setSamples(null);
    setError(null);
    fetch(`/api/activities/${activityId}/samples`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setSamples(data.samples ?? []); })
      .catch(() => { if (!cancelled) setError('Failed to load detailed data'); });
    return () => { cancelled = true; };
  }, [activityId]);

  if (error) return <p className="text-xs text-muted-foreground italic py-6 text-center">{error}</p>;
  if (samples === null) return <p className="text-xs text-muted-foreground italic py-6 text-center">Loading per-second data…</p>;
  if (samples.length === 0) return <p className="text-xs text-muted-foreground italic py-6 text-center">No detailed (per-second) data available for this activity.</p>;

  const hasHr = samples.some(s => s.hr != null);
  const hasPower = samples.some(s => s.power != null);
  const hasCadence = samples.some(s => s.cadence != null);

  const data = samples.map(s => ({ ...s, t: formatElapsed(s.elapsed_seconds) }));

  return (
    <div className="space-y-2">
      <div className="flex gap-2 text-[10px]">
        {hasHr && (
          <button onClick={() => setShow(v => ({ ...v, hr: !v.hr }))}
            className={`px-2 py-1 rounded border ${show.hr ? 'border-red-400 text-red-400' : 'border-border text-muted-foreground'}`}>HR</button>
        )}
        {hasPower && (
          <button onClick={() => setShow(v => ({ ...v, power: !v.power }))}
            className={`px-2 py-1 rounded border ${show.power ? 'border-blue-400 text-blue-400' : 'border-border text-muted-foreground'}`}>Power</button>
        )}
        {hasCadence && (
          <button onClick={() => setShow(v => ({ ...v, cadence: !v.cadence }))}
            className={`px-2 py-1 rounded border ${show.cadence ? 'border-green-400 text-green-400' : 'border-border text-muted-foreground'}`}>Cadence</button>
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={40} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip contentStyle={{ fontSize: 11, background: 'var(--card)', border: '1px solid var(--border)' }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {hasHr && show.hr && <Line type="monotone" dataKey="hr" name="HR (bpm)" stroke="#f87171" dot={false} strokeWidth={1.5} isAnimationActive={false} />}
          {hasPower && show.power && <Line type="monotone" dataKey="power" name="Power (W)" stroke="#60a5fa" dot={false} strokeWidth={1.5} isAnimationActive={false} />}
          {hasCadence && show.cadence && <Line type="monotone" dataKey="cadence" name="Cadence (rpm)" stroke="#4ade80" dot={false} strokeWidth={1.5} isAnimationActive={false} />}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 italic">Sampled every 10 seconds</p>
    </div>
  );
}
