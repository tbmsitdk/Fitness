'use client';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { WellnessRecord } from '@/types';
import { TrainingLoadForecast } from '@/lib/training-load';
import { format, parseISO } from 'date-fns';

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
      ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length)
      : null;
  });
}

interface Props {
  trainingLoad: TrainingLoadForecast[];
  wellness: WellnessRecord[];
  height?: number;
}

export default function HRVTrainingLoadChart({ trainingLoad, wellness, height = 280 }: Props) {
  const hasStress = wellness.some(w => w.stress_score != null);
  if (!hasStress || trainingLoad.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
        Not enough data — need training load + stress score
      </div>
    );
  }

  // Build a date-keyed map from wellness
  const wellMap = new Map(
    wellness
      .filter(w => w.stress_score != null)
      .map(w => [w.date.slice(0, 10), 100 - w.stress_score!]) // recovery score
  );

  // Merge training load with recovery, skip projected days
  const merged = trainingLoad
    .filter(d => !d.projected)
    .map(d => ({
      date:     d.date.slice(0, 10),
      label:    format(parseISO(d.date.slice(0, 10)), "d MMM ''yy"),
      tsb:      Math.round(d.tsb),
      atl:      Math.round(d.atl),
      recovery: wellMap.get(d.date.slice(0, 10)) ?? null,
    }));

  // 7-day rolling average of recovery
  const rawRecovery = merged.map(d => d.recovery);
  const recovery7   = rollingAvg(rawRecovery, 7);
  const data = merged.map((d, i) => ({ ...d, recovery7: recovery7[i] }));

  const tickEvery = data.length > 180 ? 30 : data.length > 60 ? 14 : 7;
  const ticks = data.filter((_, i) => i % tickEvery === 0).map(d => d.label);

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis
            dataKey="label"
            ticks={ticks}
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
          />

          {/* Left — Training metrics */}
          <YAxis
            yAxisId="load"
            domain={['auto', 'auto']}
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            width={32}
          />

          {/* Right — Recovery score */}
          <YAxis
            yAxisId="rec"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: '#A78BFA' }}
            tickLine={false}
            axisLine={false}
            width={40}
            label={{ value: 'recovery', angle: 90, position: 'insideRight', offset: 14, style: { fontSize: 9, fill: '#A78BFA' } }}
          />

          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'hsl(0 0% 98%)' }}
            formatter={(v: number, name: string) => {
              if (name === 'ATL (fatigue)') return [`${v}`, name];
              if (name === 'TSB (form)')    return [`${v}`, name];
              return [`${v}`, name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
            formatter={(val) => <span style={{ color: 'hsl(240 5% 64.9%)' }}>{val}</span>} />

          {/* Zero line for TSB */}
          <ReferenceLine yAxisId="load" y={0} stroke="hsl(240 3.7% 20%)" strokeWidth={1} />
          {/* Recovery "good" threshold */}
          <ReferenceLine yAxisId="rec" y={75} stroke="#A78BFA" strokeDasharray="4 3" strokeWidth={1}
            label={{ value: 'good', position: 'right', fontSize: 9, fill: '#A78BFA' }} />

          {/* ATL — fatigue */}
          <Line
            yAxisId="load"
            dataKey="atl"
            name="ATL (fatigue)"
            stroke="#EF4444"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />

          {/* TSB — form */}
          <Line
            yAxisId="load"
            dataKey="tsb"
            name="TSB (form)"
            stroke="#22C55E"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />

          {/* Recovery dots */}
          <Line
            yAxisId="rec"
            dataKey="recovery"
            name="Recovery"
            stroke="#A78BFA"
            strokeWidth={0}
            dot={{ r: 2.5, fill: '#A78BFA', fillOpacity: 0.45, strokeWidth: 0 }}
            connectNulls={false}
          />

          {/* Recovery 7d avg */}
          <Line
            yAxisId="rec"
            dataKey="recovery7"
            name="Recovery 7d avg"
            stroke="#A78BFA"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-muted-foreground/60 italic">
        Recovery (purple) = 100 − stress score · ATL (red) spikes after hard blocks — recovery should follow 2–4 days later.
        When ATL rises but recovery stays low, consider easier days.
      </p>
    </div>
  );
}
