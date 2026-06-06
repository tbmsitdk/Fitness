'use client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { FtpEntry } from '@/types';
import { format, parseISO } from 'date-fns';

const TOOLTIP_STYLE = { background: 'hsl(240 10% 7%)', border: '1px solid hsl(240 3.7% 13%)', borderRadius: '8px', fontSize: 11 };

export default function FtpHistoryChart({ entries, height = 220 }: { entries: FtpEntry[]; height?: number }) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        No FTP entries yet — add them in Settings.
      </div>
    );
  }

  if (sorted.length === 1) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        Add at least 2 entries in Settings to see the trend.
      </div>
    );
  }

  const data = sorted.map(e => ({
    date: format(parseISO(e.date), 'MMM d, yy'),
    FTP: e.ftp_watts,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 3.7% 13%)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: 'hsl(240 5% 64.9%)' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} tickFormatter={(v: number) => `${v}W`} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'hsl(0 0% 98%)', marginBottom: 4 }}
          formatter={(v: number) => [`${v}W`, 'FTP']}
        />
        {latest && (
          <ReferenceLine y={latest.ftp_watts} stroke="#60A5FA" strokeWidth={1} strokeDasharray="6 3"
            label={{ value: `Current: ${latest.ftp_watts}W`, position: 'insideTopRight', fontSize: 9, fill: '#60A5FA' }}
          />
        )}
        <Line type="monotone" dataKey="FTP" stroke="#60A5FA" strokeWidth={2.5} dot={{ r: 3, fill: '#60A5FA', strokeWidth: 0 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
