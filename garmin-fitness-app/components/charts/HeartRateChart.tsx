'use client';
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { WellnessRecord, Activity } from '@/types';
import { format, parseISO } from 'date-fns';
import { useState } from 'react';

const TOOLTIP_STYLE = {
  background: 'hsl(240 10% 7%)',
  border: '1px solid hsl(240 3.7% 13%)',
  borderRadius: '8px',
  fontSize: 11,
};

const SPORT_COLOR: Record<string, string> = {
  running:  '#F97316',
  cycling:  '#3B82F6',
  walking:  '#22C55E',
  other:    '#A78BFA',
};

function sportColor(type: string) {
  const t = type.toLowerCase();
  if (t.includes('run')) return SPORT_COLOR.running;
  if (t.includes('cycl') || t.includes('bike') || t.includes('ride')) return SPORT_COLOR.cycling;
  if (t.includes('walk')) return SPORT_COLOR.walking;
  return SPORT_COLOR.other;
}

function rollingAvg(vals: (number | null)[], window: number): (number | null)[] {
  return vals.map((_, i) => {
    const slice = vals.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v != null);
    return slice.length >= Math.floor(window / 2)
      ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length * 10) / 10
      : null;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 space-y-1 max-w-[200px]">
      <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        p.value != null && (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color ?? p.fill }} />
            <span className="text-muted-foreground truncate">{p.name}:</span>
            <span className="font-medium text-foreground">{p.value} bpm</span>
          </div>
        )
      ))}
    </div>
  );
}

type Mode = 'full' | 'rhr' | 'max' | 'recovery';

interface Props {
  wellness: WellnessRecord[];
  activities: Activity[];
  height?: number;
}

