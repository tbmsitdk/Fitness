'use client';
import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Bike, Footprints, PersonStanding, Moon } from 'lucide-react';
import { Activity, WellnessRecord } from '@/types';
import { TrainingLoadForecast, isTrainingSession } from '@/lib/training-load';
import { UserSettings, getMaxHR } from '@/lib/settings';

interface Props {
  trainingLoad: TrainingLoadForecast[];
  wellness: WellnessRecord[];
  activities: Activity[];
  allActivities: Activity[];
  settings: UserSettings;
  ftp: number | null;
}

type Intensity = 'rest' | 'easy' | 'moderate' | 'quality' | 'optimal';

interface Suggestion {
  intensity: Intensity;
  text: string;
  tsb: number | null;
  recovery: number | null;
  acwr: number | null;
  sleepDebt: number | null;
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

type Sport = 'cycling' | 'running' | 'walking' | 'rest';

interface Workout {
  sport: Sport;
  title: string;        // e.g. "Sweet-spot intervals"
  prescription: string; // concrete session with target numbers
}

const SPORT_ICON: Record<Sport, React.ComponentType<{ className?: string }>> = {
  cycling: Bike,
  running: PersonStanding,
  walking: Footprints,
  rest: Moon,
};

// HR ranges from the 5-zone %-of-max model (Z1<60, Z2 60-70, Z3 70-80, Z4 80-90, Z5>90)
function hrRange(maxHR: number, loPct: number, hiPct: number): string {
  return `${Math.round(maxHR * loPct)}–${Math.round(maxHR * hiPct)} bpm`;
}
function wattRange(ftp: number, loPct: number, hiPct: number): string {
  return `${Math.round(ftp * loPct)}–${Math.round(ftp * hiPct)} W`;
}

// Choose the best session for today: intensity sets the structure, sport is
// picked for balance (favour the athlete's main sport, but swap to their other
// sport for variety on easy/moderate days if they trained the main one yesterday).
function pickWorkout(
  intensity: Intensity,
  activities: Activity[],
  settings: UserSettings,
  ftp: number | null,
): Workout {
  if (intensity === 'rest') {
    return {
      sport: 'rest',
      title: 'Recovery',
      prescription: 'Full rest, or a gentle 20–30 min walk if you feel restless. No structured effort — recovery is the training today.',
    };
  }

  const maxHR = getMaxHR(settings);
  const now = Date.now();

  // Sport mix over the last 30 days (session counts)
  const recent = activities.filter(a => now - new Date(a.date).getTime() < 30 * 86400000);
  const count = (s: string) => recent.filter(a => a.activity_type === s).length;
  const rides = count('cycling');
  const runs = count('running');
  const primary: 'cycling' | 'running' = rides >= runs ? 'cycling' : 'running';
  const secondary: 'cycling' | 'running' = primary === 'cycling' ? 'running' : 'cycling';
  const secondaryViable = (secondary === 'cycling' ? rides : runs) >= 2;

  // What sport was trained yesterday (for variety)
  const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
  const trainedYesterday = new Set(
    activities.filter(a => a.date.split('T')[0] === yesterday).map(a => a.activity_type)
  );

  // On easy/moderate days, swap to the other sport if the main one was done yesterday.
  // On quality/optimal days, specificity matters — stick with the primary sport.
  let sport: 'cycling' | 'running' = primary;
  if ((intensity === 'easy' || intensity === 'moderate') && trainedYesterday.has(primary) && secondaryViable) {
    sport = secondary;
  }

  const hasFtp = sport === 'cycling' && ftp && ftp > 0;

  // Session library, keyed by intensity × sport
  if (sport === 'cycling') {
    switch (intensity) {
      case 'easy':
        return { sport, title: 'Zone 2 endurance',
          prescription: `60–90 min steady endurance ride. Keep HR ${hrRange(maxHR, 0.60, 0.70)}${hasFtp ? ` / ${wattRange(ftp!, 0.56, 0.75)}` : ''} — conversational the whole way.` };
      case 'moderate':
        return { sport, title: 'Sweet-spot',
          prescription: `Warm up 15 min, then 2×15 min at ${hasFtp ? wattRange(ftp!, 0.88, 0.93) : 'sweet-spot (comfortably hard, HR ' + hrRange(maxHR, 0.80, 0.87) + ')'} with 5 min easy between. Cool down 10 min.` };
      case 'quality':
        return { sport, title: 'Threshold intervals',
          prescription: `Warm up 15 min, then 3×10 min at ${hasFtp ? wattRange(ftp!, 0.95, 1.05) : 'threshold (HR ' + hrRange(maxHR, 0.85, 0.92) + ')'} with 5 min easy between. Cool down 10 min.` };
      case 'optimal':
        return { sport, title: 'VO₂max intervals',
          prescription: `Your peak day. Warm up 20 min, then 5×4 min at ${hasFtp ? wattRange(ftp!, 1.10, 1.20) : 'max sustainable (HR >' + Math.round(maxHR * 0.90) + ' bpm)'} with 4 min easy between. Cool down 10 min.` };
    }
  } else {
    // running
    switch (intensity) {
      case 'easy':
        return { sport, title: 'Easy aerobic run',
          prescription: `40–50 min at an easy, conversational pace. Keep HR ${hrRange(maxHR, 0.60, 0.70)} — if you can't talk, slow down.` };
      case 'moderate':
        return { sport, title: 'Tempo run',
          prescription: `Warm up 10 min easy, then 25–30 min at comfortably-hard tempo (HR ${hrRange(maxHR, 0.80, 0.88)}). Cool down 10 min.` };
      case 'quality':
        return { sport, title: 'Threshold intervals',
          prescription: `Warm up 10 min, then 5×3 min hard (HR ${hrRange(maxHR, 0.85, 0.92)}) with 2 min easy jog between. Cool down 10 min.` };
      case 'optimal':
        return { sport, title: 'VO₂max intervals',
          prescription: `Your peak day. Warm up 15 min, then 6×3 min at ~5K race effort (HR >${Math.round(maxHR * 0.90)} bpm) with 2 min jog between. Cool down 10 min.` };
    }
  }

  // Fallback (shouldn't reach)
  return { sport, title: 'Session', prescription: 'Get a session in that matches how you feel today.' };
}

function compute(
  trainingLoad: TrainingLoadForecast[],
  wellness: WellnessRecord[],
  activities: Activity[],
): Suggestion {
  // Get latest non-projected TSB / ACWR (acute:chronic workload ratio = ATL/CTL)
  const historicalLoad = trainingLoad.filter(d => !d.projected);
  const latest = historicalLoad[historicalLoad.length - 1];
  const tsb = latest?.tsb ?? null;
  const acwr = latest && latest.ctl > 0 ? Math.round((latest.atl / latest.ctl) * 100) / 100 : null;
  const highInjuryRisk = acwr !== null && acwr > 1.5;

  // Recovery score from most recent stress_score
  const recentWell = [...wellness].sort((a, b) => b.date.localeCompare(a.date));
  const latestWell = recentWell[0];
  const recovery = latestWell?.stress_score != null ? 100 - latestWell.stress_score : null;

  // Sleep debt — recent 7-day average vs 30-day baseline
  const now = Date.now();
  const last30 = recentWell.filter(w => now - new Date(w.date).getTime() < 30 * 86400000 && w.sleep_hours != null);
  const last7  = recentWell.filter(w => now - new Date(w.date).getTime() < 7  * 86400000 && w.sleep_hours != null);
  const baseline = last30.length ? last30.reduce((s, w) => s + w.sleep_hours!, 0) / last30.length : null;
  const sleepDebt = baseline !== null && last7.length
    ? Math.round(last7.reduce((s, w) => s + (baseline - w.sleep_hours!), 0) * 10) / 10
    : null;
  const highSleepDebt = sleepDebt !== null && sleepDebt > 4;

  // Count TRAINING days in the last 3 — casual walks don't count as training
  // stress, so a run/ride ≥20 min is required. This prevents daily dog-walks
  // from triggering a false "you've trained 3 days straight, rest" override.
  const today = new Date();
  const last3Days = [1, 2, 3].map(n => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  });
  const trainingDaysLast3 = new Set(
    activities
      .filter(a => isTrainingSession(a) && last3Days.some(d => a.date.split('T')[0].startsWith(d)))
      .map(a => a.date.split('T')[0])
  ).size;
  const forceRest = trainingDaysLast3 >= 3;

