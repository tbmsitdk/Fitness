'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { WeeklyVolume } from '@/types';
import { format, parseISO } from 'date-fns';

interface Props {
  data: WeeklyVolume[];
  metric: 'km' | 'hours';
}

const COLORS = {
  running: '#009E60',
  cycling: '#0096D6',
  walking: '#FF6B00',
};

export default function WeeklyVolumeChart({ data, metric }: Props) {
  const displayData = data.slice(-26); // last 26 weeks

  const formatted = displayData.map(d => ({
    week: format(parseISO(d.week), 'MMM d'),
    Running: metric === 'km' ? Math.round(d.running_km * 10) / 10 : Math.round(d.running_hours * 10) / 10,
    Cycling: metric === 'km' ? Math.round(d.cycling_km * 10) / 10 : Math.round(d.cycling_hours * 10) / 10,
    Walking: metric === 'km' ? Math.round(d.walking_km * 10) / 10 : Math.round(d.walking_hours * 10) / 10,
  }));

  const unit = metric === 'km' ? 'km' : 'h';

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="week"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          interval={3}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => `${v}${unit}`}
        />
        <Tooltip
          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,.1)', fontSize: 12 }}
          formatter={(v: number, name: string) => [`${v} ${unit}`, name]}
          labelStyle={{ fontWeight: 600, marginBottom: 4 }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          iconType="circle"
          iconSize={8}
        />
        <Bar dataKey="Running" stackId="a" fill={COLORS.running} radius={[0, 0, 0, 0]} />
        <Bar dataKey="Cycling" stackId="a" fill={COLORS.cycling} radius={[0, 0, 0, 0]} />
        <Bar dataKey="Walking" stackId="a" fill={COLORS.walking} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
