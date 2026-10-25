import { describe, it, expect } from 'vitest';
import {
  interpolateScore, restingHrScore, rhrTrendBonus, muscleMassScore,
  sleepScore, activeMinutesScore, compositeScore,
} from '@/lib/longevity';

describe('interpolateScore', () => {
  const anchors: [number, number][] = [[0, 0], [10, 50], [20, 100]];

  it('returns the anchor value exactly at an anchor', () => {
    expect(interpolateScore(10, anchors)).toBe(50);
  });

  it('interpolates linearly between anchors', () => {
    expect(interpolateScore(5, anchors)).toBe(25);
    expect(interpolateScore(15, anchors)).toBe(75);
  });

  it('clamps outside the range instead of extrapolating', () => {
    expect(interpolateScore(-100, anchors)).toBe(0);
    expect(interpolateScore(1000, anchors)).toBe(100);
  });

  it('handles an empty anchor list', () => {
    expect(interpolateScore(5, [])).toBe(0);
  });
});

describe('restingHrScore', () => {
  it('keeps the old band edges as its anchors', () => {
    expect(restingHrScore(50)).toBe(100);
    expect(restingHrScore(55)).toBe(85);
    expect(restingHrScore(60)).toBe(70);
  });

  it('MOVES for a real improvement inside one old band', () => {
    // The bug: 54.8 and 52.9 both scored 85, so months of progress showed
    // nothing. They must now differ.
    const before = restingHrScore(54.8);
    const after = restingHrScore(52.9);
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeGreaterThan(2);
  });

  it('rewards a lower pulse monotonically', () => {
    const values = [70, 65, 60, 55, 50, 45];
    const scores = values.map(restingHrScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });
});

describe('rhrTrendBonus', () => {
  it('gives nothing for a flat or rising pulse', () => {
    expect(rhrTrendBonus(0)).toBe(0);
    expect(rhrTrendBonus(0.1)).toBe(0);
  });

  it('scales with how fast it is falling, rather than switching on', () => {
    // The old version flipped from 0 to +10 either side of -0.05.
    expect(rhrTrendBonus(-0.025)).toBeCloseTo(5, 1);
    expect(rhrTrendBonus(-0.05)).toBeCloseTo(10, 1);
  });

  it('caps the bonus', () => {
    expect(rhrTrendBonus(-5)).toBe(10);
  });

  it('ignores a non-finite slope', () => {
    expect(rhrTrendBonus(NaN)).toBe(0);
  });
});

describe('muscleMassScore', () => {
  it('keeps the old thresholds as anchors', () => {
    expect(muscleMassScore(33, 'male')).toBe(75);
    expect(muscleMassScore(38, 'male')).toBe(100);
  });

  it('credits progress between thresholds', () => {
    // 34.5 kg used to score the same as 33.0 — a 1.5 kg gain was invisible.
    expect(muscleMassScore(34.5, 'male')).toBeGreaterThan(muscleMassScore(33, 'male'));
  });

  it('uses different anchors by sex', () => {
    expect(muscleMassScore(30, 'female')).toBe(100);
    expect(muscleMassScore(30, 'male')).toBeLessThan(100);
  });
});

describe('sleepScore', () => {
  it('peaks across the 7-9 hour range', () => {
    expect(sleepScore(7)).toBe(100);
    expect(sleepScore(8)).toBe(100);
    expect(sleepScore(9)).toBe(100);
  });

  it('falls away on BOTH sides — more sleep is not always better', () => {
    expect(sleepScore(5.5)).toBeLessThan(100);
    expect(sleepScore(11)).toBeLessThan(100);
  });

  it('credits progress towards the target', () => {
    // 6.9h -> 7.7h crossed no old band edge below 7, so this must now move.
    expect(sleepScore(6.9)).toBeLessThan(sleepScore(7.4));
  });
});

describe('activeMinutesScore', () => {
  it('anchors on the public-health targets', () => {
    expect(activeMinutesScore(150)).toBe(70);
    expect(activeMinutesScore(300)).toBe(100);
  });

  it('credits the distance between 150 and 300 rather than flooring it', () => {
    const s = activeMinutesScore(237);
    expect(s).toBeGreaterThan(70);
    expect(s).toBeLessThan(100);
  });

  it('does not keep rewarding ever more volume', () => {
    expect(activeMinutesScore(900)).toBe(activeMinutesScore(300));
  });
});

describe('compositeScore', () => {
  it('weights components', () => {
    expect(compositeScore([{ score: 100, weight: 3 }, { score: 0, weight: 1 }])).toBe(75);
  });

  it('reweights over whatever is present', () => {
    // One component missing must not drag the total towards zero.
    expect(compositeScore([{ score: 80, weight: 25 }])).toBe(80);
  });

  it('is 0 with nothing to score', () => {
    expect(compositeScore([])).toBe(0);
  });
});

describe('the whole score responds to real change', () => {
  const build = (rhr: number, muscle: number, sleep: number, mins: number) => compositeScore([
    { score: 80, weight: 25 },
    { score: Math.min(100, restingHrScore(rhr)), weight: 25 },
    { score: muscleMassScore(muscle, 'male'), weight: 20 },
    { score: sleepScore(sleep), weight: 15 },
    { score: activeMinutesScore(mins), weight: 15 },
  ]);

  it('rises when several inputs improve modestly', () => {
    // Exactly the user's reported case: everything improved, score stayed 84.
    const before = build(54.8, 33.0, 6.92, 200);
    const after = build(52.9, 34.5, 7.67, 237);
    expect(after).toBeGreaterThan(before);
  });

  it('falls when inputs get worse', () => {
    expect(build(60, 32, 6.0, 120)).toBeLessThan(build(52, 35, 7.5, 260));
  });
});
