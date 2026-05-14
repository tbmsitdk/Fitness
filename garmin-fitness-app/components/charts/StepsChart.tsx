'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { WellnessRecord } from '@/types';
import { format, parseISO } from 'date-fns';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

export default function StepsChart({ wellness }: { wellness: WellnessRecord[] }) {
  const data = wellness.filter(w => (w.steps ?? 0) > 0).slice(-60).map(w => ({
    date: format(parseISO(w.date), 'MMM d'), Steps: w.steps ?? 0,
  }));
  if (!data.length) return <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">No steps data in export</div>;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={9} />
        <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${(v/1000).toFixed(0)}k`} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)' }} formatter={(v: number) => [v.toLocaleString(), 'Steps']} />
        <ReferenceLine y={10000} stroke="#22C55E" strokeDasharray="4 2" strokeWidth={1} label={{ value: '10k', position: 'right', fontSize: 9, fill: '#22C55E' }} />
        <Bar dataKey="Steps" fill="#3B82F6" fillOpacity={0.7} radius={[2,2,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
