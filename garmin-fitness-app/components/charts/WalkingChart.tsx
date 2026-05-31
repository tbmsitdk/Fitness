'use client';
import {
  ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Bar, BarChart, ReferenceLine,
} from 'recharts';
import { Activity } from '@/types';
import { format, parseISO } from 'date-fns';
import { useState } from 'react';

const TOOLTIP_STYLE = {
  background: 'hsl(240 10% 7%)',
  border: '1px solid hsl(240 3.7% 13%)',
  borderRadius: '8px',
  fontSize: 11,
};

function rollingAvg(vals: (number | null)[], w: number): (number | null)[] {
  return vals.map((_, i) => {
    const slice = vals.slice(Math.max(0, i - w + 1), i + 1).filter((v): v is number => v != null);
    return slice.length >= Math.floor(w / 2)
      ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length * 10) / 10
      : null;
  });
}

type Mode = 'pace' | 'distance' | 'elevation' | 'hr' | 'duration';

const MODES: { id: Mode; label: string }[] = [
  { id: 'pace',      label: 'Pace'       },
  { id: 'distance',  label: 'Distance'   },
  { id: 'elevation', label: 'Elevation'  },
  { id: 'hr',        label: 'Heart Rate' },
  { id: 'duration',  label: 'Duration'   },
];

interface Props {
  activities: Activity[];
  height?: number;
}

export default function WalkingChart({ activities, height = 280 }: Props) {
  const [mode, setMode] = useState<Mode>('pace');

  const walks = activities
    .filter(a => a.activity_type === 'walking' && a.distance_km > 0.2)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (walks.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">
        No walking activities recorded
      </div>
    );
  }

  const data = walks.map(a => {
    const durationMin = a.duration_seconds / 60;
    const paceMinKm   = a.distance_km > 0 ? durationMin / a.distance_km : null;
    return {
      date:      a.date.slice(0, 10),
      label:     format(parseISO(a.date.slice(0, 10)), 'd MMM yy'),
      pace:      paceMinKm ? Math.round(paceMinKm * 10) / 10 : null,
      distance:  Math.round(a.distance_km * 10) / 10,
      elevation: a.elevation_gain ?? null,
      hr:        a.avg_hr ?? null,
      duration:  Math.round(durationMin),
      title:     a.title || 'Walk',
    };
  });

  // Rolling averages
  const pace7      = rollingAvg(data.map(d => d.pace), 7);
  const distance7  = rollingAvg(data.map(d => d.distance), 7);
  const elevation7 = rollingAvg(data.map(d => d.elevation), 7);
  const hr7        = rollingAvg(data.map(d => d.hr), 7);
  const duration7  = rollingAvg(data.map(d => d.duration), 7);

  const chartData = data.map((d, i) => ({
    ...d,
    avg7: mode === 'pace'      ? pace7[i]
        : mode === 'distance'  ? distance7[i]
        : mode === 'elevation' ? elevation7[i]
        : mode === 'hr'        ? hr7[i]
        : duration7[i],
  }));

  // Stats
  const validPace  = data.map(d => d.pace).filter((v): v is number => v != null);
  const validDist  = data.map(d => d.distance);
  const validElev  = data.map(d => d.elevation).filter((v): v is number => v != null);
  const validHr    = data.map(d => d.hr).filter((v): v is number => v != null);
  const totalDist  = Math.round(validDist.reduce((a, b) => a + b, 0) * 10) / 10;
  const avgPace    = validPace.length ? Math.round(validPace.reduce((a, b) => a + b, 0) / validPace.length * 10) / 10 : null;
  const totalElev  = validElev.length ? Math.round(validElev.reduce((a, b) => a + b, 0)) : null;
  const avgHr      = validHr.length ? Math.round(validHr.reduce((a, b) => a + b, 0) / validHr.length) : null;
  const longestDist = Math.max(...validDist);

  const fmtPace = (v: number) => {
    const m = Math.floor(v); const s = Math.round((v - m) * 60);
    return `${m}:${s.toString().padStart(2, '0')} min/km`;
  };

  const cfg = {
    pace:      { label: 'Avg pace',      color: '#22C55E', unit: ' min/km', fmt: (v: number) => fmtPace(v) },
    distance:  { label: 'Distance',      color: '#3B82F6', unit: ' km',     fmt: (v: number) => `${v} km` },
    elevation: { label: 'Elevation',     color: '#F59E0B', unit: ' m',      fmt: (v: number) => `${v} m` },
    hr:        { label: 'Avg HR',        color: '#EF4444', unit: ' bpm',    fmt: (v: number) => `${v} bpm` },
    duration:  { label: 'Duration',      color: '#8B5CF6', unit: ' min',    fmt: (v: number) => `${v} min` },
  }[mode];

  const activeKey = mode;
  const hasData   = chartData.some(d => d[activeKey] != null);

  const tickEvery = chartData.length > 100 ? 14 : chartData.length > 40 ? 7 : 3;
  const ticks     = chartData.filter((_, i) => i % tickEvery === 0).map(d => d.label);

  const Btn = ({ id, label }: { id: Mode; label: string }) => (
    <button
      onClick={() => setMode(id)}
      className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
        mode === id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="rounded-md border border-border bg-secondary/30 p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Total distance</p>
          <p className="text-xl font-semibold font-mono text-green-400">{totalDist} <span className="text-sm font-normal text-muted-foreground">km</span></p>
          <p className="text-[10px] text-muted-foreground">{walks.length} walks</p>
        </div>
        <div className="rounded-md border border-border bg-secondary/30 p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Longest walk</p>
          <p className="text-xl font-semibold font-mono text-blue-400">{longestDist} <span className="text-sm font-normal text-muted-foreground">km</span></p>
        </div>
        {avgPace && (
          <div className="rounded-md border border-border bg-secondary/30 p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Avg pace</p>
            <p className="text-xl font-semibold font-mono text-purple-400">{Math.floor(avgPace)}:{Math.round((avgPace % 1) * 60).toString().padStart(2,'0')}</p>
            <p className="text-[10px] text-muted-foreground">min/km</p>
          </div>
        )}
        {totalElev != null && (
          <div className="rounded-md border border-border bg-secondary/30 p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Total elevation</p>
            <p className="text-xl font-semibold font-mono text-amber-400">{totalElev.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">m</span></p>
          </div>
        )}
        {avgHr && !totalElev && (
          <div className="rounded-md border border-border bg-secondary/30 p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Avg HR</p>
            <p className="text-xl font-semibold font-mono text-red-400">{avgHr} <span className="text-sm font-normal text-muted-foreground">bpm</span></p>
          </div>
        )}
      </div>

      {/* Mode selector */}
      <div className="flex items-center gap-0.5 flex-wrap">
        {MODES.map(m => <Btn key={m.id} id={m.id} label={m.label} />)}
      </div>

      {!hasData ? (
        <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
          No {mode} data available for walking activities
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
            <XAxis dataKey="label" ticks={ticks} tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} width={36} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: 'hsl(0 0% 98%)' }}
              formatter={(v: number, name: string) => [`${v}${cfg.unit}`, name]}
            />
            {/* Individual walk dots */}
            <Scatter
              dataKey={activeKey}
              name={cfg.label}
              fill={cfg.color}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              shape={(props: any) => {
                const { cx, cy } = props;
                if (!cy) return <g />;
                return <circle cx={cx} cy={cy} r={3} fill={cfg.color} fillOpacity={0.5} />;
              }}
            />
            {/* 7-day rolling average */}
            <Line
              dataKey="avg7"
              name={`${cfg.label} (7-walk avg)`}
              stroke={cfg.color}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
