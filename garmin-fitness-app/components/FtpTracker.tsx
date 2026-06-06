'use client';

import { useState } from 'react';
import { FtpEntry } from '@/types';
import { format, parseISO } from 'date-fns';
import { Trash2 } from 'lucide-react';

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

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const w = parseInt(watts, 10);
    if (!date || isNaN(w) || w <= 0) { setError('Enter a valid date and watts value.'); return; }
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
    <div className="space-y-4">
      {/* Current FTP badge + form */}
      <div className="flex flex-wrap gap-4 items-end">
        {/* Current FTP */}
        <div className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/10 space-y-0.5 shrink-0">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Current FTP</p>
          <p className="text-2xl font-bold font-mono text-blue-400">
            {latest ? `${latest.ftp_watts}W` : '—'}
          </p>
          {latest && (
            <p className="text-[10px] text-muted-foreground">
              {format(parseISO(latest.date), 'MMM d, yyyy')}
            </p>
          )}
        </div>

        {/* Input form */}
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 flex-1">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] tracking-widest uppercase text-muted-foreground">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="bg-card border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/30"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] tracking-widest uppercase text-muted-foreground">Watts</label>
            <input
              type="number"
              min={50}
              max={600}
              placeholder="e.g. 250"
              value={watts}
              onChange={e => setWatts(e.target.value)}
              className="bg-card border border-border rounded-md px-3 py-1.5 text-xs text-foreground w-28 focus:outline-none focus:ring-1 focus:ring-foreground/30"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
            <label className="text-[10px] tracking-widest uppercase text-muted-foreground">Note (optional)</label>
            <input
              type="text"
              placeholder="e.g. Zwift ramp test"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="bg-card border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/30"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-80 disabled:opacity-40 transition-opacity"
          >
            {saving ? 'Saving…' : '+ Add'}
          </button>
          {error && <p className="text-[11px] text-red-400 w-full">{error}</p>}
        </form>
      </div>

      {/* Entry table */}
      {sorted.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Date</th>
                <th className="text-right px-3 py-2 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">FTP</th>
                <th className="text-left px-3 py-2 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Note</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {[...sorted].reverse().map(entry => (
                <tr key={entry.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 text-muted-foreground">
                    {format(parseISO(entry.date), 'MMM d, yyyy')}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-foreground">
                    {entry.ftp_watts}W
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{entry.note ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="text-muted-foreground/30 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
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
