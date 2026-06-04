'use client';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity } from '@/types';
import type { TrainingPlan, TrainingSession } from '@/app/api/training-plan/route';

interface Props {
  activities: Activity[];
}

type Goal = 'base' | 'ftp' | 'race';

const GOAL_OPTIONS: { id: Goal; label: string; desc: string }[] = [
  { id: 'base', label: 'Base Fitness', desc: 'Build aerobic foundation with Zone 2' },
  { id: 'ftp',  label: 'Raise FTP',    desc: 'Structured threshold intervals' },
  { id: 'race', label: 'Race Prep',    desc: 'Zwift-specific race conditioning' },
];

type Intensity = 'easy' | 'moderate' | 'hard' | 'rest';

function sessionIntensity(type: string): Intensity {
  const t = type.toLowerCase();
  if (t.includes('rest') || t.includes('recovery day')) return 'rest';
  if (t.includes('threshold') || t.includes('vo2') || t.includes('interval') || t.includes('race')) return 'hard';
  if (t.includes('tempo') || t.includes('sweetspot') || t.includes('sweet spot') || t.includes('zone 3') || t.includes('zone 4')) return 'moderate';
  return 'easy';
}

const CHIP_STYLES: Record<Intensity, string> = {
  easy:     'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  moderate: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  hard:     'bg-red-500/20 text-red-300 border border-red-500/30',
  rest:     'bg-muted/40 text-muted-foreground border border-border',
};

function SessionChip({ session, onClick, selected }: {
  session: TrainingSession;
  onClick: () => void;
  selected: boolean;
}) {
  const intensity = sessionIntensity(session.type);
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1 text-[10px] font-medium transition-all text-left ${CHIP_STYLES[intensity]} ${
        selected ? 'ring-1 ring-foreground/40' : ''
      }`}
    >
      <div className="font-semibold">{session.day.slice(0, 3)}</div>
      <div className="opacity-80 truncate max-w-[80px]">{session.type}</div>
    </button>
  );
}

function downloadPlan(plan: TrainingPlan) {
  const lines: string[] = [
    `Training Plan: ${plan.goal}`,
    `FTP: ${plan.ftp_input} W`,
    '',
    'Key Principles:',
    ...plan.key_principles.map(p => `  • ${p}`),
    '',
  ];
  for (const week of plan.weeks) {
    lines.push(`== Week ${week.week}: ${week.theme} (TSS target: ${week.tss_target}) ==`);
    for (const s of week.sessions) {
      lines.push(`  ${s.day}: ${s.type} — ${s.duration_min} min (~${s.tss_estimate} TSS)`);
      lines.push(`    ${s.description}`);
    }
    lines.push('');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'training-plan.txt';
  a.click();
  URL.revokeObjectURL(url);
}

export default function TrainingPlanGenerator({ activities }: Props) {
  // Pre-fill FTP from latest cycling activity
  const latestFtp = (() => {
    const cycling = activities.filter(a => a.activity_type === 'cycling' && a.ftp && a.ftp > 0);
    if (!cycling.length) return 200;
    return cycling.reduce((best, a) => (a.date > (best?.date ?? '') ? a : best), null as Activity | null)?.ftp ?? 200;
  })();

  const [ftp, setFtp] = useState(latestFtp || 200);
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [goal, setGoal] = useState<Goal>('base');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/training-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ftp, daysPerWeek, goal, weeksAvailable: 4 }),
      });
      const data = await res.json() as { plan?: TrainingPlan; error?: string };
      if (data.error) throw new Error(data.error);
      if (!data.plan) throw new Error('No plan returned');
      setPlan(data.plan);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Form */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* FTP input */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
                FTP (Watts)
              </label>
              <input
                type="number"
                min={50}
                max={600}
                value={ftp}
                onChange={e => setFtp(Number(e.target.value))}
                className="w-full text-sm rounded border border-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
              />
            </div>

            {/* Days per week */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
                Days / Week: {daysPerWeek}
              </label>
              <input
                type="range"
                min={2}
                max={6}
                value={daysPerWeek}
                onChange={e => setDaysPerWeek(Number(e.target.value))}
                className="w-full accent-foreground"
              />
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>2</span><span>3</span><span>4</span><span>5</span><span>6</span>
              </div>
            </div>

            {/* Goal */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Goal</label>
              <div className="flex flex-col gap-1">
                {GOAL_OPTIONS.map(g => (
                  <button
                    key={g.id}
                    onClick={() => setGoal(g.id)}
                    className={`text-left text-xs px-2 py-1.5 rounded border transition-colors ${
                      goal === g.id
                        ? 'border-foreground bg-foreground/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
                    }`}
                  >
                    <span className="font-semibold">{g.label}</span>
                    <span className="block text-[9px] opacity-70">{g.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Button onClick={generate} disabled={loading} className="w-full sm:w-auto">
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin h-3 w-3 rounded-full border-2 border-background border-t-transparent" />
                Generating plan…
              </span>
            ) : 'Generate 4-Week Plan'}
          </Button>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </CardContent>
      </Card>

      {/* Plan display */}
      {plan && (
        <div className="space-y-3">
          {/* Key principles */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{plan.goal}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {plan.key_principles.map((p, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-2">
                    <span className="text-foreground/40 shrink-0">•</span>
                    {p}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* 4-week calendar grid */}
          {plan.weeks.map(week => (
            <Card key={week.week}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Week {week.week}: {week.theme}</CardTitle>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    TSS target: {week.tss_target}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {week.sessions.map((s, i) => {
                    const key = `${week.week}-${i}`;
                    return (
                      <SessionChip
                        key={key}
                        session={s}
                        selected={expandedSession === key}
                        onClick={() => setExpandedSession(expandedSession === key ? null : key)}
                      />
                    );
                  })}
                </div>

                {/* Expanded session detail */}
                {week.sessions.map((s, i) => {
                  const key = `${week.week}-${i}`;
                  if (expandedSession !== key) return null;
                  return (
                    <div key={key} className="mt-3 rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{s.day} — {s.type}</span>
                        <span className="text-muted-foreground font-mono">{s.duration_min} min · ~{s.tss_estimate} TSS</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{s.description}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}

          <Button variant="outline" size="sm" onClick={() => downloadPlan(plan)}>
            Download as text
          </Button>
        </div>
      )}
    </div>
  );
}
