'use client';

import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { FtpEntry } from '@/types';
import { format, parseISO } from 'date-fns';
import { Plus, Trash2, Zap } from 'lucide-react';

interface Props {
  entries: FtpEntry[];
  onEntriesChange: (entries: FtpEntry[]) => void;
}

export default function FtpTracker({ entries, onEntriesChange }: Props) {
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [watts, setWatts] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];

  const chartData = sorted.map(e => ({
    date: format(parseISO(e.date), 'MMM d, yy'),
    FTP: e.ftp_watts,
    id: e.id,
    fullDate: e.date,
  }));

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const w = parseInt(watts, 10);
    if (!date || isNaN(w) || w <= 0) {
      setError('Enter a valid date and watts value.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/ftp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, ftp_watts: w, note: note.trim() || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      const newEntry: FtpEntry = await res.json();
      onEntriesChange([...entries, newEntry]);
      setWatts('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await fetch('/api/ftp', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await res.text());
      onEntriesChange(entries.filter(e => e.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  return (
    <div className="space-y-6">
      {/* Current FTP + add form */}
      <div className="flex flex-col sm:flex-row gap-6">
        {/* Current FTP badge */}
        <div className="flex items-center gap-4 bg-blue-50 rounded-2xl px-6 py-4 min-w-[160px]">
          <div className="w-10 h-10 rounded-xl bg-garmin-blue flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Current FTP</p>
            <p className="text-2xl font-bold text-slate-900 leading-none mt-0.5">
              {latest ? `${latest.ftp_watts} W` : '—'}
            </p>
            {latest && (
              <p className="text-xs text-slate-400 mt-0.5">
                {format(parseISO(latest.date), 'MMM d, yyyy')}
              </p>
            )}
          </div>
        </div>

        {/* Add entry form */}
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 flex-1">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-garmin-blue"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">FTP (watts)</label>
            <input
              type="number"
              min={50}
              max={600}
              placeholder="e.g. 250"
              value={watts}
              onChange={e => setWatts(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-garmin-blue"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
            <label className="text-xs font-medium text-slate-600">Note (optional)</label>
            <input
              type="text"
              placeholder="e.g. Zwift ramp test"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-garmin-blue"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-garmin-blue text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {saving ? 'Saving…' : 'Add'}
          </button>
          {error && <p className="text-xs text-red-500 w-full">{error}</p>}
        </form>
      </div>

      {/* Chart */}
      {chartData.length >= 2 ? (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => `${v}W`}
            />
            <Tooltip
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,.1)', fontSize: 12 }}
              formatter={(v: number) => [`${v} W`, 'FTP']}
            />
            {latest && (
              <ReferenceLine
                y={latest.ftp_watts}
                stroke="#0096D6"
                strokeDasharray="4 4"
                label={{ value: `Current: ${latest.ftp_watts}W`, position: 'insideTopRight', fontSize: 11, fill: '#0096D6' }}
              />
            )}
            <Line
              type="monotone"
              dataKey="FTP"
              stroke="#0096D6"
              strokeWidth={2.5}
              dot={{ r: 4, fill: '#0096D6', strokeWidth: 0 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : chartData.length === 1 ? (
        <div className="h-[220px] flex items-center justify-center text-slate-400 text-sm">
          Add at least 2 entries to see the trend chart.
        </div>
      ) : (
        <div className="h-[220px] flex items-center justify-center text-slate-400 text-sm">
          No FTP entries yet — add your first one above.
        </div>
      )}

      {/* Entry list */}
      {sorted.length > 0 && (
        <div className="border border-slate-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 font-medium">
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-right px-4 py-2">FTP (W)</th>
                <th className="text-left px-4 py-2">Note</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {[...sorted].reverse().map((entry, i) => (
                <tr key={entry.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                  <td className="px-4 py-2 text-slate-700">
                    {format(parseISO(entry.date), 'MMM d, yyyy')}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-slate-900">
                    {entry.ftp_watts}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{entry.note ?? '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="text-slate-300 hover:text-red-500 transition-colors"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
