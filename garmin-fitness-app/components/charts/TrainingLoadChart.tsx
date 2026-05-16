'use client';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ReferenceArea, ReferenceDot,
} from 'recharts';
import { TrainingLoadForecast } from '@/lib/training-load';
import { format, parseISO } from 'date-fns';
import { getPeerBenchmarks } from '@/lib/benchmarks';

const TOOLTIP_STYLE = {
  background: 'hsl(240 10% 7%)',
  border: '1px solid hsl(240 3.7% 13%)',
  borderRadius: '8px',
  fontSize: 11,
};

export default function TrainingLoadChart({
  data,
  height = 240,
}: {
  data: TrainingLoadForecast[];
  height?: number;
}) {
  const bench = getPeerBenchmarks();

  // Find projected peak TSB date
  const projected = data.filter(d => d.projected);
  const peakTSB = projected.length > 0
    ? projected.reduce((best, d) => d.tsb > best.tsb ? d : best, projected[0])
    : null;

  const spanYears = new Set(data.map(d => d.date.substring(0, 4))).size > 1;
  const dateFmt = spanYears ? "MMM ''yy" : 'MMM d';
  const tickInterval = Math.max(1, Math.floor(data.length / 10));

  const display = data.map(d => ({
    date: format(parseISO(d.date), dateFmt),
    rawDate: d.date,
    projected: d.projected,
    'Fitness (CTL)': d.ctl,
    'Fatigue (ATL)': d.atl,
    'Form (TSB)': d.tsb,
    // Separate keys for projected vs actual so we can style them differently
    'CTL proj': d.projected ? d.ctl : null,
    'ATL proj': d.projected ? d.atl : null,
    'TSB proj': d.projected ? d.tsb : null,
    'CTL hist': !d.projected ? d.ctl : null,
    'ATL hist': !d.projected ? d.atl : null,
    'TSB hist': !d.projected ? d.tsb : null,
  }));

  // Find index of peak TSB in display for ReferenceDot
  const peakIdx = peakTSB
    ? display.findIndex(d => d.rawDate === peakTSB.date)
    : -1;

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={display} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="ctlG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="atlG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#EF4444" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="ctlProjG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.08} />
              <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="atlProjG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#EF4444" stopOpacity={0.08} />
              <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
            </linearGradient>
          </defs>
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
            allowDataOverflow={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: unknown, n: string) => [
              v == null ? '—' : (typeof v === 'number' ? v.toFixed(1) : String(v)),
              n.replace(' hist', '').replace(' proj', ' (forecast)'),
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: 'hsl(240 5% 64.9%)', paddingTop: 8 }}
            iconType="circle"
            iconSize={6}
            formatter={(value) => value.replace(' hist', '').replace(' proj', ' (forecast)')}
          />

          {/* Age-adjusted peer CTL band */}
          <ReferenceArea y1={bench.ctlMin} y2={bench.ctlMax} fill="hsl(217 91% 60%)" fillOpacity={0.07} />
          <ReferenceLine y={bench.ctlMin} stroke="hsl(217 91% 60%)" strokeDasharray="4 3" strokeWidth={1}
            label={{ value: `Age ${bench.label} peer CTL ${bench.ctlMin}`, position: 'insideTopLeft', fontSize: 9, fill: 'hsl(217 91% 60%)' }} />
          <ReferenceLine y={bench.ctlMax} stroke="hsl(217 91% 60%)" strokeDasharray="4 3" strokeWidth={1}
            label={{ value: `Age ${bench.label} peer CTL ${bench.ctlMax}`, position: 'insideTopLeft', fontSize: 9, fill: 'hsl(217 91% 60%)' }} />
          <ReferenceLine y={0} stroke="hsl(240 3.7% 20%)" />

          {/* Historical data — solid */}
          <Area type="monotone" dataKey="CTL hist" name="Fitness (CTL)" stroke="#3B82F6" strokeWidth={1.5} fill="url(#ctlG)" dot={false} connectNulls />
          <Area type="monotone" dataKey="ATL hist" name="Fatigue (ATL)" stroke="#EF4444" strokeWidth={1.5} fill="url(#atlG)" dot={false} connectNulls />
          <Area type="monotone" dataKey="TSB hist" name="Form (TSB)" stroke="#22C55E" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 2" connectNulls />

          {/* Forecast — dashed / lighter */}
          <Area type="monotone" dataKey="CTL proj" name="CTL proj" stroke="#3B82F6" strokeWidth={1} strokeDasharray="5 3" fill="url(#ctlProjG)" dot={false} connectNulls strokeOpacity={0.6} />
          <Area type="monotone" dataKey="ATL proj" name="ATL proj" stroke="#EF4444" strokeWidth={1} strokeDasharray="5 3" fill="url(#atlProjG)" dot={false} connectNulls strokeOpacity={0.6} />
          <Area type="monotone" dataKey="TSB proj" name="TSB proj" stroke="#22C55E" strokeWidth={1} strokeDasharray="5 3" fill="none" dot={false} connectNulls strokeOpacity={0.6} />

          {/* Peak form marker */}
          {peakIdx >= 0 && peakTSB && (
            <ReferenceDot
              x={display[peakIdx].date}
              y={peakTSB.tsb}
              r={5}
              fill="#FBBF24"
              stroke="#92400E"
              strokeWidth={1}
              label={{ value: `Peak form ${format(parseISO(peakTSB.date), 'MMM d')}`, position: 'top', fontSize: 9, fill: '#FBBF24' }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[10px] text-muted-foreground/60 italic">
        <span>Blue band = peer CTL range for age {bench.label} ({bench.ctlMin}–{bench.ctlMax})</span>
        {peakTSB && (
          <span className="text-amber-400">★ Peak form forecast: {format(parseISO(peakTSB.date), 'MMM d')} (TSB {peakTSB.tsb.toFixed(1)})</span>
        )}
        <span>Dashed = 14-day forecast (assumes recent training pace continues)</span>
      </div>
    </div>
  );
}
