'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrainingLoad } from '@/types';
import { format, parseISO } from 'date-fns';

interface Props {
  data: TrainingLoad[];
}

export default function TrainingLoadChart({ data }: Props) {
  const recent = data.slice(-90);

  const formatted = recent.map(d => ({
    date: format(parseISO(d.date), 'MMM d'),
    'Fitness (CTL)': d.ctl,
    'Fatigue (ATL)': d.atl,
    'Form (TSB)': d.tsb,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <defs>
          <linearGradient id="ctlGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0096D6" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#0096D6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="atlGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#E30613" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#E30613" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          interval={13}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          domain={['auto', 'auto']}
        />
        <Tooltip
          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,.1)', fontSize: 12 }}
          formatter={(v: number, name: string) => [v.toFixed(1), name]}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
        <ReferenceLine y={0} stroke="#e2e8f0" />
        <Area type="monotone" dataKey="Fitness (CTL)" stroke="#0096D6" strokeWidth={2} fill="url(#ctlGrad)" dot={false} />
        <Area type="monotone" dataKey="Fatigue (ATL)" stroke="#E30613" strokeWidth={2} fill="url(#atlGrad)" dot={false} />
        <Area type="monotone" dataKey="Form (TSB)" stroke="#009E60" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 2" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
