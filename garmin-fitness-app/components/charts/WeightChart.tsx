'use client';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts';
import { WellnessRecord } from '@/types';
import { format, parseISO } from 'date-fns';

const TOOLTIP_STYLE = {
  background: 'hsl(240 10% 7%)',
  border: '1px solid hsl(240 3.7% 13%)',
  borderRadius: '8px',
  fontSize: 11,
};

// BMI zone reference bands
const BMI_ZONES = [
  { y1: 0,    y2: 18.5, label: 'Underweight', color: '#60A5FA', opacity: 0.06 },
  { y1: 18.5, y2: 25,   label: 'Normal',      color: '#22C55E', opacity: 0.06 },
  { y1: 25,   y2: 30,   label: 'Overweight',  color: '#F59E0B', opacity: 0.06 },
  { y1: 30,   y2: 60,   label: 'Obese',       color: '#EF4444', opacity: 0.06 },
];

function bmi(weightKg: number, heightCm: number): number {
  const h = heightCm / 100;
  return Math.round((weightKg / (h * h)) * 10) / 10;
}

function bmiCategory(b: number): string {
  if (b < 18.5) return 'Underweight';
  if (b < 25)   return 'Normal weight';
  if (b < 30)   return 'Overweight';
  return 'Obese';
}

// Simple linear trend
function trend(points: { y: number; x: number }[]): (number | null)[] {
  const n = points.length;
  if (n < 3) return points.map(() => null);
  const sx = points.reduce((s, p) => s + p.x, 0);
  const sy = points.reduce((s, p) => s + p.y, 0);
  const sxy = points.reduce((s, p) => s + p.x * p.y, 0);
  const sxx = points.reduce((s, p) => s + p.x * p.x, 0);
  const d = n * sxx - sx * sx;
  if (d === 0) return points.map(() => null);
  const slope = (n * sxy - sx * sy) / d;
  const intercept = (sy - slope * sx) / n;
  return points.map(p => Math.round((slope * p.x + intercept) * 10) / 10);
}

interface Props {
  wellness: WellnessRecord[];
  heightCm?: number | null;
  height?: number;
}

export default function WeightChart({ wellness, heightCm, height = 240 }: Props) {
  const withWeight = wellness
    .filter(w => w.weight_kg != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (withWeight.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        No weight data found. Make sure your Garmin device is syncing body composition.
      </div>
    );
  }

  const spanYears = new Set(withWeight.map(w => w.date.substring(0, 4))).size > 1;
  const dateFmt = spanYears ? "MMM ''yy" : 'MMM d';

  const trendVals = trend(withWeight.map((w, i) => ({ x: i, y: w.weight_kg as number })));

  const showBMI = heightCm != null && heightCm > 0;

  // Compute BMI weight thresholds for reference lines
  const normalMin  = showBMI ? Math.round((18.5 * (heightCm! / 100) ** 2) * 10) / 10 : null;
  const normalMax  = showBMI ? Math.round((25   * (heightCm! / 100) ** 2) * 10) / 10 : null;
  const overMax    = showBMI ? Math.round((30   * (heightCm! / 100) ** 2) * 10) / 10 : null;

  const display = withWeight.map((w, i) => ({
    date: format(parseISO(w.date), dateFmt),
    weight: w.weight_kg,
    trend: trendVals[i],
    bmi: showBMI ? bmi(w.weight_kg as number, heightCm!) : undefined,
  }));

  const latest = withWeight[withWeight.length - 1];
  const first  = withWeight[0];
  const delta  = latest.weight_kg != null && first.weight_kg != null
    ? Math.round((latest.weight_kg - first.weight_kg) * 10) / 10
    : null;
  const latestBMI = showBMI ? bmi(latest.weight_kg as number, heightCm!) : null;

  const tickInterval = Math.max(1, Math.floor(display.length / 10));

  return (
    <div>
      {/* KPI strip */}
      <div className="flex flex-wrap items-center gap-4 mb-3 text-sm">
        <div>
          <span className="text-muted-foreground text-[11px]">Latest  </span>
          <span className="font-bold font-mono text-white">{latest.weight_kg} kg</span>
        </div>
        {delta !== null && (
          <div>
            <span className="text-muted-foreground text-[11px]">Change  </span>
            <span className={`font-bold font-mono ${delta > 0 ? 'text-amber-400' : delta < 0 ? 'text-green-400' : 'text-muted-foreground'}`}>
              {delta > 0 ? '+' : ''}{delta} kg
            </span>
          </div>
        )}
        {latestBMI && (
          <div>
            <span className="text-muted-foreground text-[11px]">BMI  </span>
            <span className="font-bold font-mono text-white">{latestBMI}</span>
            <span className="text-[10px] text-muted-foreground ml-1">({bmiCategory(latestBMI)})</span>
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={display} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            interval={tickInterval}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false}
            axisLine={false}
            domain={['auto', 'auto']}
            tickCount={5}
            tickFormatter={v => `${v} kg`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, name: string) => {
              if (name === 'weight') return [`${v} kg`, 'Weight'];
              if (name === 'trend')  return [`${v} kg`, 'Trend'];
              if (name === 'bmi')    return [v, 'BMI'];
              return [v, name];
            }}
          />

          {/* BMI reference lines on the weight axis */}
          {normalMin != null && (
            <ReferenceLine y={normalMin} stroke="#22C55E" strokeDasharray="4 3" strokeWidth={1}
              label={{ value: `BMI 18.5 (${normalMin} kg)`, position: 'insideTopLeft', fontSize: 9, fill: '#22C55E' }} />
          )}
          {normalMax != null && (
            <ReferenceLine y={normalMax} stroke="#F59E0B" strokeDasharray="4 3" strokeWidth={1}
              label={{ value: `BMI 25 (${normalMax} kg)`, position: 'insideTopLeft', fontSize: 9, fill: '#F59E0B' }} />
          )}
          {overMax != null && (
            <ReferenceLine y={overMax} stroke="#EF4444" strokeDasharray="4 3" strokeWidth={1}
              label={{ value: `BMI 30 (${overMax} kg)`, position: 'insideTopLeft', fontSize: 9, fill: '#EF4444' }} />
          )}

          <Line
            type="monotone"
            dataKey="weight"
            name="weight"
            stroke="#A78BFA"
            strokeWidth={2}
            dot={{ r: 2, fill: '#A78BFA' }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="trend"
            name="trend"
            stroke="hsl(240 5% 50%)"
            strokeWidth={1.5}
            dot={false}
            strokeDasharray="5 3"
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
        Weight synced from Garmin.{showBMI ? ' Dashed lines = BMI zone boundaries for your height.' : ' Add your height in Settings to see BMI reference lines.'}
      </p>
    </div>
  );
}
