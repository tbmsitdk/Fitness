import { describe, it, expect } from 'vitest';
import {
  computeVariabilityIndex, computeWorkAboveFtp, computeCardiacLag,
  type ActivitySample,
} from '@/lib/activity-analysis';

// Samples every 10s (SAMPLE_INTERVAL)
function samples(n: number, powerFn: (i: number) => number | null, hrFn: (i: number) => number | null): ActivitySample[] {
  return Array.from({ length: n }, (_, i) => ({
    elapsed_seconds: i * 10,
    power: powerFn(i),
    hr: hrFn(i),
    cadence: null,
  }));
}

describe('computeVariabilityIndex', () => {
  it('is ~1.0 for a perfectly steady power output', () => {
    const s = samples(60, () => 200, () => 140);
    const result = computeVariabilityIndex(s);
    expect(result).not.toBeNull();
    expect(result!.vi).toBeCloseTo(1.0, 1);
    expect(result!.interpretation).toBe('steady');
  });

  it('is notably above 1.0 for an interval workout (alternating high/low power)', () => {
    const s = samples(60, i => (i % 6 < 3 ? 400 : 100), () => 140);
    const result = computeVariabilityIndex(s);
    expect(result).not.toBeNull();
    expect(result!.vi).toBeGreaterThan(1.05);
  });

  it('returns null with too few power samples', () => {
    const s = samples(2, () => 200, () => 140);
    expect(computeVariabilityIndex(s)).toBeNull();
  });
});

describe('computeWorkAboveFtp', () => {
  it('returns null without a valid FTP', () => {
    const s = samples(10, () => 300, () => 140);
    expect(computeWorkAboveFtp(s, null)).toBeNull();
    expect(computeWorkAboveFtp(s, 0)).toBeNull();
  });

  it('computes zero when the ride never exceeds FTP', () => {
    const s = samples(10, () => 150, () => 140);
    const result = computeWorkAboveFtp(s, 200);
    expect(result).toEqual({ avgWattsAboveFtp: 0, peakWattsAboveFtp: 0, secondsAboveFtp: 0, pctTimeAboveFtp: 0 });
  });

  it('computes avg/peak excess watts only for samples above FTP', () => {
    // 5 samples at 300W (100W excess over FTP 200), 5 samples at 100W (below FTP)
    const s = samples(10, i => (i < 5 ? 300 : 100), () => 140);
    const result = computeWorkAboveFtp(s, 200);
    expect(result).not.toBeNull();
    expect(result!.avgWattsAboveFtp).toBe(100);
    expect(result!.peakWattsAboveFtp).toBe(100);
    expect(result!.secondsAboveFtp).toBe(50);
    expect(result!.pctTimeAboveFtp).toBe(50);
  });
});

describe('computeCardiacLag', () => {
  it('detects a positive lag when HR trails power by a fixed delay', () => {
    // power steps up/down every 5 samples (50s); HR follows the SAME pattern
    // shifted 2 samples (20s) later — a clean, detectable lag.
    const powerPattern = (i: number) => (Math.floor(i / 5) % 2 === 0 ? 350 : 120);
    const s = samples(80, powerPattern, i => (powerPattern(Math.max(0, i - 2)) > 200 ? 155 : 115));
    const result = computeCardiacLag(s);
    expect(result).not.toBeNull();
    expect(result!.lagSeconds).toBe(20);
    expect(result!.correlation).toBeGreaterThan(0.5);
  });

  it('returns null with too few paired HR+power samples', () => {
    const s = samples(10, () => 200, () => 140);
    expect(computeCardiacLag(s)).toBeNull();
  });
});
