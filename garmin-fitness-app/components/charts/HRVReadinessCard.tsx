'use client';
import { WellnessRecord } from '@/types';
import { parseISO, format, subDays } from 'date-fns';

// Use stress_score as HRV proxy (Vivosmart 5 computes stress from HRV via Firstbeat).
// Recovery = 100 - stress → higher is better, consistent with HRV intuition.

function toRecovery(stress: number) { return 100 - stress; }

interface DayReadiness {
  date: string;
  label: string;
  recovery: number;
  stress: number;
  status: 'good' | 'moderate' | 'poor';
  delta: number; // vs 30d baseline
}

function classify(recovery: number, baseline: number): 'good' | 'moderate' | 'poor' {
  const diff = recovery - baseline;
  if (diff >= 5)  return 'good';
  if (diff >= -5) return 'moderate';
  return 'poor';
}

const STATUS_COLOR = {
  good:     { bg: 'bg-green-500/15',  border: 'border-green-500/30',  text: 'text-green-400',  dot: 'bg-green-500'  },
  moderate: { bg: 'bg-amber-500/15',  border: 'border-amber-500/30',  text: 'text-amber-400',  dot: 'bg-amber-500'  },
  poor:     { bg: 'bg-red-500/15',    border: 'border-red-500/30',    text: 'text-red-400',    dot: 'bg-red-500'    },
};

const STATUS_LABEL = {
  good:     'Well recovered',
  moderate: 'Moderate',
  poor:     'Fatigued',
};

interface Props { wellness: WellnessRecord[] }

export default function HRVReadinessCard({ wellness }: Props) {
  const hasStress = wellness.some(w => w.stress_score != null);

  if (!hasStress) {
    return (
      <div className="rounded-md border border-border bg-secondary/20 p-4 text-xs text-muted-foreground text-center h-32 flex items-center justify-center">
        No stress / HRV data available
      </div>
    );
  }

  const sorted = [...wellness]
    .filter(w => w.stress_score != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  // 30-day rolling baseline recovery
  const withBaseline = sorted.map((w, i) => {
    const window = sorted.slice(Math.max(0, i - 29), i + 1);
    const baseline = window.reduce((s, x) => s + toRecovery(x.stress_score!), 0) / window.length;
    const recovery = toRecovery(w.stress_score!);
    return { w, recovery, baseline, delta: recovery - baseline };
  });

  // Last 7 days
  const last7 = withBaseline.slice(-7).map(({ w, recovery, baseline, delta }) => ({
    date:     w.date.slice(0, 10),
    label:    format(parseISO(w.date.slice(0, 10)), 'EEE'),
    recovery: Math.round(recovery),
    stress:   w.stress_score!,
    status:   classify(recovery, baseline),
    delta,
  } as DayReadiness));

  const today = last7.at(-1);
  const baselineNow = withBaseline.at(-1)?.baseline ?? 50;
  const c = today ? STATUS_COLOR[today.status] : STATUS_COLOR.moderate;

  return (
    <div className="space-y-4">
      {/* Today's readiness */}
      {today && (
        <div className={`rounded-lg border ${c.border} ${c.bg} p-4 flex items-center justify-between`}>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Today's Readiness</p>
            <p className={`text-2xl font-bold font-mono ${c.text}`}>{today.recovery}<span className="text-sm font-normal text-muted-foreground ml-1">/ 100</span></p>
            <p className={`text-xs font-medium ${c.text} mt-0.5`}>{STATUS_LABEL[today.status]}</p>
          </div>
          <div className="text-right space-y-1">
            <p className="text-[10px] text-muted-foreground">vs 30d baseline</p>
            <p className={`text-sm font-semibold ${today.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {today.delta >= 0 ? '+' : ''}{Math.round(today.delta)}
            </p>
            <p className="text-[10px] text-muted-foreground">baseline: {Math.round(baselineNow)}</p>
          </div>
        </div>
      )}

      {/* 7-day timeline */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Last 7 days</p>
        <div className="grid grid-cols-7 gap-1">
          {last7.map(d => {
            const sc = STATUS_COLOR[d.status];
            return (
              <div key={d.date} className="flex flex-col items-center gap-1.5">
                <div
                  className={`w-full rounded-md ${sc.bg} border ${sc.border} flex items-center justify-center py-2`}
                  title={`${d.date}: Recovery ${d.recovery} (stress ${d.stress})`}
                >
                  <span className={`text-xs font-bold font-mono ${sc.text}`}>{d.recovery}</span>
                </div>
                <span className="text-[9px] text-muted-foreground">{d.label}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/60 italic">
        Recovery = 100 − stress score. Green ≥ +5 vs baseline · Amber within ±5 · Red ≤ −5.
        Vivosmart 5 derives stress from beat-to-beat HR intervals (Firstbeat Analytics).
      </p>
    </div>
  );
}
