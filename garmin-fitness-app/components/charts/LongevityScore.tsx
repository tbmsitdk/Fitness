'use client';
import { useMemo } from 'react';
import { WellnessRecord, Activity } from '@/types';
import { UserSettings, getAge } from '@/lib/settings';

interface Props {
  wellness: WellnessRecord[];
  activities: Activity[];
  settings: UserSettings;
  compact?: boolean;
}

interface Component {
  label: string;
  score: number;
  weight: number;
  detail: string;
  available: boolean;
}

function trend(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
  const sumY = values.reduce((s, v) => s + v, 0);
  const sumXY = values.reduce((s, v, i) => s + i * v, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return slope;
}

function vo2maxScore(vo2max: number, age: number, sex: 'male' | 'female'): { score: number; category: string } {
  const male = sex === 'male';
  let thresholds: [number, number, number, number][];
  if (male) {
    if (age < 50) thresholds = [[34, 38, 43, 48]];  // 40-49
    else if (age < 60) thresholds = [[31, 35, 40, 45]];
    else thresholds = [[28, 32, 36, 41]];
  } else {
    if (age < 50) thresholds = [[27, 31, 36, 41]];
    else thresholds = [[25, 28, 32, 36]];
  }
  const [fair, good, excellent, superior] = thresholds[0];
  if (vo2max >= superior) return { score: 100, category: 'Superior' };
  if (vo2max >= excellent) return { score: 80, category: 'Excellent' };
  if (vo2max >= good) return { score: 60, category: 'Good' };
  if (vo2max >= fair) return { score: 40, category: 'Fair' };
  return { score: 20, category: 'Poor' };
}

function computeComponents(
  wellness: WellnessRecord[],
  activities: Activity[],
  settings: UserSettings,
): Component[] {
  const age = getAge(settings);
  const sex = settings.sex;
  const sorted = [...wellness].sort((a, b) => a.date.localeCompare(b.date));
  const now = new Date();
  const last30 = sorted.filter(w => new Date(w.date) >= new Date(now.getTime() - 30 * 86400000));
  const last4WeeksActs = activities.filter(a => new Date(a.date) >= new Date(now.getTime() - 28 * 86400000));

  const components: Component[] = [];

  // 1. VO2max (25 pts weight)
  const latestVo2 = [...sorted].reverse().find(w => w.vo2max != null)?.vo2max ?? null;
  if (latestVo2 != null) {
    const { score, category } = vo2maxScore(latestVo2, age, sex);
    components.push({
      label: 'VO₂max Percentile',
      score,
      weight: 25,
      detail: `${latestVo2.toFixed(1)} ml/kg/min — ${category} for your age group`,
      available: true,
    });
  } else {
    components.push({ label: 'VO₂max Percentile', score: 0, weight: 25, detail: 'No VO₂max data', available: false });
  }

  // 2. Resting HR trend (25 pts)
  const rhrValues = last30.filter(w => w.resting_hr != null).map(w => w.resting_hr as number);
  if (rhrValues.length > 0) {
    const avgRhr = rhrValues.reduce((s, v) => s + v, 0) / rhrValues.length;
    let baseScore: number;
    if (avgRhr < 50) baseScore = 100;
    else if (avgRhr < 55) baseScore = 85;
    else if (avgRhr < 60) baseScore = 70;
    else if (avgRhr < 65) baseScore = 55;
    else if (avgRhr < 70) baseScore = 40;
    else if (avgRhr < 75) baseScore = 25;
    else baseScore = 10;
    // Bonus if trend declining (improving) over last 30 days
    const slopeBonus = rhrValues.length >= 7 && trend(rhrValues) < -0.05 ? 10 : 0;
    const finalScore = Math.min(100, baseScore + slopeBonus);
    components.push({
      label: 'Resting Heart Rate',
      score: finalScore,
      weight: 25,
      detail: `Avg ${Math.round(avgRhr)} bpm${slopeBonus > 0 ? ' (improving trend +10)' : ''}`,
      available: true,
    });
  } else {
    components.push({ label: 'Resting Heart Rate', score: 0, weight: 25, detail: 'No RHR data', available: false });
  }

  // 3. Muscle mass (20 pts)
  const latestMuscle = [...sorted].reverse().find(w => w.muscle_mass_kg != null)?.muscle_mass_kg ?? null;
  if (latestMuscle != null) {
    const male = sex === 'male';
    let score: number;
    if (male) {
      score = latestMuscle >= 38 ? 100 : latestMuscle >= 33 ? 75 : latestMuscle >= 28 ? 50 : 25;
    } else {
      score = latestMuscle >= 30 ? 100 : latestMuscle >= 25 ? 75 : latestMuscle >= 20 ? 50 : 25;
    }
    components.push({
      label: 'Muscle Mass',
      score,
      weight: 20,
      detail: `${latestMuscle.toFixed(1)} kg`,
      available: true,
    });
  } else {
    components.push({ label: 'Muscle Mass', score: 0, weight: 20, detail: 'No body composition data', available: false });
  }

  // 4. Sleep quality (15 pts)
  const sleepVals = last30.filter(w => w.sleep_hours != null).map(w => w.sleep_hours as number);
  if (sleepVals.length > 0) {
    const avgSleep = sleepVals.reduce((s, v) => s + v, 0) / sleepVals.length;
    let score: number;
    if (avgSleep >= 7 && avgSleep <= 9) score = 100;
    else if (avgSleep > 9) score = 80;
    else if (avgSleep >= 6) score = 70;
    else if (avgSleep >= 5) score = 40;
    else score = 10;
    components.push({
      label: 'Sleep Quality',
      score,
      weight: 15,
      detail: `30-day avg: ${avgSleep.toFixed(1)} h/night`,
      available: true,
    });
  } else {
    components.push({ label: 'Sleep Quality', score: 0, weight: 15, detail: 'No sleep data', available: false });
  }

  // 5. Weekly active minutes (15 pts)
  const totalMins = last4WeeksActs.reduce((s, a) => s + a.duration_seconds / 60, 0);
  const avgWeeklyMins = totalMins / 4;
  let activeScore: number;
  if (avgWeeklyMins >= 300) activeScore = 100;
  else if (avgWeeklyMins >= 150) activeScore = 70;
  else if (avgWeeklyMins >= 60) activeScore = 40;
  else activeScore = 20;
  components.push({
    label: 'Weekly Active Minutes',
    score: activeScore,
    weight: 15,
    detail: `Avg ${Math.round(avgWeeklyMins)} min/week (last 4 weeks)`,
    available: true,
  });

  return components;
}

function CircleScore({ score, color }: { score: number; color: string }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={100} height={100} viewBox="0 0 100 100">
      <circle cx={50} cy={50} r={r} fill="none" stroke="hsl(240 3.7% 13%)" strokeWidth={10} />
      <circle
        cx={50} cy={50} r={r}
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
      <text x={50} y={55} textAnchor="middle" fontSize={18} fontWeight="bold" fill={color} fontFamily="monospace">
        {score}
      </text>
    </svg>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return '#10B981'; // emerald
  if (score >= 60) return '#22C55E'; // green
  if (score >= 40) return '#F59E0B'; // amber
  return '#EF4444'; // red
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Developing';
  return 'Needs Work';
}

function agePercentile(score: number): string {
  if (score >= 80) return 'Top 10%';
  if (score >= 70) return 'Top 20%';
  if (score >= 60) return 'Top 35%';
  if (score >= 50) return 'Top 50%';
  return 'Bottom 50%';
}

export default function LongevityScore({ wellness, activities, settings, compact = false }: Props) {
  const components = useMemo(() => computeComponents(wellness, activities, settings), [wellness, activities, settings]);

  const finalScore = useMemo(() => {
    const available = components.filter(c => c.available);
    if (available.length === 0) return 0;
    const totalWeight = available.reduce((s, c) => s + c.weight, 0);
    const weightedSum = available.reduce((s, c) => s + c.score * c.weight, 0);
    return Math.round(weightedSum / totalWeight);
  }, [components]);

  const color = scoreColor(finalScore);

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
        <CircleScore score={finalScore} color={color} />
        <div>
          <p className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Longevity Score</p>
          <p className="text-lg font-bold" style={{ color }}>{scoreLabel(finalScore)}</p>
          <p className="text-[10px] text-muted-foreground">{agePercentile(finalScore)} for your age group</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Score + label */}
      <div className="flex items-center gap-6">
        <CircleScore score={finalScore} color={color} />
        <div>
          <p className="text-2xl font-bold" style={{ color }}>{scoreLabel(finalScore)}</p>
          <p className="text-sm text-muted-foreground">{agePercentile(finalScore)} for your age group</p>
          <p className="text-[10px] text-muted-foreground/60 mt-1 max-w-xs">
            Based on Peter Attia&apos;s centenarian decathlon framework and ACSM norms
          </p>
        </div>
      </div>

      {/* Component bars */}
      <div className="space-y-3">
        {components.map(c => (
          <div key={c.label} className="space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-xs font-medium">{c.label}</span>
              <span className="text-xs font-mono text-muted-foreground">{c.available ? c.score : '—'}</span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: c.available ? `${c.score}%` : '0%',
                  backgroundColor: c.available ? scoreColor(c.score) : 'transparent',
                }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">{c.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
