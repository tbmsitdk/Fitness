// Client-side analysis helpers for a single activity's per-second (10s-resolution) samples.

export interface ActivitySample {
  elapsed_seconds: number;
  hr: number | null;
  power: number | null;
  cadence: number | null;
  lat?: number | null;
  lon?: number | null;
}

export interface BestEffort {
  windowSeconds: number;
  label: string;
  power: number | null;
  hr: number | null;
}

const WINDOWS = [
  { seconds: 10,   label: '10s'  },
  { seconds: 60,   label: '1min' },
  { seconds: 300,  label: '5min' },
  { seconds: 1200, label: '20min' },
];

const SAMPLE_INTERVAL = 10; // samples are stored every 10 seconds

// Best (highest) rolling-average power & HR over fixed windows — i.e. "best efforts"
// within a single workout. Samples are assumed sorted by elapsed_seconds.
export function computeBestEfforts(samples: ActivitySample[]): BestEffort[] {
  if (samples.length === 0) return [];
  const totalDuration = samples[samples.length - 1].elapsed_seconds;

  return WINDOWS
    .filter(w => w.seconds <= totalDuration)
    .map(w => {
      const windowSize = Math.max(1, Math.round(w.seconds / SAMPLE_INTERVAL));
      let bestPower: number | null = null;
      let bestHr: number | null = null;

      for (let i = 0; i + windowSize <= samples.length; i++) {
        const slice = samples.slice(i, i + windowSize);
        const powerVals = slice.map(s => s.power).filter((v): v is number => v != null);
        const hrVals = slice.map(s => s.hr).filter((v): v is number => v != null);

        if (powerVals.length === slice.length) {
          const avg = powerVals.reduce((a, b) => a + b, 0) / powerVals.length;
          if (bestPower == null || avg > bestPower) bestPower = avg;
        }
        if (hrVals.length === slice.length) {
          const avg = hrVals.reduce((a, b) => a + b, 0) / hrVals.length;
          if (bestHr == null || avg > bestHr) bestHr = avg;
        }
      }

      return {
        windowSeconds: w.seconds,
        label: w.label,
        power: bestPower != null ? Math.round(bestPower) : null,
        hr: bestHr != null ? Math.round(bestHr) : null,
      };
    })
    .filter(e => e.power != null || e.hr != null);
}

export interface DecouplingResult {
  pctDrift: number;       // positive = HR drifted up relative to power (decoupling)
  firstHalfRatio: number;
  secondHalfRatio: number;
  interpretation: 'excellent' | 'good' | 'moderate' | 'high';
}

// Aerobic (Power:HR) decoupling — compares the power/HR ratio in the first vs
// second half of an effort. A stable aerobic system holds the ratio steady;
// a rising HR for the same power (ratio drops) indicates cardiac drift/fatigue.
// Meaningful primarily for steady-state cycling efforts with power data.
export function computeDecoupling(samples: ActivitySample[], minDurationSeconds = 1200): DecouplingResult | null {
  const valid = samples.filter(s => s.power != null && s.power > 0 && s.hr != null && s.hr > 0);
  if (valid.length < 10) return null;

  const totalDuration = valid[valid.length - 1].elapsed_seconds - valid[0].elapsed_seconds;
  if (totalDuration < minDurationSeconds) return null;

  const mid = Math.floor(valid.length / 2);
  const firstHalf = valid.slice(0, mid);
  const secondHalf = valid.slice(mid);

  const ratio = (arr: ActivitySample[]) => {
    const avgPower = arr.reduce((s, x) => s + (x.power as number), 0) / arr.length;
    const avgHr = arr.reduce((s, x) => s + (x.hr as number), 0) / arr.length;
    return avgPower / avgHr;
  };

  const firstHalfRatio = ratio(firstHalf);
  const secondHalfRatio = ratio(secondHalf);
  const pctDrift = ((firstHalfRatio - secondHalfRatio) / firstHalfRatio) * 100;

  const interpretation: DecouplingResult['interpretation'] =
    pctDrift < 3  ? 'excellent' :
    pctDrift < 5  ? 'good' :
    pctDrift < 10 ? 'moderate' : 'high';

  return {
    pctDrift: Math.round(pctDrift * 10) / 10,
    firstHalfRatio: Math.round(firstHalfRatio * 100) / 100,
    secondHalfRatio: Math.round(secondHalfRatio * 100) / 100,
    interpretation,
  };
}
