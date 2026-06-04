'use client';
import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Activity, WellnessRecord } from '@/types';
import { TrainingLoadForecast } from '@/lib/training-load';

interface Props {
  trainingLoad: TrainingLoadForecast[];
  wellness: WellnessRecord[];
  activities: Activity[];
}

type Intensity = 'rest' | 'easy' | 'moderate' | 'quality' | 'optimal';

interface Suggestion {
  intensity: Intensity;
  text: string;
  tsb: number | null;
  recovery: number | null;
  reason: string;
}

const BORDER_COLORS: Record<Intensity, string> = {
  rest:     'border-l-red-500',
  easy:     'border-l-amber-500',
  moderate: 'border-l-blue-400',
  quality:  'border-l-sky-400',
  optimal:  'border-l-emerald-500',
};

const BADGE_STYLES: Record<Intensity, string> = {
  rest:     'bg-red-500/20 text-red-400',
  easy:     'bg-amber-500/20 text-amber-400',
  moderate: 'bg-blue-500/20 text-blue-400',
  quality:  'bg-sky-500/20 text-sky-400',
  optimal:  'bg-emerald-500/20 text-emerald-400',
};

const INTENSITY_LABELS: Record<Intensity, string> = {
  rest:     'Rest',
  easy:     'Easy',
  moderate: 'Moderate',
  quality:  'Quality',
  optimal:  'Optimal',
};

function compute(
  trainingLoad: TrainingLoadForecast[],
  wellness: WellnessRecord[],
  activities: Activity[],
): Suggestion {
  // Get latest non-projected TSB
  const historicalLoad = trainingLoad.filter(d => !d.projected);
  const latest = historicalLoad[historicalLoad.length - 1];
  const tsb = latest?.tsb ?? null;

  // Recovery score from most recent stress_score
  const recentWell = [...wellness].sort((a, b) => b.date.localeCompare(a.date));
  const latestWell = recentWell[0];
  const recovery = latestWell?.stress_score != null ? 100 - latestWell.stress_score : null;

  // Check if last 3 days all have activities
  const today = new Date();
  const last3Days = [1, 2, 3].map(n => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  });
  const activeDaysLast3 = activities.filter(a => {
    const ds = a.date.split('T')[0];
    return last3Days.some(d => ds.startsWith(d));
  });
  const consecutiveDays = new Set(activeDaysLast3.map(a => a.date.split('T')[0])).size;
  const forceRest = consecutiveDays >= 3;

  if (forceRest) {
    return {
      intensity: 'rest',
      text: 'Rest day recommended — you have trained 3 or more consecutive days. Let your body absorb the work.',
      tsb,
      recovery,
      reason: `${consecutiveDays} consecutive active days detected. Recovery is part of the training.`,
    };
  }

  if (tsb === null) {
    return {
      intensity: 'moderate',
      text: 'Moderate session — not enough data to compute TSB yet.',
      tsb,
      recovery,
      reason: 'Insufficient training load history.',
    };
  }

  if (tsb < -20 && recovery !== null && recovery < 50) {
    return {
      intensity: 'rest',
      text: 'Rest or easy walk — you are carrying significant fatigue. Sleep and nutrition are your training today.',
      tsb,
      recovery,
      reason: `TSB ${tsb.toFixed(1)} (high fatigue) and recovery score ${recovery} (poor).`,
    };
  }
  if (tsb < -20) {
    return {
      intensity: 'easy',
      text: 'Easy aerobic only (Zone 1–2). High fatigue but you are recovering well.',
      tsb,
      recovery,
      reason: `TSB ${tsb.toFixed(1)} (high fatigue), recovery ${recovery !== null ? recovery : 'unknown'}.`,
    };
  }
  if (tsb >= -20 && tsb <= -5) {
    return {
      intensity: 'moderate',
      text: 'Moderate session — build phase. Tempo run or Zone 2–3 ride.',
      tsb,
      recovery,
      reason: `TSB ${tsb.toFixed(1)} — in the productive training zone.`,
    };
  }
  if (tsb > -5 && tsb <= 5) {
    return {
      intensity: 'quality',
      text: 'Balanced. Any workout fits — good time for quality work.',
      tsb,
      recovery,
      reason: `TSB ${tsb.toFixed(1)} — neutral form. Fatigue and fitness are balanced.`,
    };
  }
  if (tsb > 5 && tsb <= 25 && recovery !== null && recovery >= 65) {
    return {
      intensity: 'optimal',
      text: 'Optimal window — this is your peak performance day. Push hard.',
      tsb,
      recovery,
      reason: `TSB ${tsb.toFixed(1)} (fresh) and recovery ${recovery} (good). Perfect conditions.`,
    };
  }
  if (tsb > 5 && tsb <= 25) {
    return {
      intensity: 'quality',
      text: 'Good form but moderate recovery. Steady quality session.',
      tsb,
      recovery,
      reason: `TSB ${tsb.toFixed(1)} (fresh), but recovery ${recovery !== null ? recovery : 'unknown'}.`,
    };
  }
  // tsb > 25
  return {
    intensity: 'easy',
    text: 'Fresh but detraining risk. Get a session in — even a long walk counts.',
    tsb,
    recovery,
    reason: `TSB ${tsb.toFixed(1)} — very fresh, too much rest risks losing fitness.`,
  };
}

export default function DailySuggestion({ trainingLoad, wellness, activities }: Props) {
  const [showWhy, setShowWhy] = useState(false);
  const suggestion = useMemo(() => compute(trainingLoad, wellness, activities), [trainingLoad, wellness, activities]);

  return (
    <Card className={`border-l-4 ${BORDER_COLORS[suggestion.intensity]}`}>
      <CardContent className="pt-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE_STYLES[suggestion.intensity]}`}>
            {INTENSITY_LABELS[suggestion.intensity]}
          </span>
          {suggestion.tsb !== null && (
            <span className="text-[10px] font-mono text-muted-foreground">
              TSB {suggestion.tsb.toFixed(1)}
            </span>
          )}
          {suggestion.recovery !== null && (
            <span className="text-[10px] font-mono text-muted-foreground">
              Recovery {suggestion.recovery}
            </span>
          )}
          <span className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground ml-auto">
            Today&apos;s Suggestion
          </span>
        </div>

        <p className="text-sm leading-relaxed">{suggestion.text}</p>

        <button
          onClick={() => setShowWhy(v => !v)}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          {showWhy ? 'Hide' : 'Why?'}
        </button>

        {showWhy && (
          <p className="text-[11px] text-muted-foreground bg-muted/40 rounded p-2 leading-relaxed">
            {suggestion.reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
