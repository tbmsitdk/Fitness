'use client';
import { WellnessRecord } from '@/types';
import { HeartPulse, Heart, Moon, BatteryMedium } from 'lucide-react';
import { cn } from '@/lib/utils';
import { computeReadiness } from '@/lib/readiness';

interface Props {
  wellness: WellnessRecord[];
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  hrv: HeartPulse,
  rhr: Heart,
  sleep: Moon,
  battery: BatteryMedium,
};

export default function ReadinessScore({ wellness }: Props) {
  const sorted = [...wellness].sort((a, b) => a.date.localeCompare(b.date));
  const result = computeReadiness(sorted);
  if (!result) return null;

  const { overall, band, factors } = result;

  return (
    <div className={cn('rounded-lg border p-4', band.border, band.bg)}>
      <div className="flex items-center gap-4">
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span className={cn('text-3xl font-bold font-mono tracking-tight', band.color)}>{overall}</span>
          <span className="text-xs text-muted-foreground">/ 100</span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn('w-1.5 h-1.5 rounded-full', band.dot)} />
            <p className={cn('text-sm font-semibold', band.color)}>{band.label}</p>
          </div>
          <p className="text-[10px] text-muted-foreground">{band.sub}</p>
        </div>
        <div className="ml-auto grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
          {factors.map(f => {
            const Icon = ICONS[f.key] ?? BatteryMedium;
            return (
              <div key={f.key} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Icon className="w-3.5 h-3.5" />
                <span className="whitespace-nowrap">{f.detail}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
