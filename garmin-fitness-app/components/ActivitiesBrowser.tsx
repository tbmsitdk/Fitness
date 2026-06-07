'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Activity } from '@/types';
import { Button } from '@/components/ui/button';
import { X, Search } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface Props {
  activities: Activity[];
  open: boolean;
  onClose: () => void;
  onSelect: (a: Activity) => void;
}

const PAGE_SIZE = 30;

export default function ActivitiesBrowser({ activities, open, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', handler); document.body.style.overflow = ''; };
  }, [open, close]);

  // Reset paging when filters change
  useEffect(() => { setVisible(PAGE_SIZE); }, [query, typeFilter]);

  const types = useMemo(() => {
    const set = new Set(activities.map(a => a.activity_type));
    return ['all', ...Array.from(set).sort()];
  }, [activities]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...activities]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter(a => {
        if (typeFilter !== 'all' && a.activity_type !== typeFilter) return false;
        if (!q) return true;
        const dateStr = format(parseISO(a.date), 'MMM d, yyyy').toLowerCase();
        return (
          (a.title || '').toLowerCase().includes(q) ||
          a.activity_type.toLowerCase().includes(q) ||
          dateStr.includes(q)
        );
      });
  }, [activities, query, typeFilter]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0 gap-4">
        <span className="text-sm font-semibold shrink-0">All Activities</span>

        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by title, type, or date…"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-border bg-card focus:outline-none focus:ring-1 focus:ring-foreground/30"
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="text-xs rounded-md border border-border bg-card px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-foreground/30"
          >
            {types.map(t => <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>)}
          </select>
        </div>

        <Button variant="ghost" size="sm" onClick={close} className="gap-1.5 shrink-0">
          <X className="w-3.5 h-3.5" />
          <span className="text-xs">Close</span>
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-3">
        <p className="text-[10px] text-muted-foreground mb-2">{filtered.length} activities found</p>
        <div className="divide-y divide-border">
          {filtered.slice(0, visible).map(a => (
            <button
              key={a.id}
              onClick={() => onSelect(a)}
              className="w-full flex items-center justify-between py-2.5 text-left hover:bg-card/60 transition-colors px-2 -mx-2 rounded"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{a.title || a.activity_type}</p>
                <p className="text-[10px] text-muted-foreground">{format(parseISO(a.date), 'MMM d, yyyy · HH:mm')} · {a.activity_type}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-[10px] text-muted-foreground font-mono">
                <span>{a.distance_km > 0 ? `${a.distance_km.toFixed(1)} km` : ''}</span>
                <span>{Math.round(a.duration_seconds / 60)} min</span>
                {a.avg_hr != null && <span className="text-red-400">{a.avg_hr} bpm</span>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground italic py-8 text-center">No activities match your search</p>
          )}
        </div>
        {visible < filtered.length && (
          <div className="text-center pt-4">
            <Button variant="outline" size="sm" onClick={() => setVisible(v => v + PAGE_SIZE)}>
              Load more ({filtered.length - visible} remaining)
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
