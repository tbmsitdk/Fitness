'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ConsistencyData } from '@/types';
import { format, parseISO } from 'date-fns';

interface Props {
  data: ConsistencyData[];
}

interface ChartRow {
  month: string;
  'Running days': number;
  'Cycling days': number;
  'Walking days': number;
  pct: number;
}

export default function ConsistencyChart({ data }: Props) {
  const recent = data.slice(-12);

  const formatted: ChartRow[] = recent.map(d => ({
    month: format(parseISO(d.month + '-01'), 'MMM yy'),
    'Running days': d.running_days,
    'Cycling days': d.cycling_days,
    'Walking days': d.walking_days,
    pct: Math.round((d.active_days / d.total_days) * 100),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function labelFormatter(label: string, payload: any[]) {
    const pct = payload?.[0]?.payload?.pct as number | undefined;
    return `${label}${pct != null ? ` · ${pct}% active` : ''}`;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,.1)', fontSize: 12 }}
          labelFormatter={labelFormatter}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
        <Bar dataKey="Running days" fill="#009E60" radius={[2, 2, 0, 0]} />
        <Bar dataKey="Cycling days" fill="#0096D6" radius={[2, 2, 0, 0]} />
        <Bar dataKey="Walking days" fill="#FF6B00" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
