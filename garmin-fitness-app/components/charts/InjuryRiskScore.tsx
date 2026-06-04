'use client';
import { useMemo } from 'react';
import { Activity, WellnessRecord } from '@/types';
import { TrainingLoadForecast } from '@/lib/training-load';

interface Props {
  activities: Activity[];
  trainingLoad: TrainingLoadForecast[];
  wellness: WellnessRecord[];
  compact?: boolean;
}

interface Factor {
  label: string;
  score: number;       // 0–100 risk (higher = more risky)
  detail: string;
  advice: string;
}

function getACWR(trainingLoad: TrainingLoadForecast[]): Factor {
  const real = trainingLoad.filter(d => !d.projected);
  const latest = real.at(-1);
  if (!latest || latest.ctl === 0) {
    return { label: 'Workload Ratio (ACWR)', score: 0, detail: 'Not enough data', advice: 'Keep training consistently to build a baseline.' };
  }
  const acwr = latest.ctl > 0 ? latest.atl / latest.ctl : 1;
  let score: number; let detail: string; let advice: string;
  if (acwr < 0.8)       { score = 30; detail = `ACWR ${acwr.toFixed(2)} — undertraining`; advice = 'Gradually increase load to stay in the optimal 0.8–1.3 range.'; }
  else if (acwr <= 1.3) { score = 5;  detail = `ACWR ${acwr.toFixed(2)} — optimal range`; advice = 'Ideal workload balance. Maintain current training pattern.'; }
  else if (acwr <= 1.5) { score = 55; detail = `ACWR ${acwr.toFixed(2)} — elevated load`; advice = 'Reduce intensity next 3–5 days. Sharp load spikes raise injury risk.'; }
  else                  { score = 90; detail = `ACWR ${acwr.toFixed(2)} — danger zone`; advice = 'High injury risk. Take 2–3 easier days before resuming hard sessions.'; }
  return { label: 'Workload Ratio (ACWR)', score, detail, advice };
}

function getMonotony(activities: Activity[], thresholdHR = 150): Factor {
  const now = Date.now();
  const week = activities.filter(a => now - new Date(a.date).getTime() < 7 * 86400000);
  if (week.length < 3) {
    return { label: 'Training Monotony', score: 0, detail: 'Too few sessions to measure', advice: 'Keep training at least 3x/week to get a meaningful monotony score.' };
  }
  const byDay: Record<string, number> = {};
  for (const a of week) {
    const d = a.date.slice(0, 10);
    const hrs = a.duration_seconds / 3600;
    const hrFrac = (a.avg_hr ?? 130) / thresholdHR;
    const tss = a.tss ?? hrs * Math.min(hrFrac * 0.9, 1.15) ** 2 * 100;
    byDay[d] = (byDay[d] ?? 0) + tss;
  }
  const vals = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    return byDay[d] ?? 0;
  });
  const mean = vals.reduce((a, b) => a + b, 0) / 7;
  const std  = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / 7);
  const mono = std > 0 ? mean / std : 0;
  let score: number; let detail: string; let advice: string;
  if (mono < 1.5)      { score = 5;  detail = `Monotony ${mono.toFixed(2)} — well varied`; advice = 'Good variety between hard and easy days. Keep it up.'; }
  else if (mono < 2.0) { score = 45; detail = `Monotony ${mono.toFixed(2)} — moderate`; advice = 'Add more variation: include a rest day or a much easier session.'; }
  else                 { score = 85; detail = `Monotony ${mono.toFixed(2)} — high risk`; advice = 'Training is too similar day-to-day. Insert easy/rest days to reduce strain.'; }
  return { label: 'Training Monotony', score, detail, advice };
}

