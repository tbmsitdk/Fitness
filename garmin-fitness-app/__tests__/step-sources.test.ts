import { describe, it, expect } from 'vitest';
import { classifySource, deriveSteps, mergeDaySteps, FILL_TOLERANCE, type StepRecord } from '@/lib/step-sources';

const rec = (source: string, start: string, end: string, value: number): StepRecord => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return { source, startMin: m(start), endMin: m(end), value };
};
const GARMIN = 'Connect';
const PHONE = "Marc's iPhone";

describe('classifySource', () => {
  it('knows Garmin by its Health names, and the iPhone', () => {
    for (const n of ['Connect', 'Garmin Connect', 'Garmin vívosmart 5', 'vivosmart 5']) expect(classifySource(n), n).toBe('garmin');
    expect(classifySource("Marc's iPhone")).toBe('phone');
    expect(classifySource('iPhone')).toBe('phone');
  });

  it('ignores everything else, an Apple Watch included', () => {
    for (const n of ["Marc's Apple Watch", 'Health', 'Zwift', 'Strava', 'unknown']) expect(classifySource(n), n).toBe('other');
  });
});

describe('mergeDaySteps — Garmin is the master, the phone fills Garmin\'s gaps', () => {
  // The case that inflated the average: the same walk recorded by both.
  it('does not add the phone on top of Garmin where Garmin recorded steps', () => {
    const d = mergeDaySteps([
      rec(GARMIN, '08:00', '08:15', 1000), rec(PHONE, '08:00', '08:15', 1100),
      rec(GARMIN, '12:00', '12:15', 2000), rec(PHONE, '12:00', '12:15', 2200),
    ]);
    expect(d.merged).toBe(3000);
    expect(d.fill).toBe(0);
    expect(d.garminInHealth).toBe(3000);
  });

  it('uses the phone for the stretch Garmin was on the charger', () => {
    const d = mergeDaySteps([
      rec(GARMIN, '08:00', '08:15', 1000), rec(GARMIN, '18:00', '18:15', 1500),
      rec(PHONE, '08:00', '08:15', 1200),           // Garmin has this slice: ignored
      rec(PHONE, '12:00', '12:15', 800),            // Garmin has nothing here: counted
      rec(PHONE, '13:00', '13:15', 400),
    ]);
    expect(d.merged).toBe(1000 + 1500 + 800 + 400);
    expect(d.fill).toBe(1200);
    expect(d.garminInHealth).toBe(2500);
  });

  it('spreads a long record across the slices it covers, in proportion', () => {
    // Garmin covers 08:00-08:30 only. The phone has one record 07:30-08:30 of 600 steps:
    // half of it (07:30-08:00) falls in Garmin's gap.
    const d = mergeDaySteps([rec(GARMIN, '08:00', '08:30', 1000), rec(PHONE, '07:30', '08:30', 600)]);
    expect(d.fill).toBe(300);
    expect(d.merged).toBe(1300);
  });

  it('uses the phone alone on a day Garmin has nothing at all, and says there was no Garmin map', () => {
    const d = mergeDaySteps([rec(PHONE, '08:00', '08:15', 2500), rec(PHONE, '14:00', '14:15', 3000)]);
    expect(d).toEqual({ merged: 5500, fill: null, garminInHealth: null });
  });

  it('ignores the Apple Watch and other apps entirely', () => {
    const d = mergeDaySteps([
      rec(GARMIN, '08:00', '08:15', 1000),
      rec("Marc's Apple Watch", '12:00', '12:15', 9000), rec('Zwift', '13:00', '13:15', 4000),
    ]);
    expect(d.merged).toBe(1000);
    expect(mergeDaySteps([rec("Marc's Apple Watch", '12:00', '12:15', 9000)]).merged).toBeNull();
  });

  it('is empty, not zero, with nothing usable', () => {
    expect(mergeDaySteps([])).toEqual({ merged: null, fill: null, garminInHealth: null });
    expect(mergeDaySteps([rec(PHONE, '08:00', '08:15', 0)]).merged).toBeNull();
  });

  it('copes with a zero-length record and one that runs to the end of the day', () => {
    expect(mergeDaySteps([rec(GARMIN, '10:00', '10:00', 50)]).merged).toBe(50);
    expect(mergeDaySteps([{ source: GARMIN, startMin: 23 * 60 + 50, endMin: 1440, value: 80 }]).merged).toBe(80);
  });
});

describe('deriveSteps', () => {
  it('Garmin wins over the Apple export, in either order of arrival', () => {
    expect(deriveSteps({ garmin: 8_000, apple: 12_000, fill: null, fillRef: null })).toBe(8_000);
  });

  it('uses the export only when Garmin has no count', () => {
    expect(deriveSteps({ garmin: null, apple: 7_000, fill: null, fillRef: null })).toBe(7_000);
    expect(deriveSteps({ garmin: null, apple: null, fill: null, fillRef: null })).toBeNull();
  });

  it('adds the phone\'s steps in Garmin\'s gaps when the two accounts of Garmin\'s day agree', () => {
    expect(deriveSteps({ garmin: 6_000, apple: 6_900, fill: 900, fillRef: 6_100 })).toBe(6_900);
  });

  // The export's Garmin records were the map of the gaps. If they are far from Garmin's own total the map is wrong.
  it('drops the fill when the export saw a very different Garmin day', () => {
    expect(deriveSteps({ garmin: 6_000, apple: 12_000, fill: 4_000, fillRef: 2_000 })).toBe(6_000);
    expect(FILL_TOLERANCE).toBe(0.2);
    // exactly at the tolerance still counts
    expect(deriveSteps({ garmin: 5_000, apple: null, fill: 100, fillRef: 4_000 })).toBe(5_100);
    expect(deriveSteps({ garmin: 5_000, apple: null, fill: 100, fillRef: 3_999 })).toBe(5_000);
  });

  it('does not fill without a reference', () => {
    expect(deriveSteps({ garmin: 6_000, apple: null, fill: 900, fillRef: null })).toBe(6_000);
  });
});
