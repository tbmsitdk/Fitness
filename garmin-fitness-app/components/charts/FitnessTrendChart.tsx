'use client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { WellnessRecord } from '@/types';
import { format, parseISO } from 'date-fns';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

const CONFIG = {
  hrv:   { key: 'hrv_rmssd'  as keyof WellnessRecord, label: 'HRV', color: '#8B5CF6', unit: 'ms' },
  rhr:   { key: 'resting_hr' as keyof WellnessRecord, label: 'Resting HR', color: '#EF4444', unit: 'bpm' },
  sleep: { key: 'sleep_hours' as keyof WellnessRecord, label: 'Sleep', color: '#3B82F6', unit: 'h' },
};

export default function FitnessTrendChart({ wellness, metric }: { wellness: WellnessRecord[]; metric: 'hrv' | 'rhr' | 'sleep' }) {
  const cfg = CONFIG[metric];
  const data = wellness.filter(w => w[cfg.key] != null).slice(-90).map(w => {
    const raw = w[cfg.key];
    return { date: format(parseISO(w.date), 'MMM d'), [cfg.label]: typeof raw === 'number' ? raw : null };
  }).filter(d => d[cfg.label] != null);

  if (!data.length) return <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">No {cfg.label} data in export</div>;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} interval={13} />
        <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} domain={['auto','auto']} tickFormatter={(v: number) => `${v}`} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)' }} formatter={(v: number) => [`${v} ${cfg.unit}`, cfg.label]} />
        <Line type="monotone" dataKey={cfg.label} stroke={cfg.color} strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: cfg.color }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
