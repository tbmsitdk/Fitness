'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { WellnessRecord } from '@/types';
import { format, parseISO } from 'date-fns';

interface Props {
  wellness: WellnessRecord[];
}

export default function StepsChart({ wellness }: Props) {
  const data = wellness
    .filter(w => w.steps != null && w.steps > 0)
    .slice(-60)
    .map(w => ({
      date: format(parseISO(w.date), 'MMM d'),
      Steps: w.steps ?? 0,
    }));

  if (data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">
        No steps data in your export
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          interval={9}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,.1)', fontSize: 12 }}
          formatter={(v: number) => [v.toLocaleString(), 'Steps']}
        />
        <ReferenceLine y={10000} stroke="#009E60" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: '10k goal', position: 'right', fontSize: 10, fill: '#009E60' }} />
        <Bar dataKey="Steps" fill="#0096D6" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
