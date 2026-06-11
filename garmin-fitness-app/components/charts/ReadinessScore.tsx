'use client';
import { WellnessRecord } from '@/types';
import { HeartPulse, Heart, Moon, BatteryMedium } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  wellness: WellnessRecord[];
}

interface Factor {
  key: string;
  label: string;
  icon: React.ReactNode;
  score: number; // 0-100
  detail: string;
}

const avg = (vals: number[]): number => vals.reduce((a, b) => a + b, 0) / vals.length;
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

const BAND = (score: number) => {
  if (score >= 75) return { label: 'Primed',   sub: 'Good day for a hard session', color: 'text-green-400', border: 'border-green-500/30', bg: 'bg-green-500/10', dot: 'bg-green-500' };
  if (score >= 55) return { label: 'Ready',    sub: 'Normal training is fine',     color: 'text-blue-400',  border: 'border-blue-500/30',  bg: 'bg-blue-500/10',  dot: 'bg-blue-500' };
  if (score >= 35) return { label: 'Maintain', sub: 'Keep it easy or moderate',    color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10', dot: 'bg-amber-500' };
  return               { label: 'Rest',     sub: 'Recovery day recommended',    color: 'text-red-400',   border: 'border-red-500/30',   bg: 'bg-red-500/10',   dot: 'bg-red-500' };
};

export default function ReadinessScore({ wellness }: Props) {
  const sorted = [...wellness]
    .filter(w => w.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length < 8) return null;

  const today = sorted[sorted.length - 1];
  const baselineWindow = sorted.slice(-31, -1); // last 30 days, excluding today

  const factors: Factor[] = [];

  // HRV — higher is better
  const hrvBaseline = baselineWindow.map(w => w.hrv_rmssd).filter((v): v is number => v != null);
  if (today.hrv_rmssd != null && hrvBaseline.length >= 5) {
    const base = avg(hrvBaseline);
    const pctDiff = base > 0 ? ((today.hrv_rmssd - base) / base) * 100 : 0;
    factors.push({
      key: 'hrv', label: 'HRV', icon: <HeartPulse className="w-3.5 h-3.5" />,
      score: clamp(50 + pctDiff * 2.5),
      detail: `${today.hrv_rmssd} ms · ${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(0)}% vs 30d`,
    });
  }

  // Resting HR — lower is better
  const rhrBaseline = baselineWindow.map(w => w.resting_hr).filter((v): v is number => v != null);
  if (today.resting_hr != null && rhrBaseline.length >= 5) {
    const base = avg(rhrBaseline);
    const pctDiff = base > 0 ? ((base - today.resting_hr) / base) * 100 : 0;
    factors.push({
      key: 'rhr', label: 'Resting HR', icon: <Heart className="w-3.5 h-3.5" />,
      score: clamp(50 + pctDiff * 5),
      detail: `${today.resting_hr} bpm · ${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(1)}% vs 30d`,
    });
  }

  // Sleep — prefer Garmin's sleep_score (already 0-100), fall back to hours / 8h target
  if (today.sleep_score != null) {
    factors.push({
      key: 'sleep', label: 'Sleep', icon: <Moon className="w-3.5 h-3.5" />,
      score: clamp(today.sleep_score),
      detail: `Sleep score ${today.sleep_score}${today.sleep_hours != null ? ` · ${today.sleep_hours.toFixed(1)}h` : ''}`,
    });
  } else if (today.sleep_hours != null) {
    factors.push({
      key: 'sleep', label: 'Sleep', icon: <Moon className="w-3.5 h-3.5" />,
      score: clamp((today.sleep_hours / 8) * 100),
      detail: `${today.sleep_hours.toFixed(1)}h (target 8h)`,
    });
  }

  // Body battery — already 0-100; fall back to 100 - stress
  if (today.body_battery != null) {
    factors.push({
      key: 'battery', label: 'Body Battery', icon: <BatteryMedium className="w-3.5 h-3.5" />,
      score: clamp(today.body_battery),
      detail: `${today.body_battery} / 100`,
    });
  } else if (today.stress_score != null) {
    factors.push({
      key: 'battery', label: 'Recovery', icon: <BatteryMedium className="w-3.5 h-3.5" />,
      score: clamp(100 - today.stress_score),
      detail: `Stress score ${today.stress_score}`,
    });
  }

  if (factors.length === 0) return null;

  const overall = Math.round(avg(factors.map(f => f.score)));
  const band = BAND(overall);

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
          {factors.map(f => (
            <div key={f.key} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {f.icon}
              <span className="whitespace-nowrap">{f.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
