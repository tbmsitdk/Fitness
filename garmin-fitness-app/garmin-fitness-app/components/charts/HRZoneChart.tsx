'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import { HRZoneData } from '@/types';

interface Props {
  data: HRZoneData[];
}

const ZONE_COLORS = ['#94a3b8', '#0096D6', '#009E60', '#FF6B00', '#E30613'];

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tooltipFormatter(value: unknown, _name: unknown, props: any) {
  const mins = props?.payload?.minutes as number | undefined;
  return [`${value}%${mins != null ? ` · ${formatMinutes(mins)}` : ''}`, 'Time in zone'];
}

export default function HRZoneChart({ data }: Props) {
  if (data.every(d => d.minutes === 0)) {
    return (
      <div className="h-[220px] flex items-center justify-center text-slate-400 text-sm">
        No heart rate data found — activities with HR monitor required
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}%`}
            domain={[0, 100]}
          />
          <YAxis
            type="category"
            dataKey="zone"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={110}
          />
          <Tooltip
            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,.1)', fontSize: 12 }}
            formatter={tooltipFormatter}
          />
          <Bar dataKey="percentage" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={ZONE_COLORS[i]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-5 gap-1">
        {data.map((d, i) => (
          <div key={i} className="text-center">
            <div className="w-full h-1 rounded-full mb-1" style={{ backgroundColor: ZONE_COLORS[i] }} />
            <p className="text-xs font-semibold text-slate-700">{d.percentage}%</p>
            <p className="text-xs text-slate-400">{formatMinutes(d.minutes)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
