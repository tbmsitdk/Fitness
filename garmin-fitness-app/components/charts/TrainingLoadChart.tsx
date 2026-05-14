'use client';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrainingLoad } from '@/types';
import { format, parseISO } from 'date-fns';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

export default function TrainingLoadChart({ data }: { data: TrainingLoad[] }) {
  const display = data.slice(-90).map(d => ({
    date: format(parseISO(d.date), 'MMM d'),
    'Fitness (CTL)': d.ctl,
    'Fatigue (ATL)': d.atl,
    'Form (TSB)': d.tsb,
  }));
  return (
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
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={13} />
        <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} domain={['auto','auto']} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }} formatter={(v: number, n: string) => [v.toFixed(1), n]} />
        <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(240 5% 64.9%)', paddingTop: 8 }} iconType="circle" iconSize={6} />
        <ReferenceLine y={0} stroke="hsl(240 3.7% 20%)" />
        <Area type="monotone" dataKey="Fitness (CTL)" stroke="#3B82F6" strokeWidth={1.5} fill="url(#ctlG)" dot={false} />
        <Area type="monotone" dataKey="Fatigue (ATL)" stroke="#EF4444" strokeWidth={1.5} fill="url(#atlG)" dot={false} />
        <Area type="monotone" dataKey="Form (TSB)" stroke="#22C55E" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 2" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
