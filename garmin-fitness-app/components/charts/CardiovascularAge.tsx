'use client';
import { useMemo } from 'react';
import { Activity, WellnessRecord } from '@/types';
import { UserSettings, getAge } from '@/lib/settings';
import { computeCardioAge } from '@/lib/cardio-age';

interface Props {
  settings: UserSettings;
  wellness: WellnessRecord[];
  activities: Activity[];
}

const FACTOR_COLOR: Record<string, string> = {
  vo2: '#22C55E', rhr: '#3B82F6', bodyfat: '#F97316',
  activity: '#F59E0B', sleep: '#A78BFA', hrv: '#EC4899',
};

const UNIT: Record<string, string> = {
  vo2: ' ml/kg/min', rhr: ' bpm', bodyfat: '%', activity: ' min/wk', sleep: '', hrv: ' ms',
};

function ProgressBar({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium" style={{ color }}>{Math.round(score)}/100</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
    </div>
  );
}

export default function CardiovascularAge({ settings, wellness, activities }: Props) {
  const { chrono, result } = useMemo(() => {
    const chrono = getAge(settings);
    const sorted = [...wellness].sort((a, b) => b.date.localeCompare(a.date));
    const latestOf = <K extends keyof WellnessRecord>(key: K) => sorted.find(w => w[key] != null)?.[key] as number | undefined;

    const last14 = sorted.filter(w => Date.now() - new Date(w.date).getTime() < 14 * 86400000 && w.sleep_score != null);
    const avgSleepScore = last14.length ? last14.reduce((s, w) => s + (w.sleep_score as number), 0) / last14.length : null;

    const fourWeeksAgo = new Date(Date.now() - 28 * 86400000);
    const recentMins = activities.filter(a => new Date(a.date) >= fourWeeksAgo).reduce((s, a) => s + a.duration_seconds / 60, 0);

    const result = computeCardioAge({
      age: chrono,
      sex: settings.sex,
      restingHr: latestOf('resting_hr') ?? null,
      vo2max: latestOf('vo2max') ?? null,
      bodyFatPct: latestOf('body_fat_pct') ?? null,
      hrvRmssd: latestOf('hrv_rmssd') ?? null,
      weeklyActiveMinutes: recentMins / 4,
      sleepScore14dAvg: avgSleepScore,
    });

    return { chrono, result };
  }, [settings, wellness, activities]);

  const delta = result.cardioAge - chrono;
  const deltaColor = delta < 0 ? '#22C55E' : delta > 5 ? '#EF4444' : '#F59E0B';
  const deltaText = delta < 0 ? `${Math.abs(delta)} yrs younger` : delta > 0 ? `${delta} yrs older` : 'same as chrono age';

  return (
    <div className="space-y-4">
      <div className="flex gap-4 flex-wrap">
        <div className="p-4 rounded-lg border border-border bg-card space-y-1">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Cardiovascular Age</p>
          <p className="text-4xl font-bold font-mono text-foreground">{result.cardioAge}</p>
          <p className="text-[11px]" style={{ color: deltaColor }}>{deltaText}</p>
        </div>
        <div className="p-4 rounded-lg border border-border bg-card space-y-1">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Chronological Age</p>
          <p className="text-4xl font-bold font-mono text-muted-foreground">{chrono}</p>
        </div>
        <div className="p-4 rounded-lg border border-border bg-card space-y-1">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Composite Score</p>
          <p className="text-4xl font-bold font-mono text-foreground">{result.composite}</p>
          <p className="text-[11px] text-muted-foreground">/100 · {result.factors.length} factor{result.factors.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="space-y-3 max-w-md">
        {result.factors.map(f => (
          <ProgressBar
            key={f.key}
            label={`${f.label}${f.raw != null ? ` (${f.raw}${UNIT[f.key] ?? ''})` : ''}`}
            score={f.score}
            color={FACTOR_COLOR[f.key] ?? '#9CA3AF'}
          />
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground/60 italic">
        Cardio age = chrono age × (1 − (score − 50) / 200). Weighted composite of VO₂max (25%), resting HR (20%),
        body fat % (15%), HRV (15%), weekly active minutes (15%), and sleep score (10%) — only factors with
        available data are included, reweighted proportionally. VO₂max and body fat % use the same age/sex-adjusted
        norms shown elsewhere in the app; HRV is scored against an approximate age-expected baseline and varies
        widely between individuals, so it's given a lighter weight.
      </p>
    </div>
  );
}
