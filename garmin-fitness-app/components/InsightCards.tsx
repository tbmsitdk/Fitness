'use client';
import { useEffect, useState } from 'react';
import { useDataVersion } from '@/lib/data-refresh';
import { cn } from '@/lib/utils';

interface InsightCard {
  id: string;
  type: 'positive' | 'warning' | 'neutral' | 'milestone';
  headline: string;
  body: string;
  icon: string;
}

const typeStyles: Record<InsightCard['type'], string> = {
  positive:  'border-green-500/30 bg-green-500/5',
  warning:   'border-amber-500/30 bg-amber-500/5',
  neutral:   'border-border bg-card',
  milestone: 'border-purple-500/30 bg-purple-500/5',
};

const typeDots: Record<InsightCard['type'], string> = {
  positive:  'bg-green-500',
  warning:   'bg-amber-500',
  neutral:   'bg-blue-400',
  milestone: 'bg-purple-500',
};

export default function InsightCards() {
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const dataVersion = useDataVersion();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/insights?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        setInsights(data.insights ?? []);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [dataVersion]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0,1,2,3].map(i => (
          <div key={i} className="h-24 rounded-lg border border-border bg-card animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || insights.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {insights.map(card => (
        <div
          key={card.id}
          className={cn(
            'rounded-lg border p-3 space-y-1.5 relative overflow-hidden',
            typeStyles[card.type]
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">{card.icon}</span>
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', typeDots[card.type])} />
          </div>
          <p className="text-xs font-semibold leading-tight">{card.headline}</p>
          <p className="text-[10px] text-muted-foreground leading-tight">{card.body}</p>
        </div>
      ))}
    </div>
  );
}
