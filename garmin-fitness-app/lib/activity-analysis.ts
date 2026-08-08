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

// Normalized Power: 30s rolling average of power, raised to the 4th power,
// meaned, then 4th-rooted — weights surges more heavily than a plain average,
// approximating the physiological cost of a variable effort.
export function computeNormalizedPower(samples: ActivitySample[]): number | null {
  const power = samples.map(s => s.power).filter((v): v is number => v != null && v > 0);
  const W = Math.max(1, Math.round(30 / SAMPLE_INTERVAL)); // 30s window
  if (power.length < W) return null;

  const rolling: number[] = [];
  for (let i = W - 1; i < power.length; i++) {
    let sum = 0;
    for (let j = i - W + 1; j <= i; j++) sum += power[j];
    rolling.push(sum / W);
  }
  const meanFourth = rolling.reduce((a, v) => a + Math.pow(v, 4), 0) / rolling.length;
  return Math.round(Math.pow(meanFourth, 0.25));
}

export interface VariabilityResult {
  vi: number;
  avgPower: number;
  normalizedPower: number;
  interpretation: 'steady' | 'variable' | 'highly variable';
}

// Variability Index = NP / avg power. ~1.0 = steady-state; higher = surgy/interval
// effort (power varies a lot around the average, even if the average is the same).
export function computeVariabilityIndex(samples: ActivitySample[]): VariabilityResult | null {
  const power = samples.map(s => s.power).filter((v): v is number => v != null && v > 0);
  if (power.length < 3) return null;
  const np = computeNormalizedPower(samples);
  if (np == null) return null;
  const avgPower = Math.round(power.reduce((a, b) => a + b, 0) / power.length);
  if (avgPower === 0) return null;

  const vi = Math.round((np / avgPower) * 100) / 100;
  const interpretation: VariabilityResult['interpretation'] =
    vi < 1.05 ? 'steady' : vi < 1.15 ? 'variable' : 'highly variable';

  return { vi, avgPower, normalizedPower: np, interpretation };
}

export interface WorkAboveFtpResult {
  kj: number;              // excess kJ = integral of (power - FTP) while power > FTP
  secondsAboveFtp: number;
  pctTimeAboveFtp: number;
}

// How much "extra", supra-threshold work was done beyond what FTP alone
// sustains — a proxy for anaerobic-reserve depletion during the ride.
export function computeWorkAboveFtp(samples: ActivitySample[], ftp: number | null | undefined): WorkAboveFtpResult | null {
  if (!ftp || ftp <= 0) return null;
  const valid = samples.filter(s => s.power != null);
  if (valid.length === 0) return null;

  let excessJoules = 0;
  let secondsAbove = 0;
  for (const s of valid) {
    const p = s.power as number;
    if (p > ftp) {
      excessJoules += (p - ftp) * SAMPLE_INTERVAL;
      secondsAbove += SAMPLE_INTERVAL;
    }
  }
  if (secondsAbove === 0) return { kj: 0, secondsAboveFtp: 0, pctTimeAboveFtp: 0 };

  const totalSeconds = valid.length * SAMPLE_INTERVAL;
  return {
    kj: Math.round(excessJoules / 100) / 10, // 1 decimal kJ
    secondsAboveFtp: secondsAbove,
    pctTimeAboveFtp: Math.round((secondsAbove / totalSeconds) * 100),
  };
}

export interface CardiacLagResult {
  lagSeconds: number;
  correlation: number; // Pearson r at the best-fit lag
  confidence: 'high' | 'moderate' | 'low';
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX, dy = ys[i] - meanY;
    num += dx * dy; denX += dx * dx; denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

// How many seconds does HR lag behind power? Slides HR forward against power
// by 0..maxLagSeconds and picks the lag with the strongest correlation — most
// informative for interval/surge-heavy workouts where power repeatedly steps
// up and down (a steady ride has too little power variance to fit a lag to).
export function computeCardiacLag(samples: ActivitySample[], maxLagSeconds = 90): CardiacLagResult | null {
  const valid = samples.filter(s => s.power != null && s.hr != null);
  if (valid.length < 30) return null;
  const power = valid.map(s => s.power as number);
  const hr = valid.map(s => s.hr as number);

  const maxLagSamples = Math.floor(maxLagSeconds / SAMPLE_INTERVAL);
  let bestLag = 0;
  let bestR = -Infinity;
  for (let lag = 0; lag <= maxLagSamples; lag++) {
    const n = power.length - lag;
    if (n < 20) break;
    const r = pearson(power.slice(0, n), hr.slice(lag, lag + n));
    if (r != null && r > bestR) { bestR = r; bestLag = lag; }
  }
  if (bestR === -Infinity) return null;

  const confidence: CardiacLagResult['confidence'] =
    bestR > 0.5 ? 'high' : bestR > 0.3 ? 'moderate' : 'low';

  return {
    lagSeconds: bestLag * SAMPLE_INTERVAL,
    correlation: Math.round(bestR * 100) / 100,
    confidence,
  };
}