function getRecoveryDeficit(wellness: WellnessRecord[], activities: Activity[]): Factor {
  const now = Date.now();
  const last7 = new Set(
    activities
      .filter(a => now - new Date(a.date).getTime() < 7 * 86400000)
      .map(a => a.date.slice(0, 10))
  );
  const wellMap = new Map(wellness.map(w => [w.date.slice(0, 10), w]));
  let deficitDays = 0;
  for (const d of last7) {
    const w = wellMap.get(d);
    if (!w) continue;
    const poorStress  = w.stress_score != null && w.stress_score > 60;
    const lowBattery  = w.body_battery != null && w.body_battery < 30;
    if (poorStress || lowBattery) deficitDays++;
  }
  let score: number; let detail: string; let advice: string;
  if (deficitDays === 0)     { score = 5;  detail = 'No recovery-deficit training days'; advice = 'Good recovery management — you\'re training with adequate rest.'; }
  else if (deficitDays <= 2) { score = 35; detail = `${deficitDays} day(s) trained with poor recovery`; advice = 'Moderate concern. Consider swapping hard days to match your body battery.'; }
  else if (deficitDays <= 4) { score = 65; detail = `${deficitDays} days trained with poor recovery`; advice = 'Often training when under-recovered. Prioritise sleep and rest days.'; }
  else                       { score = 90; detail = `${deficitDays} days trained with poor recovery`; advice = 'Consistently training while depleted. High burnout and injury risk.'; }
  return { label: 'Recovery Deficit', score, detail, advice };
}

const RISK_LEVELS = [
  { max: 30, label: 'Low risk',    color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/30',  dot: 'bg-green-500'  },
  { max: 60, label: 'Monitor',     color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/30',  dot: 'bg-amber-500'  },
  { max: 101,label: 'High risk',   color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/30',    dot: 'bg-red-500'    },
];

function riskLevel(score: number) {
  return RISK_LEVELS.find(r => score < r.max) ?? RISK_LEVELS.at(-1)!;
}

export default function InjuryRiskScore({ activities, trainingLoad, wellness, compact = false }: Props) {
  const factors = useMemo((): Factor[] => {
    const thresholdHR = 150; // rough default
    return [
      getACWR(trainingLoad),
      getMonotony(activities, thresholdHR),
      getRecoveryDeficit(wellness, activities),
    ];
  }, [activities, trainingLoad, wellness]);

  const composite = Math.round(factors.reduce((s, f) => s + f.score, 0) / factors.length);
  const level = riskLevel(composite);
  const topFactor = [...factors].sort((a, b) => b.score - a.score)[0];

  if (compact) {
    if (composite < 60) return null; // only show compact when risk is elevated
    return (
      <div className={`rounded-lg border ${level.border} ${level.bg} p-3 flex items-center gap-3`}>
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${level.dot}`} />
        <div className="min-w-0">
          <p className={`text-xs font-semibold ${level.color}`}>⚠ Injury Risk: {level.label} ({composite}/100)</p>
          <p className="text-[10px] text-muted-foreground truncate">{topFactor.advice}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall score */}
      <div className={`rounded-lg border ${level.border} ${level.bg} p-4 flex items-center justify-between`}>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Injury Risk Score</p>
          <p className={`text-3xl font-bold font-mono ${level.color}`}>{composite}<span className="text-sm font-normal text-muted-foreground ml-1">/ 100</span></p>
          <p className={`text-sm font-medium ${level.color} mt-0.5`}>{level.label}</p>
        </div>
        <div className="text-right text-xs text-muted-foreground space-y-1">
          <p>Primary factor:</p>
          <p className={`font-medium ${riskLevel(topFactor.score).color}`}>{topFactor.label}</p>
        </div>
      </div>

      {/* Factor breakdown */}
      <div className="space-y-3">
        {factors.map(f => {
          const fl = riskLevel(f.score);
          const barW = `${f.score}%`;
          return (
            <div key={f.label} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{f.label}</span>
                <span className={`font-mono font-semibold ${fl.color}`}>{f.score}/100</span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${fl.dot}`} style={{ width: barW }} />
              </div>
              <p className="text-[10px] text-muted-foreground">{f.detail}</p>
              <p className={`text-[10px] font-medium ${fl.color}`}>{f.advice}</p>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground/60 italic">
        ACWR = Acute:Chronic workload ratio (ATL÷CTL) · Optimal range 0.8–1.3 ·
        High monotony = training too similar each day · Recovery deficit = training while stressed/depleted
      </p>
    </div>
  );
}
