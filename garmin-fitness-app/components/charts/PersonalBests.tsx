'use client';
import { PersonalBest } from '@/types';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

const SPORT_DOT: Record<string, string> = { running: 'bg-blue-500', cycling: 'bg-green-500', walking: 'bg-amber-500' };

export default function PersonalBests({ data }: { data: PersonalBest[] }) {
  if (!data.length) return <div className="h-20 flex items-center justify-center text-xs text-muted-foreground">No personal bests yet</div>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {data.map((pb, i) => (
        <div key={i} className="p-3 rounded-md border border-border bg-card/50 space-y-1">
          <div className="flex items-center gap-1.5">
            <div className={cn('w-1.5 h-1.5 rounded-full', SPORT_DOT[pb.activity_type] ?? 'bg-muted-foreground')} />
            <p className="text-[10px] text-muted-foreground truncate">{pb.label}</p>
          </div>
          <p className="text-lg font-bold font-mono tracking-tight leading-none">{pb.value}</p>
          <p className="text-[10px] text-muted-foreground">{format(parseISO(pb.date), 'MMM d, yyyy')}</p>
        </div>
      ))}
    </div>
  );
}
