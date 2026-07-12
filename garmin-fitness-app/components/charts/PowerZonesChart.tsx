'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

// Standard 6-zone power model (Andy Coggan)
const ZONES = [
  { label: 'Z1 Active Recovery', color: '#6B7280' },
  { label: 'Z2 Endurance',       color: '#3B82F6' },
  { label: 'Z3 Tempo',           color: '#22C55E' },
  { label: 'Z4 Threshold',       color: '#F59E0B' },
  { label: 'Z5 VO2max',          color: '#EF4444' },
  { label: 'Z6 Anaerobic',       color: '#8B5CF6' },
];

interface ZoneResponse {
  seconds: number[];
  sampledHours: number;
  approxHours: number;
}

interface Props {
  ftp: number;
  cutoff: Date;
  minCyclingPower?: number | null;
  height?: number;
}

export default function PowerZonesChart({ ftp, cutoff, minCyclingPower, height = 220 }: Props) {
  const [resp, setResp] = useState<ZoneResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResp(null);
    setError(false);
    const params = new URLSearchParams({
      ftp: String(ftp),
      cutoff: cutoff.toISOString(),
      minPower: String(minCyclingPower ?? 0),
    });
    fetch(`/api/power-zones?${params}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: ZoneResponse) => { if (!cancelled) setResp(data); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [ftp, cutoff, minCyclingPower]);

  if (error) {
    return <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Could not load zone distribution</div>;
  }
  if (!resp) {
    return <div className="h-32 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  }

  const total = resp.seconds.reduce((s, v) => s + v, 0) || 1;
  const data = ZONES.map((z, i) => ({
    zone: z.label.split(' ')[0],
    label: z.label,
    minutes: Math.round(resp.seconds[i] / 60),
    percentage: Math.round((resp.seconds[i] / total) * 100),
    color: z.color,
  }));

  const totalHours = (total / 3600).toFixed(1);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
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
        Based on est. FTP {ftp}W (Coggan 6-zone model). {totalHours}h classified —
        {' '}{resp.sampledHours}h from per-second power data
        {resp.approxHours > 0 && `, ${resp.approxHours}h approximated from ride averages`}.
      </p>
    </div>
  );
}
