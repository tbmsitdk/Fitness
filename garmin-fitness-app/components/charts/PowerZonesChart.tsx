'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Activity } from '@/types';
import { useMemo } from 'react';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

// Standard 6-zone power model (Andy Coggan)
const ZONES = [
  { label: 'Z1 Active Recovery', maxPct: 0.55, color: '#6B7280' },
  { label: 'Z2 Endurance',       maxPct: 0.75, color: '#3B82F6' },
  { label: 'Z3 Tempo',           maxPct: 0.90, color: '#22C55E' },
  { label: 'Z4 Threshold',       maxPct: 1.05, color: '#F59E0B' },
  { label: 'Z5 VO2max',          maxPct: 1.20, color: '#EF4444' },
  { label: 'Z6 Anaerobic',       maxPct: Infinity, color: '#8B5CF6' },
];

function getZone(power: number, ftp: number): number {
  const pct = power / ftp;
  return ZONES.findIndex(z => pct < z.maxPct);
}

export default function PowerZonesChart({ activities, ftp }: { activities: Activity[]; ftp: number }) {
  const data = useMemo(() => {
    const seconds = new Array(6).fill(0);

    for (const a of activities) {
      if (a.activity_type !== 'cycling' || !a.avg_power || !a.duration_seconds) continue;
      // Approximate zone distribution from avg_power and NP
      // Without lap data we use avg_power to classify the ride's dominant zone
      // Weight: use duration_seconds as the contribution
      const z = getZone(a.avg_power, ftp);
      if (z >= 0) seconds[z] += a.duration_seconds;
    }

    const total = seconds.reduce((s, v) => s + v, 0) || 1;
    return ZONES.map((z, i) => ({
      zone: z.label.split(' ')[0],       // "Z1", "Z2" etc.
      label: z.label,
      minutes: Math.round(seconds[i] / 60),
      percentage: Math.round((seconds[i] / total) * 100),
      color: z.color,
    }));
  }, [activities, ftp]);

  const totalHours = (data.reduce((s, d) => s + d.minutes, 0) / 60).toFixed(1);

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false}
            axisLine={false} tickFormatter={v => `${v}%`} domain={[0, 100]} />
          <YAxis type="category" dataKey="zone" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }}
            tickLine={false} axisLine={false} width={28} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
            formatter={(v: number, _: string, props) => [
              `${props.payload.minutes} min (${v}%)`,
              props.payload.label,
            ]} />
          <Bar dataKey="percentage" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
        Based on est. FTP {ftp}W (Coggan 6-zone model). Total {totalHours}h classified cycling in period.
      </p>
    </div>
  );
}