export default function HeartRateChart({ wellness, activities, height = 300 }: Props) {
  const [mode, setMode] = useState<Mode>('full');

  const sorted = [...wellness].sort((a, b) => a.date.localeCompare(b.date));

  // Build wellness date→values map
  const wellMap = new Map(sorted.map(w => [w.date.slice(0, 10), w]));

  // Recovery score (100 - stress) for HRV overlay
  const recoveryVals = sorted.map(w => w.stress_score != null ? 100 - w.stress_score : null);
  const recovery7    = rollingAvg(recoveryVals.map(v => ({ v })), 7);

  // All dates from wellness (for the RHR line)
  const rhrVals  = sorted.map(w => w.resting_hr);
  const rhr7     = rollingAvg(rhrVals, 7);

  const rhrData = sorted.map((w, i) => ({
    date:   w.date.slice(0, 10),
    label:  format(parseISO(w.date.slice(0, 10)), 'd MMM yy'),
    rhr:    w.resting_hr,
    rhr7:   rhr7[i],
  }));

  // Activity scatter data — max HR and avg HR
  const actData = activities
    .filter(a => a.max_hr != null || a.avg_hr != null)
    .map(a => ({
      date:    a.date.slice(0, 10),
      label:   format(parseISO(a.date.slice(0, 10)), 'd MMM yy'),
      maxHR:   a.max_hr,
      avgHR:   a.avg_hr,
      sport:   a.activity_type,
      color:   sportColor(a.activity_type),
      title:   a.title || a.activity_type,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Merge into single timeline for the chart
  // We'll use a unified date axis — all unique dates
  const allDates = Array.from(new Set([
    ...sorted.map(w => w.date.slice(0, 10)),
    ...actData.map(a => a.date),
  ])).sort();

  const chartData = allDates.map(date => {
    const w = wellMap.get(date);
    const rhrIdx = sorted.findIndex(s => s.date.slice(0, 10) === date);
    return {
      date,
      label:     format(parseISO(date), 'd MMM yy'),
      rhr:       w?.resting_hr ?? null,
      rhr7:      rhrIdx >= 0 ? rhr7[rhrIdx] : null,
      recovery:  rhrIdx >= 0 ? recoveryVals[rhrIdx] : null,
      recovery7: rhrIdx >= 0 ? recovery7[rhrIdx] : null,
    };
  });

  // Stats
  const allMax  = actData.map(a => a.maxHR).filter((v): v is number => v != null);
  const allAvg  = actData.map(a => a.avgHR).filter((v): v is number => v != null);
  const allRhr  = sorted.map(w => w.resting_hr).filter((v): v is number => v != null);
  const peakMax = allMax.length ? Math.max(...allMax) : null;
  const lastRhr = allRhr.at(-1);
  const avgAvg  = allAvg.length ? Math.round(allAvg.reduce((a, b) => a + b, 0) / allAvg.length) : null;

  const tickEvery = chartData.length > 180 ? 30 : chartData.length > 60 ? 14 : 7;
  const ticks = chartData.filter((_, i) => i % tickEvery === 0).map(d => d.label);

  const hasRecovery = sorted.some(w => w.stress_score != null);

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
      {/* Toggle */}
      <div className="flex items-center gap-0.5">
        <Btn id="full"     label="All HR" />
        <Btn id="max"      label="Max HR" />
        <Btn id="rhr"      label="Resting HR" />
        {hasRecovery && <Btn id="recovery" label="HRV / Recovery" />}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-0.5">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Peak Max HR</p>
          <p className="text-xl font-semibold font-mono text-orange-400">{peakMax ?? '—'} <span className="text-sm font-normal text-muted-foreground">bpm</span></p>
          <p className="text-[10px] text-muted-foreground">Highest ever recorded</p>
        </div>
        <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-0.5">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Avg Workout HR</p>
          <p className="text-xl font-semibold font-mono text-yellow-400">{avgAvg ?? '—'} <span className="text-sm font-normal text-muted-foreground">bpm</span></p>
          <p className="text-[10px] text-muted-foreground">Mean across {actData.length} activities</p>
        </div>
        <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-0.5">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Resting HR</p>
          <p className="text-xl font-semibold font-mono text-blue-400">{lastRhr ?? '—'} <span className="text-sm font-normal text-muted-foreground">bpm</span></p>
          <p className="text-[10px] text-muted-foreground">Most recent reading</p>
        </div>
      </div>

      {/* Recovery-only view */}
      {mode === 'recovery' && (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
            <XAxis dataKey="label" ticks={ticks} tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#A78BFA' }} tickLine={false} axisLine={false} width={32} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={75} stroke="#22C55E" strokeDasharray="4 3" strokeWidth={1}
              label={{ value: 'good', position: 'insideTopRight', fontSize: 9, fill: '#22C55E' }} />
            <ReferenceLine y={50} stroke="#F59E0B" strokeDasharray="4 3" strokeWidth={1}
              label={{ value: 'moderate', position: 'insideTopRight', fontSize: 9, fill: '#F59E0B' }} />
            <Line dataKey="recovery" name="Recovery" stroke="#A78BFA" strokeWidth={0}
              dot={{ r: 2.5, fill: '#A78BFA', fillOpacity: 0.5, strokeWidth: 0 }} connectNulls={false} />
            <Line dataKey="recovery7" name="Recovery 7d avg" stroke="#A78BFA" strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* Chart */}
      {mode !== 'recovery' && (
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis
            dataKey="label"
            type="category"
            allowDuplicatedCategory={false}
            ticks={ticks}
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            width={32}
            tickFormatter={(v: number) => `${v}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
            formatter={(val) => <span style={{ color: 'hsl(240 5% 64.9%)' }}>{val}</span>}
          />

          {/* Resting HR line */}
          {(mode === 'full' || mode === 'rhr') && (
            <Line
              data={chartData}
              dataKey="rhr7"
              name="Resting HR (7d avg)"
              stroke="#3B82F6"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          )}
          {(mode === 'full' || mode === 'rhr') && (
            <Line
              data={chartData}
              dataKey="rhr"
              name="Resting HR"
              stroke="#3B82F6"
              strokeWidth={0}
              dot={{ r: 2, fill: '#3B82F6', fillOpacity: 0.4, strokeWidth: 0 }}
              connectNulls={false}
            />
          )}

          {/* Activity avg HR scatter */}
          {mode === 'full' && (
            <Scatter
              data={actData.map(a => ({ label: a.label, avgHR: a.avgHR, name: `${a.title} avg`, fill: a.color }))}
              dataKey="avgHR"
              name="Avg workout HR"
              fill="#F59E0B"
              opacity={0.5}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              shape={(props: any) => {
                const { cx, cy, fill } = props;
                if (!cy) return <g />;
                return <circle cx={cx} cy={cy} r={3} fill={fill ?? '#F59E0B'} fillOpacity={0.6} />;
              }}
            />
          )}

          {/* Activity max HR scatter */}
          {(mode === 'full' || mode === 'max') && (
            <Scatter
              data={actData.map(a => ({ label: a.label, maxHR: a.maxHR, name: `${a.title} max`, fill: a.color }))}
              dataKey="maxHR"
              name="Max workout HR"
              fill="#EF4444"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              shape={(props: any) => {
                const { cx, cy, fill } = props;
                if (!cy) return <g />;
                return <circle cx={cx} cy={cy} r={4} fill={fill ?? '#EF4444'} fillOpacity={0.75} />;
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        {(mode === 'full' || mode === 'rhr') && <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500 inline-block" />Resting HR</span>}
        {mode === 'full' && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400 opacity-70 inline-block" />Avg workout HR</span>}
        {(mode === 'full' || mode === 'max') && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />Running max</span>}
        {(mode === 'full' || mode === 'max') && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />Cycling max</span>}
        {(mode === 'full' || mode === 'max') && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Walking max</span>}
        {mode === 'recovery' && <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-purple-400 inline-block" />Recovery score (100 − stress) · higher = better recovered</span>}
      </div>
    </div>
  );
}
