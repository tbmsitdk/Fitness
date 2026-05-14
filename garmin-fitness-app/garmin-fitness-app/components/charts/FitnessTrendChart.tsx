'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { WellnessRecord } from '@/types';
import { format, parseISO } from 'date-fns';

interface Props {
  wellness: WellnessRecord[];
  metric: 'hrv' | 'rhr' | 'sleep';
}

const CONFIG = {
  hrv:   { key: 'hrv_rmssd'  as keyof WellnessRecord, label: 'HRV (rmssd)', color: '#7B2D8B', unit: 'ms' },
  rhr:   { key: 'resting_hr' as keyof WellnessRecord, label: 'Resting HR',  color: '#E30613', unit: 'bpm' },
  sleep: { key: 'sleep_hours' as keyof WellnessRecord, label: 'Sleep',      color: '#0096D6', unit: 'h' },
};

export default function FitnessTrendChart({ wellness, metric }: Props) {
  const cfg = CONFIG[metric];

  const data = wellness
    .filter(w => w[cfg.key] != null)
    .slice(-90)
    .map(w => {
      const raw = w[cfg.key];
      const value = typeof raw === 'number' ? raw : null;
      return {
        date: format(parseISO(w.date), 'MMM d'),
        [cfg.label]: value,
      };
    })
    .filter(d => d[cfg.label] != null);

  if (data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-slate-400 text-sm">
        No {cfg.label} data in your export
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
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
          tickFormatter={(v: number) => `${v}${cfg.unit}`}
        />
        <Tooltip
          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,.1)', fontSize: 12 }}
          formatter={(v: number) => [`${v} ${cfg.unit}`, cfg.label]}
        />
        <Line
          type="monotone"
          dataKey={cfg.label}
          stroke={cfg.color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
