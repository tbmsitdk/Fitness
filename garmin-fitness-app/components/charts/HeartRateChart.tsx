'use client';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { WellnessRecord } from '@/types';
import { format, parseISO } from 'date-fns';

const TOOLTIP_STYLE = {
  background: 'hsl(240 10% 7%)',
  border: '1px solid hsl(240 3.7% 13%)',
  borderRadius: '8px',
  fontSize: 11,
};

function rollingAvg(data: { v: number | null }[], window: number): (number | null)[] {
  return data.map((_, i) => {
    const slice = data.slice(Math.max(0, i - window + 1), i + 1).map(d => d.v).filter((v): v is number => v != null);
    return slice.length >= Math.floor(window / 2) ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length * 10) / 10 : null;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 space-y-1">
      <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium text-foreground">{p.value != null ? `${p.value}${p.unit ?? ''}` : '—'}</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  wellness: WellnessRecord[];
  height?: number;
}

export default function HeartRateChart({ wellness, height = 280 }: Props) {
  const sorted = [...wellness].sort((a, b) => a.date.localeCompare(b.date));

  const rhrSeries  = sorted.map(w => ({ v: w.resting_hr }));
  const hrvSeries  = sorted.map(w => ({ v: w.hrv_rmssd != null ? Math.round(w.hrv_rmssd) : null }));
  const rhrRolling = rollingAvg(rhrSeries, 7);
  const hrvRolling = rollingAvg(hrvSeries, 7);

  const data = sorted.map((w, i) => ({
    date:       format(parseISO(w.date.slice(0, 10)), 'd MMM yy'),
    rhr:        w.resting_hr,
    hrv:        w.hrv_rmssd != null ? Math.round(w.hrv_rmssd) : null,
    rhr7:       rhrRolling[i],
    hrv7:       hrvRolling[i],
  }));

  const hasRHR = data.some(d => d.rhr != null);
  const hasHRV = data.some(d => d.hrv != null);

  if (!hasRHR && !hasHRV) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
        No heart rate data — connect a Garmin device with heart rate monitoring
      </div>
    );
  }

  // Stats for header
  const rhrVals  = data.map(d => d.rhr).filter((v): v is number => v != null);
  const hrvVals  = data.map(d => d.hrv).filter((v): v is number => v != null);
  const rhrLast  = rhrVals.at(-1);
  const rhrMin   = rhrVals.length ? Math.min(...rhrVals) : null;
  const rhrMax   = rhrVals.length ? Math.max(...rhrVals) : null;
  const hrvLast  = hrvVals.at(-1);
  const hrvMin   = hrvVals.length ? Math.min(...hrvVals) : null;
  const hrvMax   = hrvVals.length ? Math.max(...hrvVals) : null;

  // tick density
  const tickEvery = data.length > 180 ? 30 : data.length > 60 ? 14 : 7;
  const ticks = data.filter((_, i) => i % tickEvery === 0).map(d => d.date);

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        {hasRHR && (
          <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-1">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Resting HR</p>
            <p className="text-xl font-semibold font-mono text-red-400">{rhrLast ?? '—'} <span className="text-sm font-normal text-muted-foreground">bpm</span></p>
            <p className="text-[10px] text-muted-foreground">
              Range: {rhrMin}–{rhrMax} bpm · {rhrVals.length} days recorded
            </p>
          </div>
        )}
        {hasHRV && (
          <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-1">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">HRV (RMSSD)</p>
            <p className="text-xl font-semibold font-mono text-purple-400">{hrvLast ?? '—'} <span className="text-sm font-normal text-muted-foreground">ms</span></p>
            <p className="text-[10px] text-muted-foreground">
              Range: {hrvMin}–{hrvMax} ms · {hrvVals.length} days recorded
            </p>
          </div>
        )}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 4, right: hasHRV ? 48 : 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis
            dataKey="date"
            ticks={ticks}
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
          />
          {/* Left axis — Resting HR */}
          {hasRHR && (
            <YAxis
              yAxisId="rhr"
              domain={['auto', 'auto']}
              tick={{ fontSize: 10, fill: '#EF4444' }}
              tickLine={false}
              axisLine={false}
              width={32}
              tickFormatter={(v: number) => `${v}`}
              label={{ value: 'bpm', angle: -90, position: 'insideLeft', offset: 12, style: { fontSize: 9, fill: '#EF4444' } }}
            />
          )}
          {/* Right axis — HRV */}
          {hasHRV && (
            <YAxis
              yAxisId="hrv"
              orientation="right"
              domain={['auto', 'auto']}
              tick={{ fontSize: 10, fill: '#A78BFA' }}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v: number) => `${v}`}
              label={{ value: 'ms', angle: 90, position: 'insideRight', offset: 12, style: { fontSize: 9, fill: '#A78BFA' } }}
            />
          )}
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
            formatter={(val) => <span style={{ color: 'hsl(240 5% 64.9%)' }}>{val}</span>}
          />

          {/* Raw dots */}
          {hasRHR && (
            <Line
              yAxisId="rhr"
              dataKey="rhr"
              name="Resting HR"
              stroke="#EF4444"
              strokeWidth={0}
              dot={{ r: 2, fill: '#EF4444', fillOpacity: 0.35, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              // @ts-expect-error custom unit prop for tooltip
              unit=" bpm"
            />
          )}
          {hasHRV && (
            <Line
              yAxisId="hrv"
              dataKey="hrv"
              name="HRV"
              stroke="#A78BFA"
              strokeWidth={0}
              dot={{ r: 2, fill: '#A78BFA', fillOpacity: 0.35, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              // @ts-expect-error custom unit prop for tooltip
              unit=" ms"
            />
          )}

          {/* 7-day rolling averages */}
          {hasRHR && (
            <Line
              yAxisId="rhr"
              dataKey="rhr7"
              name="RHR 7d avg"
              stroke="#EF4444"
              strokeWidth={2}
              dot={false}
              activeDot={false}
              connectNulls
              // @ts-expect-error custom unit prop for tooltip
              unit=" bpm"
            />
          )}
          {hasHRV && (
            <Line
              yAxisId="hrv"
              dataKey="hrv7"
              name="HRV 7d avg"
              stroke="#A78BFA"
              strokeWidth={2}
              dot={false}
              activeDot={false}
              connectNulls
              // @ts-expect-error custom unit prop for tooltip
              unit=" ms"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-muted-foreground">
        Dots = daily readings · Solid lines = 7-day rolling average · Higher HRV and lower resting HR indicate better cardiovascular fitness and recovery
      </p>
    </div>
  );
}