  if (forceRest) {
    return {
      intensity: 'rest',
      text: 'Rest day recommended — you have trained 3 or more days in a row. Let your body absorb the work. (Casual walks don’t count as training here.)',
      tsb,
      recovery,
      acwr,
      sleepDebt,
      reason: `${trainingDaysLast3} training days (rides/runs ≥20 min) in the last 3 days — walks are excluded. Recovery is part of the training.`,
    };
  }

  // ── Injury-risk override: ACWR > 1.5 means training load spiked too fast ──
  if (highInjuryRisk) {
    return {
      intensity: 'rest',
      text: 'Rest or very easy recovery only — your training load has spiked sharply. Pushing now raises injury risk significantly.',
      tsb,
      recovery,
      acwr,
      sleepDebt,
      reason: `ACWR ${acwr!.toFixed(2)} (>1.5 = high injury-risk zone — acute load is far outpacing your chronic fitness).`,
    };
  }

  // ── Sleep-debt override: a large accumulated deficit overrides a "fresh" TSB ──
  if (highSleepDebt) {
    return {
      intensity: 'easy',
      text: 'Easy aerobic only — you are running a significant sleep deficit. Prioritise sleep before adding training stress.',
      tsb,
      recovery,
      acwr,
      sleepDebt,
      reason: `Sleep debt of ${sleepDebt!.toFixed(1)}h over the last week vs your 30-day baseline. Recovery capacity is reduced regardless of TSB${tsb !== null ? ` (${tsb.toFixed(1)})` : ''}.`,
    };
  }

