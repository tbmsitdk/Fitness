'use client';
import { useMemo } from 'react';
import { Activity, WellnessRecord } from '@/types';
import { UserSettings, getAge } from '@/lib/settings';

interface Props {
  settings: UserSettings;
  wellness: WellnessRecord[];
  activities: Activity[];
}

function rhrScore(rhr: number): number {
  if (rhr < 50) return 100;
  if (rhr < 60) return 80;
  if (rhr < 70) return 60;
  if (rhr < 80) return 40;
  return 20;
}

function vo2maxScore(vo2: number, age: number, sex: 'male' | 'female'): number {
  // Excellent / Good / Average / Poor thresholds by sex & broad age group
  type Thresholds = { excellent: number; good: number; average: number };
  const norms: Thresholds = sex === 'male'
    ? age < 30 ? { excellent: 55, good: 46, average: 38 }
    : age < 40 ? { excellent: 53, good: 44, average: 37 }
    : age < 50 ? { excellent: 50, good: 42, average: 35 }
    : age < 60 ? { excellent: 47, good: 39, average: 32 }
    : { excellent: 43, good: 36, average: 29 }
    : age < 30 ? { excellent: 49, good: 40, average: 32 }
    : age < 40 ? { excellent: 47, good: 38, average: 31 }
    : age < 50 ? { excellent: 44, good: 36, average: 29 }
    : age < 60 ? { excellent: 41, good: 33, average: 27 }
    : { excellent: 38, good: 30, average: 24 };

  if (vo2 >= norms.excellent) return 100;
  if (vo2 >= norms.good)      return 75;
  if (vo2 >= norms.average)   return 50;
  return 25;
}

function activeMinutesScore(weeklyMinutes: number): number {
  if (weeklyMinutes >= 300) return 100;
  if (weeklyMinutes >= 150) return 70;
  if (weeklyMinutes >= 60)  return 40;
  return 20;
}

function ProgressBar({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium" style={{ color }}>{score}/100</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function CardiovascularAge({ settings, wellness, activities }: Props) {
  const { cardioAge, chrono, delta, scores } = useMemo(() => {
    const chrono = getAge(settings);

    // Latest resting HR
    const withRHR = [...wellness].filter(w => w.resting_hr != null).sort((a, b) => b.date.localeCompare(a.date));
    const latestRHR = withRHR[0]?.resting_hr ?? null;

    // Latest VO2max
    const withVO2 = [...wellness].filter(w => w.vo2max != null).sort((a, b) => b.date.localeCompare(a.date));
    const latestVO2 = withVO2[0]?.vo2max ?? null;

    // Weekly active minutes — last 4 weeks average
    const fourWeeksAgo = new Date(Date.now() - 28 * 86400000);
    const recentMins = activities
      .filter(a => new Date(a.date) >= fourWeeksAgo)
      .reduce((s, a) => s + a.duration_seconds / 60, 0);
    const avgWeeklyMins = recentMins / 4;

    const rhrS = latestRHR != null ? rhrScore(latestRHR) : 50;
    const vo2S = latestVO2 != null ? vo2maxScore(latestVO2, chrono, settings.sex) : 50;
    const actS = activeMinutesScore(avgWeeklyMins);

    const composite = (rhrS + vo2S + actS) / 3;
    const cardioAge = Math.round(chrono * (1 - (composite - 50) / 200));

    return {
      cardioAge,
      chrono,
      delta: cardioAge - chrono,
      scores: {
        rhr: { score: rhrS, value: latestRHR, label: 'Resting HR' },
        vo2: { score: vo2S, value: latestVO2, label: 'VO₂ Max' },
        activity: { score: actS, value: Math.round(avgWeeklyMins), label: 'Weekly Active Min' },
        composite: Math.round(composite),
      },
    };
  }, [settings, wellness, activities]);

  const deltaColor = delta < 0 ? '#22C55E' : delta > 5 ? '#EF4444' : '#F59E0B';
  const deltaText = delta < 0 ? `${Math.abs(delta)} yrs younger` : delta > 0 ? `${delta} yrs older` : 'same as chrono age';

  return (
    <div className="space-y-4">
      <div className="flex gap-4 flex-wrap">
        <div className="p-4 rounded-lg border border-border bg-card space-y-1">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Cardiovascular Age</p>
          <p className="text-4xl font-bold font-mono text-foreground">{cardioAge}</p>
          <p className="text-[11px]" style={{ color: deltaColor }}>{deltaText}</p>
        </div>
        <div className="p-4 rounded-lg border border-border bg-card space-y-1">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Chronological Age</p>
          <p className="text-4xl font-bold font-mono text-muted-foreground">{chrono}</p>
        </div>
        <div className="p-4 rounded-lg border border-border bg-card space-y-1">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Composite Score</p>
          <p className="text-4xl font-bold font-mono text-foreground">{scores.composite}</p>
          <p className="text-[11px] text-muted-foreground">/100</p>
        </div>
      </div>

      <div className="space-y-3 max-w-md">
        <ProgressBar
          label={`Resting HR${scores.rhr.value != null ? ` (${scores.rhr.value} bpm)` : ''}`}
          score={scores.rhr.score}
          color="#3B82F6"
        />
        <ProgressBar
          label={`VO₂ Max${scores.vo2.value != null ? ` (${scores.vo2.value.toFixed(1)} ml/kg/min)` : ''}`}
          score={scores.vo2.score}
          color="#22C55E"
        />
        <ProgressBar
          label={`Weekly Active Minutes (${scores.activity.value} min avg/wk)`}
          score={scores.activity.score}
          color="#F59E0B"
        />
      </div>
      <p className="text-[10px] text-muted-foreground/60 italic">
        Cardio age = chrono age × (1 − (score − 50) / 200). Score based on resting HR, VO₂ max, and weekly activity norms.
      </p>
    </div>
  );
}
