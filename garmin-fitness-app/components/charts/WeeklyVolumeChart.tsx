'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { WeeklyVolume } from '@/types';
import { format, parseISO } from 'date-fns';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

export default function WeeklyVolumeChart({ data, metric }: { data: WeeklyVolume[]; metric: 'km' | 'hours' }) {
  const unit = metric === 'km' ? 'km' : 'h';
  const display = data.slice(-26).map(d => ({
    week: format(parseISO(d.week), 'MMM d'),
    Running: metric === 'km' ? Math.round(d.running_km * 10) / 10 : Math.round(d.running_hours * 10) / 10,
    Cycling: metric === 'km' ? Math.round(d.cycling_km * 10) / 10 : Math.round(d.cycling_hours * 10) / 10,
    Walking: metric === 'km' ? Math.round(d.walking_km * 10) / 10 : Math.round(d.walking_hours * 10) / 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={display} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
        <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={4} />
        <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}${unit}`} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }} formatter={(v: number, n: string) => [`${v} ${unit}`, n]} />
        <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(240 5% 64.9%)', paddingTop: 8 }} iconType="circle" iconSize={6} />
        <Bar dataKey="Running" stackId="a" fill="#3B82F6" radius={[0,0,0,0]} />
        <Bar dataKey="Cycling" stackId="a" fill="#22C55E" radius={[0,0,0,0]} />
        <Bar dataKey="Walking" stackId="a" fill="#F59E0B" radius={[3,3,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
