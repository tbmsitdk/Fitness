'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ConsistencyData } from '@/types';
import { format, parseISO } from 'date-fns';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };
interface Row { month: string; 'Running': number; 'Cycling': number; 'Walking': number; pct: number; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const labelFmt = (label: string, payload: any[]) => { const pct = payload?.[0]?.payload?.pct; return `${label}${pct != null ? ` · ${pct}% active` : ''}`; };

export default function ConsistencyChart({ data }: { data: ConsistencyData[] }) {
  const rows: Row[] = data.slice(-12).map(d => ({
    month: format(parseISO(d.month + '-01'), 'MMM yy'),
    Running: d.running_days, Cycling: d.cycling_days, Walking: d.walking_days,
    pct: Math.round((d.active_days / d.total_days) * 100),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }} labelFormatter={labelFmt} />
        <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(240 5% 64.9%)', paddingTop: 8 }} iconType="circle" iconSize={6} />
        <Bar dataKey="Running" fill="#3B82F6" radius={[2,2,0,0]} />
        <Bar dataKey="Cycling" fill="#22C55E" radius={[2,2,0,0]} />
        <Bar dataKey="Walking" fill="#F59E0B" radius={[2,2,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
