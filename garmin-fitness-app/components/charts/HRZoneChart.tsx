'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import { HRZoneData } from '@/types';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };
const ZONE_COLORS = ['#334155', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444'];
const fmt = (m: number) => { const h = Math.floor(m/60); const s = m%60; return h > 0 ? `${h}h ${s}m` : `${s}m`; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ttFmt = (v: unknown, _: unknown, p: any) => [`${v}%${p?.payload?.minutes != null ? ` · ${fmt(p.payload.minutes)}` : ''}`, 'Zone time'];

export default function HRZoneChart({ data }: { data: HRZoneData[] }) {
  if (data.every(d => d.minutes === 0)) return <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">No HR data — activities recorded with heart rate monitor required</div>;
  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} domain={[0,100]} />
          <YAxis type="category" dataKey="zone" tick={{ fontSize: 9, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} width={100} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)' }} formatter={ttFmt} />
          <Bar dataKey="percentage" radius={[0,3,3,0]}>{data.map((_,i) => <Cell key={i} fill={ZONE_COLORS[i]} />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-5 gap-1">
        {data.map((d,i) => (
          <div key={i} className="text-center">
            <div className="h-0.5 rounded-full mb-1" style={{ background: ZONE_COLORS[i] }} />
            <p className="text-xs font-semibold">{d.percentage}%</p>
            <p className="text-[10px] text-muted-foreground">{fmt(d.minutes)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
