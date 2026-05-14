'use client';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { TrainingLoad } from '@/types';
import { format, parseISO } from 'date-fns';
import { getPeerBenchmarks } from '@/lib/benchmarks';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

export default function TrainingLoadChart({ data }: { data: TrainingLoad[] }) {
  const bench = getPeerBenchmarks();
  const tickInterval = Math.max(1, Math.floor(data.length / 10));

  const display = data.map(d => ({
    date: format(parseISO(d.date), 'MMM d'),
    'Fitness (CTL)': d.ctl,
    'Fatigue (ATL)': d.atl,
    'Form (TSB)': d.tsb,
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
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
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={tickInterval} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} domain={['auto','auto']} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }} formatter={(v: number, n: string) => [v.toFixed(1), n]} />
          <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(240 5% 64.9%)', paddingTop: 8 }} iconType="circle" iconSize={6} />
          {/* Age-adjusted peer CTL band */}
          <ReferenceArea y1={bench.ctlMin} y2={bench.ctlMax} fill="hsl(217 91% 60%)" fillOpacity={0.07} />
          <ReferenceLine y={bench.ctlMin} stroke="hsl(217 91% 60%)" strokeDasharray="4 3" strokeWidth={1}
            label={{ value: `Age ${bench.label} peer CTL ${bench.ctlMin}`, position: 'insideTopLeft', fontSize: 9, fill: 'hsl(217 91% 60%)' }} />
          <ReferenceLine y={bench.ctlMax} stroke="hsl(217 91% 60%)" strokeDasharray="4 3" strokeWidth={1}
            label={{ value: `Age ${bench.label} peer CTL ${bench.ctlMax}`, position: 'insideTopLeft', fontSize: 9, fill: 'hsl(217 91% 60%)' }} />
          <ReferenceLine y={0} stroke="hsl(240 3.7% 20%)" />
          <Area type="monotone" dataKey="Fitness (CTL)" stroke="#3B82F6" strokeWidth={1.5} fill="url(#ctlG)" dot={false} />
          <Area type="monotone" dataKey="Fatigue (ATL)" stroke="#EF4444" strokeWidth={1.5} fill="url(#atlG)" dot={false} />
          <Area type="monotone" dataKey="Form (TSB)" stroke="#22C55E" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 2" />
        </AreaChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">Blue band = peer CTL range for age {bench.label} ({bench.ctlMin}–{bench.ctlMax}). Updates automatically on your birthday.</p>
    </div>
  );
}