  if (tsb === null) {
    return {
      intensity: 'moderate',
      text: 'Moderate session — not enough data to compute TSB yet.',
      tsb,
      recovery,
      acwr,
      sleepDebt,
      reason: 'Insufficient training load history.',
    };
  }

  if (tsb < -20 && recovery !== null && recovery < 50) {
    return {
      intensity: 'rest',
      text: 'Rest or easy walk — you are carrying significant fatigue. Sleep and nutrition are your training today.',
      tsb,
      recovery,
      acwr,
      sleepDebt,
      reason: `TSB ${tsb.toFixed(1)} (high fatigue) and recovery score ${recovery} (poor).`,
    };
  }
  if (tsb < -20) {
    return {
      intensity: 'easy',
      text: 'Easy aerobic only (Zone 1–2). High fatigue but you are recovering well.',
      tsb,
      recovery,
      acwr,
      sleepDebt,
      reason: `TSB ${tsb.toFixed(1)} (high fatigue), recovery ${recovery !== null ? recovery : 'unknown'}.`,
    };
  }
  if (tsb >= -20 && tsb <= -5) {
    return {
      intensity: 'moderate',
      text: 'Moderate session — build phase. Tempo run or Zone 2–3 ride.',
      tsb,
      recovery,
      acwr,
      sleepDebt,
      reason: `TSB ${tsb.toFixed(1)} — in the productive training zone.`,
    };
  }
  if (tsb > -5 && tsb <= 5) {
    return {
      intensity: 'quality',
      text: 'Balanced. Any workout fits — good time for quality work.',
      tsb,
      recovery,
      acwr,
      sleepDebt,
      reason: `TSB ${tsb.toFixed(1)} — neutral form. Fatigue and fitness are balanced.`,
    };
  }
  if (tsb > 5 && tsb <= 25 && recovery !== null && recovery >= 65) {
    return {
      intensity: 'optimal',
      text: 'Optimal window — this is your peak performance day. Push hard.',
      tsb,
      recovery,
      acwr,
      sleepDebt,
      reason: `TSB ${tsb.toFixed(1)} (fresh) and recovery ${recovery} (good). Perfect conditions.`,
    };
  }
  if (tsb > 5 && tsb <= 25) {
    return {
      intensity: 'quality',
      text: 'Good form but moderate recovery. Steady quality session.',
      tsb,
      recovery,
      acwr,
      sleepDebt,
      reason: `TSB ${tsb.toFixed(1)} (fresh), but recovery ${recovery !== null ? recovery : 'unknown'}.`,
    };
  }
  // tsb > 25
  return {
    intensity: 'easy',
    text: 'Fresh but detraining risk. Get a session in — even a long walk counts.',
    tsb,
    recovery,
      acwr,
      sleepDebt,
    reason: `TSB ${tsb.toFixed(1)} — very fresh, too much rest risks losing fitness.`,
  };
}

export default function DailySuggestion({ trainingLoad, wellness, activities, allActivities, settings, ftp }: Props) {
  const suggestion = useMemo(() => compute(trainingLoad, wellness, activities), [trainingLoad, wellness, activities]);
  const workout = useMemo(
    () => pickWorkout(suggestion.intensity, allActivities, settings, ftp),
    [suggestion.intensity, allActivities, settings, ftp]
  );
  const SportIcon = SPORT_ICON[workout.sport];

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
          {suggestion.acwr !== null && (
            <span className={`text-[10px] font-mono ${suggestion.acwr > 1.5 ? 'text-red-400' : suggestion.acwr > 1.3 ? 'text-amber-400' : 'text-muted-foreground'}`}>
              ACWR {suggestion.acwr.toFixed(2)}
            </span>
          )}
          {suggestion.sleepDebt !== null && suggestion.sleepDebt > 1 && (
            <span className={`text-[10px] font-mono ${suggestion.sleepDebt > 4 ? 'text-red-400' : 'text-muted-foreground'}`}>
              Sleep debt {suggestion.sleepDebt.toFixed(1)}h
            </span>
          )}
          <span className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground ml-auto">
            Today&apos;s Training
          </span>
        </div>

        {/* Concrete session prescription — the headline recommendation */}
        <div className="flex items-start gap-3 rounded-md bg-muted/40 p-3">
          <SportIcon className="w-5 h-5 mt-0.5 shrink-0 text-foreground" />
          <div className="space-y-0.5">
            <p className="text-sm font-semibold capitalize">
              {workout.sport === 'rest' ? 'Rest day' : `${workout.sport} · ${workout.title}`}
            </p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{workout.prescription}</p>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">{suggestion.text}</p>

        {/* Always-visible explanation of why today's recommendation was made */}
        <p className="text-[11px] text-muted-foreground bg-muted/40 rounded p-2 leading-relaxed">
          <span className="font-medium text-foreground">Why: </span>{suggestion.reason}
        </p>
      </CardContent>
    </Card>
  );
}
